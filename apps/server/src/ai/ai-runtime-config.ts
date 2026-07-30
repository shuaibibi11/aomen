import type { AiDecisionSourceFactory } from "../room-manager.js";
import { LlmPlayerAi } from "./llm-player-ai.js";
import {
  OpenAiCompatibleLlmProvider,
  type OpenAiCompatibleFetch,
} from "./openai-compatible-llm-provider.js";

export const DEFAULT_LLM_COMPLETIONS_URL =
  "https://platform.rainflowtb.com/v1/chat/completions";
export const DEFAULT_LLM_MODEL = "deepseek-chat";
export const DEFAULT_LLM_TIMEOUT_MS = 4_500;
export const MAX_LLM_TIMEOUT_MS = 60_000;

/** Environment values accepted by server startup configuration. */
export type AiRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface BasicAiRuntimeConfig {
  readonly mode: "basic";
}

export interface LlmAiRuntimeConfig {
  readonly mode: "llm";
  readonly apiKey: string;
  readonly completionsUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export type AiRuntimeConfig = BasicAiRuntimeConfig | LlmAiRuntimeConfig;

export interface CreateAiDecisionSourceFactoryOptions {
  readonly fetch?: OpenAiCompatibleFetch;
}

function requireNonEmptyValue(value: string | undefined, errorMessage: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(errorMessage);
  }
  return value.trim();
}

function validateHttpsUrl(completionsUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(completionsUrl);
  } catch {
    throw new Error("LLM_COMPLETIONS_URL must be a valid HTTPS URL");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("LLM_COMPLETIONS_URL must be a valid HTTPS URL");
  }

  return completionsUrl;
}

function parseTimeoutMilliseconds(value: string | undefined): number {
  const rawTimeout = value ?? String(DEFAULT_LLM_TIMEOUT_MS);
  const normalizedTimeout = rawTimeout.trim();
  if (!/^\d+$/.test(normalizedTimeout)) {
    throw new Error(
      `LLM_TIMEOUT_MS must be a positive safe integer no greater than ${MAX_LLM_TIMEOUT_MS}`,
    );
  }

  const timeoutMilliseconds = Number(normalizedTimeout);
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0 ||
    timeoutMilliseconds > MAX_LLM_TIMEOUT_MS
  ) {
    throw new Error(
      `LLM_TIMEOUT_MS must be a positive safe integer no greater than ${MAX_LLM_TIMEOUT_MS}`,
    );
  }

  return timeoutMilliseconds;
}

/**
 * Parses all AI runtime settings from server-only environment values. No
 * configuration is written to rooms, events, clients, or browser bundles.
 */
export function resolveAiRuntimeConfig(
  environment: AiRuntimeEnvironment,
): AiRuntimeConfig {
  const mode = environment.AI_MODE;
  if (mode === undefined || mode === "basic") {
    return { mode: "basic" };
  }

  if (mode !== "llm") {
    throw new Error("AI_MODE must be either basic or llm");
  }

  const apiKey = requireNonEmptyValue(
    environment.LLM_API_KEY,
    "LLM_API_KEY must be configured when AI_MODE=llm",
  );
  const completionsUrl = validateHttpsUrl(
    environment.LLM_COMPLETIONS_URL ?? DEFAULT_LLM_COMPLETIONS_URL,
  );
  const model = requireNonEmptyValue(
    environment.LLM_MODEL ?? DEFAULT_LLM_MODEL,
    "LLM_MODEL must be configured when AI_MODE=llm",
  );
  const timeoutMs = parseTimeoutMilliseconds(environment.LLM_TIMEOUT_MS);

  return {
    mode: "llm",
    apiKey,
    completionsUrl,
    model,
    timeoutMs,
  };
}

/**
 * Creates per-seat LLM decision sources while retaining one shared provider.
 * LlmPlayerAi keeps its existing BasicPlayerAi fallback for provider failures.
 */
export function createAiDecisionSourceFactory(
  runtimeConfig: AiRuntimeConfig,
  options: CreateAiDecisionSourceFactoryOptions = {},
): AiDecisionSourceFactory | undefined {
  if (runtimeConfig.mode === "basic") {
    return undefined;
  }

  const provider = new OpenAiCompatibleLlmProvider({
    completionsUrl: runtimeConfig.completionsUrl,
    apiKey: runtimeConfig.apiKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return ({ rulePack, seed }) => new LlmPlayerAi({
    provider,
    model: runtimeConfig.model,
    rulePack,
    seed,
    timeoutMs: runtimeConfig.timeoutMs,
  });
}
