import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
} from "./llm-provider.js";

export type FakeLlmProviderResult = LlmCompletionResponse | Error | "pending";

/** Scriptable provider used by server tests without any vendor SDK. */
export class FakeLlmProvider implements LlmProvider {
  readonly requests: LlmCompletionRequest[] = [];
  private nextResultIndex = 0;

  constructor(private readonly results: readonly FakeLlmProviderResult[]) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    this.requests.push(request);
    const result = this.results[this.nextResultIndex];
    this.nextResultIndex += 1;

    if (result === undefined) {
      throw new Error("FakeLlmProvider has no configured result");
    }
    if (result instanceof Error) {
      throw result;
    }
    if (result === "pending") {
      return new Promise<LlmCompletionResponse>((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(new DOMException("The request was aborted", "AbortError")),
          { once: true },
        );
      });
    }
    return result;
  }
}
