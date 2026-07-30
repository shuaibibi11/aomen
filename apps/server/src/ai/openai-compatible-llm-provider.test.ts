import { describe, expect, it } from "vitest";
import {
  OpenAiCompatibleLlmProvider,
  type OpenAiCompatibleFetch,
  type OpenAiCompatibleFetchResponse,
} from "./openai-compatible-llm-provider.js";

const TEST_API_KEY = "test-only-key";
const COMPLETIONS_URL = "https://provider.example.test/v1/chat/completions";

function createJsonResponse(
  responseBody: unknown = {
    choices: [{ message: { content: '{"action":"sit_out"}' } }],
  },
  options: ResponseInit = {},
): Response {
  return new Response(
    new TextEncoder().encode(JSON.stringify(responseBody)),
    options,
  );
}

function createRequest(signal: AbortSignal) {
  return {
    model: "deepseek-chat",
    messages: [
      { role: "system" as const, content: "Follow the rules." },
      { role: "user" as const, content: "Choose an action." },
    ],
    signal,
  };
}

function createBodyThatTracksReaderAccess(
  markBodyAsRead: () => void,
): ReadableStream<Uint8Array> {
  const responseBody = new ReadableStream<Uint8Array>();
  const getOriginalReader = responseBody.getReader.bind(responseBody);
  Object.defineProperty(responseBody, "getReader", {
    value: () => {
      markBodyAsRead();
      return getOriginalReader();
    },
  });
  return responseBody;
}

describe("OpenAiCompatibleLlmProvider", () => {
  it("uses and restores a stubbed global fetch when no transport is injected", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{ url: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const stubbedGlobalFetch: typeof globalThis.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      if (init?.redirect === "error") {
        // Fetch rejects instead of replaying this authenticated POST on a redirect.
        throw new TypeError("redirect was blocked");
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"action":"sit_out"}' } }] }),
        {
          status: 302,
          headers: { Location: "https://untrusted.example.test/redirect-target" },
        },
      );
    };
    const signal = new AbortController().signal;

    globalThis.fetch = stubbedGlobalFetch;
    try {
      const provider = new OpenAiCompatibleLlmProvider({
        completionsUrl: COMPLETIONS_URL,
        apiKey: TEST_API_KEY,
      });

      const error = await provider.complete(createRequest(signal)).catch(
        (caughtError: unknown) => caughtError,
      );

      expect(error).toMatchObject({
        message: "LLM provider request failed before receiving a response",
      });
      expect(String(error)).not.toContain(TEST_API_KEY);
      expect(fetchCalls).toEqual([{
        url: COMPLETIONS_URL,
        init: expect.objectContaining({
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "Follow the rules." },
              { role: "user", content: "Choose an action." },
            ],
          }),
          signal,
        }),
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("posts the OpenAI chat request with authorization and the supplied signal", async () => {
    const calls: Array<{ url: string; init: Parameters<OpenAiCompatibleFetch>[1] }> = [];
    const fetch: OpenAiCompatibleFetch = async (url, init) => {
      calls.push({ url, init });
      return createJsonResponse();
    };
    const signal = new AbortController().signal;
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    await provider.complete(createRequest(signal));

    expect(calls).toEqual([{
      url: COMPLETIONS_URL,
      init: {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "Follow the rules." },
            { role: "user", content: "Choose an action." },
          ],
        }),
        signal,
      },
    }]);
  });

  it("maps content, safe token usage, and the provider request id", async () => {
    const fetch: OpenAiCompatibleFetch = async () => createJsonResponse(
      {
        choices: [{ message: { content: '{"action":"bet","betKind":"player","amount":100}' } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
          ignored: "value",
        },
      },
      { headers: { "x-request-id": "request-42" } },
    );
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    await expect(provider.complete(createRequest(new AbortController().signal))).resolves.toEqual({
      content: '{"action":"bet","betKind":"player","amount":100}',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      providerRequestId: "request-42",
    });
  });

  it("ignores unsafe token usage values", async () => {
    const fetch: OpenAiCompatibleFetch = async () => createJsonResponse({
        choices: [{ message: { content: '{"action":"sit_out"}' } }],
        usage: {
          prompt_tokens: -1,
          completion_tokens: 2.5,
          total_tokens: Number.MAX_SAFE_INTEGER + 1,
        },
      });
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    await expect(provider.complete(createRequest(new AbortController().signal))).resolves.toEqual({
      content: '{"action":"sit_out"}',
    });
  });

  it("rejects malformed JSON with a safe provider error", async () => {
    const fetch: OpenAiCompatibleFetch = async () => new Response(
      "response body must not escape",
    );
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    await expect(provider.complete(createRequest(new AbortController().signal))).rejects.toThrow(
      "LLM provider returned invalid JSON",
    );
  });

  it("rejects a malformed completion shape without surfacing response data", async () => {
    const responseBody = "provider-body-must-not-surface";
    const fetch: OpenAiCompatibleFetch = async () => createJsonResponse({
      choices: [{ message: { content: 42 } }],
      responseBody,
    });
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({ message: "LLM provider returned an invalid completion response" });
    expect(String(error)).not.toContain(responseBody);
    expect(String(error)).not.toContain(TEST_API_KEY);
  });

  it("reports non-success statuses without reading the response body or exposing the key", async () => {
    let bodyWasRead = false;
    const response: OpenAiCompatibleFetchResponse = {
      ok: false,
      status: 429,
      headers: { get: () => null },
      body: createBodyThatTracksReaderAccess(() => {
        bodyWasRead = true;
      }),
    };
    const fetch: OpenAiCompatibleFetch = async () => response;
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({ message: "LLM provider request failed with status 429" });
    expect(String(error)).not.toContain(TEST_API_KEY);
    expect(bodyWasRead).toBe(false);
  });

  it("rejects an advertised oversized response before reading its body", async () => {
    let bodyWasRead = false;
    const response: OpenAiCompatibleFetchResponse = {
      ok: true,
      status: 200,
      headers: { get: () => "11" },
      body: createBodyThatTracksReaderAccess(() => {
        bodyWasRead = true;
      }),
    };
    const fetch: OpenAiCompatibleFetch = async () => response;
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
      maxResponseBodyBytes: 10,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({
      message: "LLM provider response exceeds the configured size limit",
    });
    expect(String(error)).not.toContain(TEST_API_KEY);
    expect(bodyWasRead).toBe(false);
  });

  it("cancels an oversized stream without a Content-Length header", async () => {
    let readerWasCancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(responseController) {
        responseController.enqueue(new Uint8Array(8));
        responseController.enqueue(new Uint8Array(8));
      },
      cancel() {
        readerWasCancelled = true;
      },
    });
    const response: OpenAiCompatibleFetchResponse = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: oversizedBody,
    };
    const fetch: OpenAiCompatibleFetch = async () => response;
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
      maxResponseBodyBytes: 10,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({
      message: "LLM provider response exceeds the configured size limit",
    });
    expect(String(error)).not.toContain(TEST_API_KEY);
    expect(readerWasCancelled).toBe(true);
  });

  it("rejects missing response bodies with a safe provider error", async () => {
    const fetch: OpenAiCompatibleFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
    });
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({
      message: "LLM provider returned an empty response body",
    });
    expect(String(error)).not.toContain(TEST_API_KEY);
  });

  it("rejects malformed Content-Length values without reading the body", async () => {
    let bodyWasRead = false;
    const response: OpenAiCompatibleFetchResponse = {
      ok: true,
      status: 200,
      headers: { get: () => "1e6" },
      body: createBodyThatTracksReaderAccess(() => {
        bodyWasRead = true;
      }),
    };
    const fetch: OpenAiCompatibleFetch = async () => response;
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({
      message: "LLM provider returned an invalid Content-Length",
    });
    expect(String(error)).not.toContain(TEST_API_KEY);
    expect(bodyWasRead).toBe(false);
  });

  it("converts response stream read failures into a safe provider error", async () => {
    const responseBody = "provider-body-must-not-surface";
    const failingBody = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(responseBody);
      },
    });
    const fetch: OpenAiCompatibleFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: failingBody,
    });
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    const error = await provider.complete(createRequest(new AbortController().signal)).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({
      message: "LLM provider response body could not be read",
    });
    expect(String(error)).not.toContain(responseBody);
    expect(String(error)).not.toContain(TEST_API_KEY);
  });

  it("propagates an abort error from the injected fetch", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const fetch: OpenAiCompatibleFetch = async () => {
      throw abortError;
    };
    const provider = new OpenAiCompatibleLlmProvider({
      completionsUrl: COMPLETIONS_URL,
      apiKey: TEST_API_KEY,
      fetch,
    });

    await expect(provider.complete(createRequest(new AbortController().signal))).rejects.toBe(
      abortError,
    );
  });

  it.each([
    ["empty API key", { completionsUrl: COMPLETIONS_URL, apiKey: "   " }],
    ["non-HTTPS URL", { completionsUrl: "http://provider.example.test/v1/chat/completions", apiKey: TEST_API_KEY }],
    ["invalid URL", { completionsUrl: "not a URL", apiKey: TEST_API_KEY }],
  ])("rejects a %s without exposing the key", (_caseName, options) => {
    const createProvider = () => new OpenAiCompatibleLlmProvider(options);

    expect(createProvider).toThrowError();
    try {
      createProvider();
    } catch (error) {
      expect(String(error)).not.toContain(TEST_API_KEY);
    }
  });
});
