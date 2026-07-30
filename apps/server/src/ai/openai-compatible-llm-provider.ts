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
  json(): Promise<unknown>;
}

export interface OpenAiCompatibleFetchRequest {
  readonly method: "POST";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
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

  constructor(options: OpenAiCompatibleLlmProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new OpenAiCompatibleLlmProviderError("LLM API key must be non-empty");
    }

    this.apiKey = options.apiKey.trim();
    this.completionsUrl = validateCompletionsUrl(options.completionsUrl);
    this.fetch = options.fetch ?? createDefaultFetch();
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
      throw new OpenAiCompatibleLlmProviderError(
        `LLM provider request failed with status ${response.status}`,
      );
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (error) {
      if (isAbortError(error)) {
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
