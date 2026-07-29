export type LlmMessageRole = "system" | "user" | "assistant";

export interface LlmMessage {
  readonly role: LlmMessageRole;
  readonly content: string;
}

export interface LlmUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface LlmCompletionRequest {
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly signal: AbortSignal;
}

export interface LlmCompletionResponse {
  readonly content: string;
  readonly usage?: LlmUsage;
  readonly providerRequestId?: string;
}

/** Provider-neutral text completion boundary. */
export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}
