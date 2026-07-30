import { describe, expect, it } from "vitest";
import {
  OpenAiCompatibleLlmProvider,
  type OpenAiCompatibleFetch,
  type OpenAiCompatibleFetchResponse,
} from "./openai-compatible-llm-provider.js";

const TEST_API_KEY = "test-only-key";
const COMPLETIONS_URL = "https://provider.example.test/v1/chat/completions";

function createResponse(
  overrides: Partial<OpenAiCompatibleFetchResponse> = {},
): OpenAiCompatibleFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      choices: [{ message: { content: '{"action":"sit_out"}' } }],
    }),
    ...overrides,
  };
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

describe("OpenAiCompatibleLlmProvider", () => {
  it("uses and restores a stubbed global fetch when no transport is injected", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{ url: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const stubbedGlobalFetch: typeof globalThis.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"action":"sit_out"}' } }] }),
        { status: 200 },
      );
    };
    const signal = new AbortController().signal;

    globalThis.fetch = stubbedGlobalFetch;
    try {
      const provider = new OpenAiCompatibleLlmProvider({
        completionsUrl: COMPLETIONS_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(provider.complete(createRequest(signal))).resolves.toEqual({
        content: '{"action":"sit_out"}',
      });
      expect(fetchCalls).toEqual([{
        url: COMPLETIONS_URL,
        init: expect.objectContaining({
          method: "POST",
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
      return createResponse();
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
    const fetch: OpenAiCompatibleFetch = async () => createResponse({
      headers: { get: (name) => name === "x-request-id" ? "request-42" : null },
      json: async () => ({
        choices: [{ message: { content: '{"action":"bet","betKind":"player","amount":100}' } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
          ignored: "value",
        },
      }),
    });
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
    const fetch: OpenAiCompatibleFetch = async () => createResponse({
      json: async () => ({
        choices: [{ message: { content: '{"action":"sit_out"}' } }],
        usage: {
          prompt_tokens: -1,
          completion_tokens: 2.5,
          total_tokens: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
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
    const fetch: OpenAiCompatibleFetch = async () => createResponse({
      json: async () => {
        throw new SyntaxError("response body must not escape");
      },
    });
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
    const fetch: OpenAiCompatibleFetch = async () => createResponse({
      json: async () => ({ choices: [{ message: { content: 42 } }], responseBody }),
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
    let jsonWasRead = false;
    const fetch: OpenAiCompatibleFetch = async () => createResponse({
      ok: false,
      status: 429,
      json: async () => {
        jsonWasRead = true;
        return { error: { message: "provider-body-must-not-surface" } };
      },
    });
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
    expect(jsonWasRead).toBe(false);
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
