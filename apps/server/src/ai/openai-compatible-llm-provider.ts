import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmUsage,
} from "./llm-provider.js";

export interface OpenAiCompatibleResponseHeaders {
  get(name: string): string | null;
}

/** The small response surface required from an injected HTTP client. */
export interface OpenAiCompatibleFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: OpenAiCompatibleResponseHeaders;
  readonly body: ReadableStream<Uint8Array> | null;
}

export interface OpenAiCompatibleFetchRequest {
  readonly method: "POST";
  readonly redirect: "error";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

/** Injectable transport, keeping provider tests fully offline. */
export type OpenAiCompatibleFetch = (
  url: string,
  request: OpenAiCompatibleFetchRequest,
) => Promise<OpenAiCompatibleFetchResponse>;

export interface OpenAiCompatibleLlmProviderOptions {
  readonly completionsUrl: string;
  readonly apiKey: string;
  readonly fetch?: OpenAiCompatibleFetch;
  /** Allows trusted callers to lower the 1 MiB production response limit. */
  readonly maxResponseBodyBytes?: number;
}

export class OpenAiCompatibleLlmProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiCompatibleLlmProviderError";
  }
}

const USAGE_FIELD_MAPPINGS = [
  ["prompt_tokens", "inputTokens"],
  ["completion_tokens", "outputTokens"],
  ["total_tokens", "totalTokens"],
] as const satisfies readonly (readonly [string, keyof LlmUsage])[];

const DEFAULT_MAX_RESPONSE_BODY_BYTES = 1024 * 1024;

class ResponseBodyLimitExceededError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function validateMaxResponseBodyBytes(maxResponseBodyBytes: number | undefined): number {
  if (maxResponseBodyBytes === undefined) {
    return DEFAULT_MAX_RESPONSE_BODY_BYTES;
  }

  if (
    !Number.isSafeInteger(maxResponseBodyBytes) ||
    maxResponseBodyBytes <= 0
  ) {
    throw new OpenAiCompatibleLlmProviderError(
      "LLM response size limit must be a positive safe integer",
    );
  }

  return maxResponseBodyBytes;
}

function readContentLength(headers: OpenAiCompatibleResponseHeaders): number | undefined {
  const contentLength = headers.get("content-length");
  if (contentLength === null) {
    return undefined;
  }

  const normalizedContentLength = contentLength.trim();
  if (!/^\d+$/u.test(normalizedContentLength)) {
    throw new OpenAiCompatibleLlmProviderError(
      "LLM provider returned an invalid Content-Length",
    );
  }

  const parsedContentLength = Number(normalizedContentLength);
  if (!Number.isSafeInteger(parsedContentLength)) {
    throw new OpenAiCompatibleLlmProviderError(
      "LLM provider returned an invalid Content-Length",
    );
  }

  return parsedContentLength;
}

async function cancelResponseReader(
  responseReader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await responseReader.cancel();
  } catch {
    // Preserve the original read or size-limit failure over cleanup failures.
  }
}

async function cancelResponseBody(
  responseBody: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (responseBody === null) {
    return;
  }

  try {
    await responseBody.cancel();
  } catch {
    // Preserve the original validation failure over cleanup failures.
  }
}

async function readResponseBytes(
  response: OpenAiCompatibleFetchResponse,
  maxResponseBodyBytes: number,
): Promise<Uint8Array> {
  let advertisedContentLength: number | undefined;
  try {
    advertisedContentLength = readContentLength(response.headers);
    if (
      advertisedContentLength !== undefined &&
      advertisedContentLength > maxResponseBodyBytes
    ) {
      throw new OpenAiCompatibleLlmProviderError(
        "LLM provider response exceeds the configured size limit",
      );
    }

    if (response.body === null) {
      throw new OpenAiCompatibleLlmProviderError(
        "LLM provider returned an empty response body",
      );
    }
  } catch (error) {
    await cancelResponseBody(response.body);
    throw error;
  }

  const responseChunks: Uint8Array[] = [];
  let responseByteLength = 0;
  let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const openedResponseReader = response.body.getReader();
    responseReader = openedResponseReader;
    while (true) {
      const { done, value: responseChunk } = await openedResponseReader.read();
      if (done) {
        break;
      }

      if (!(responseChunk instanceof Uint8Array)) {
        throw new TypeError("response stream yielded non-byte data");
      }

      if (responseChunk.byteLength > maxResponseBodyBytes - responseByteLength) {
        await cancelResponseReader(openedResponseReader);
        throw new ResponseBodyLimitExceededError();
      }

      responseChunks.push(responseChunk);
      responseByteLength += responseChunk.byteLength;
    }
  } catch (error) {
    if (error instanceof ResponseBodyLimitExceededError) {
      throw new OpenAiCompatibleLlmProviderError(
        "LLM provider response exceeds the configured size limit",
      );
    }
    if (isAbortError(error)) {
      throw error;
    }

    if (responseReader !== undefined) {
      await cancelResponseReader(responseReader);
    }
    throw new OpenAiCompatibleLlmProviderError(
      "LLM provider response body could not be read",
    );
  }

  const responseBytes = new Uint8Array(responseByteLength);
  let responseByteOffset = 0;
  for (const responseChunk of responseChunks) {
    responseBytes.set(responseChunk, responseByteOffset);
    responseByteOffset += responseChunk.byteLength;
  }

  return responseBytes;
}

function validateCompletionsUrl(completionsUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(completionsUrl);
  } catch {
    throw new OpenAiCompatibleLlmProviderError(
      "LLM completions URL must be a valid HTTPS URL",
    );
  }

  if (parsedUrl.protocol !== "https:") {
    throw new OpenAiCompatibleLlmProviderError(
      "LLM completions URL must be a valid HTTPS URL",
    );
  }

  return completionsUrl;
}

function createDefaultFetch(): OpenAiCompatibleFetch {
  return async (url, request) => globalThis.fetch(url, request);
}

function extractCompletionContent(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return undefined;
  }

  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return undefined;
  }

  return typeof firstChoice.message.content === "string"
    ? firstChoice.message.content
    : undefined;
}

function extractUsage(value: unknown): LlmUsage | undefined {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return undefined;
  }

  const sanitizedUsage: Record<string, number> = {};
  for (const [providerFieldName, responseFieldName] of USAGE_FIELD_MAPPINGS) {
    const tokenCount = value.usage[providerFieldName];
    if (
      typeof tokenCount === "number" &&
      Number.isSafeInteger(tokenCount) &&
      tokenCount >= 0
    ) {
      sanitizedUsage[responseFieldName] = tokenCount;
    }
  }

  return Object.keys(sanitizedUsage).length === 0 ? undefined : sanitizedUsage;
}

/**
 * Adapter for the OpenAI Chat Completions response shape used by compatible
 * providers. It intentionally exposes no vendor SDK or response body details.
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly completionsUrl: string;
  private readonly fetch: OpenAiCompatibleFetch;
  private readonly maxResponseBodyBytes: number;

  constructor(options: OpenAiCompatibleLlmProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new OpenAiCompatibleLlmProviderError("LLM API key must be non-empty");
    }

    this.apiKey = options.apiKey.trim();
    this.completionsUrl = validateCompletionsUrl(options.completionsUrl);
    this.fetch = options.fetch ?? createDefaultFetch();
    this.maxResponseBodyBytes = validateMaxResponseBodyBytes(
      options.maxResponseBodyBytes,
    );
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    let response: OpenAiCompatibleFetchResponse;
    try {
      response = await this.fetch(this.completionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
        }),
        signal: request.signal,
        redirect: "error",
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new OpenAiCompatibleLlmProviderError(
        "LLM provider request failed before receiving a response",
      );
    }

    if (!response.ok) {
      await cancelResponseBody(response.body);
      throw new OpenAiCompatibleLlmProviderError(
        `LLM provider request failed with status ${response.status}`,
      );
    }

    let responseBody: unknown;
    try {
      const responseBytes = await readResponseBytes(
        response,
        this.maxResponseBodyBytes,
      );
      responseBody = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (error instanceof OpenAiCompatibleLlmProviderError) {
        throw error;
      }
      throw new OpenAiCompatibleLlmProviderError("LLM provider returned invalid JSON");
    }

    const content = extractCompletionContent(responseBody);
    if (content === undefined) {
      throw new OpenAiCompatibleLlmProviderError(
        "LLM provider returned an invalid completion response",
      );
    }

    const providerRequestId = response.headers.get("x-request-id");
    const usage = extractUsage(responseBody);
    return {
      content,
      ...(usage === undefined ? {} : { usage }),
      ...(providerRequestId === null || providerRequestId.length === 0
        ? {}
        : { providerRequestId }),
    };
  }
}
