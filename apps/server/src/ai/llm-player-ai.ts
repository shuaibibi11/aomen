import { BET_KINDS, type BetKind } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { BasicPlayerAi } from "./basic-player-ai.js";
import type {
  LlmCompletionResponse,
  LlmProvider,
  LlmUsage,
} from "./llm-provider.js";
import type { PlayerDecisionContext } from "./player-decision-context.js";
import type {
  PlayerBetDecision,
  PlayerDecisionSource,
} from "./player-decision-source.js";

export interface TimerClock {
  now(): number;
  setTimeout(callback: () => void, delayMilliseconds: number): object;
  clearTimeout(timer: object): void;
}

export type LlmPlayerAiOutcome =
  | "accepted"
  | "sit_out"
  | "invalid_response"
  | "provider_error"
  | "fallback_error"
  | "timeout"
  | "aborted";

export interface LlmPlayerAiTelemetry {
  readonly model: string;
  readonly providerRequestId?: string;
  readonly latencyMs: number;
  readonly outcome: LlmPlayerAiOutcome;
  readonly usage?: LlmUsage;
}

export interface LlmPlayerAiOptions {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly rulePack: RulePack;
  readonly seed: string;
  readonly timeoutMs: number;
  readonly fallback?: PlayerDecisionSource;
  readonly timerClock?: TimerClock;
  readonly onTelemetry?: (event: LlmPlayerAiTelemetry) => void;
}

class LlmRequestTimeoutError extends Error {
  constructor() {
    super("LLM provider request timed out");
    this.name = "LlmRequestTimeoutError";
  }
}

const SYSTEM_INSTRUCTION = [
  "Choose one baccarat wagering action from the supplied public state.",
  "Return exactly one JSON object and no markdown.",
  'Use either {"action":"sit_out"} or',
  '{"action":"bet","betKind":"<allowed kind>","amount":<number>}.',
  "Do not add any other properties.",
].join(" ");

const DEFAULT_TIMER_CLOCK: TimerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMilliseconds) =>
    globalThis.setTimeout(callback, delayMilliseconds),
  clearTimeout: (timer) =>
    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
};

const MAX_PROVIDER_REQUEST_ID_LENGTH = 128;
const PROVIDER_REQUEST_ID_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const USAGE_FIELD_NAMES = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
] as const satisfies readonly (keyof LlmUsage)[];

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeProviderRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sanitizedValue = value
    .replace(PROVIDER_REQUEST_ID_CONTROL_CHARACTERS, "")
    .slice(0, MAX_PROVIDER_REQUEST_ID_LENGTH);
  return sanitizedValue.length === 0 ? undefined : sanitizedValue;
}

function sanitizeUsage(value: unknown): LlmUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitizedUsage: Record<string, number> = {};
  for (const fieldName of USAGE_FIELD_NAMES) {
    const fieldValue = value[fieldName];
    if (
      typeof fieldValue === "number" &&
      Number.isSafeInteger(fieldValue) &&
      fieldValue >= 0
    ) {
      sanitizedUsage[fieldName] = fieldValue;
    }
  }

  return Object.keys(sanitizedUsage).length === 0 ? undefined : sanitizedUsage;
}

function hasExactKeys(
  candidate: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const candidateKeys = Object.keys(candidate).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return candidateKeys.length === sortedExpectedKeys.length &&
    candidateKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isBetKind(value: unknown): value is BetKind {
  return typeof value === "string" && BET_KINDS.includes(value as BetKind);
}

/** Converts provider-neutral completions into validated player decisions. */
export class LlmPlayerAi implements PlayerDecisionSource {
  private readonly fallback: PlayerDecisionSource;
  private readonly timerClock: TimerClock;

  constructor(private readonly options: LlmPlayerAiOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
      throw new Error("LLM timeout must be finite and non-negative");
    }
    this.fallback = options.fallback ?? new BasicPlayerAi({
      rulePack: options.rulePack,
      seed: options.seed,
    });
    this.timerClock = options.timerClock ?? DEFAULT_TIMER_CLOCK;
  }

  async decideBet(
    context: PlayerDecisionContext,
    signal: AbortSignal,
  ): Promise<PlayerBetDecision | null> {
    if (signal.aborted) {
      throw createAbortError();
    }

    const startedAt = this.timerClock.now();
    const providerController = new AbortController();
    const abortProvider = (): void => providerController.abort();
    signal.addEventListener("abort", abortProvider, { once: true });

    let response: LlmCompletionResponse | undefined;
    let timeoutTimer: object | undefined;
    let requestOutcome: LlmPlayerAiOutcome = "provider_error";
    let timedOut = false;

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutTimer = this.timerClock.setTimeout(() => {
          timedOut = true;
          reject(new LlmRequestTimeoutError());
          providerController.abort();
        }, this.options.timeoutMs);
      });
      response = await this.requestProvider(context, providerController.signal, timeoutPromise);

      const decision = this.parseDecision(response.content, context);
      if (decision === undefined) {
        requestOutcome = "invalid_response";
        return await this.decideWithFallback(context, signal, () => {
          requestOutcome = "fallback_error";
        });
      }

      requestOutcome = decision === null ? "sit_out" : "accepted";
      return decision;
    } catch (error) {
      if (signal.aborted) {
        requestOutcome = "aborted";
        throw createAbortError();
      }

      requestOutcome = timedOut || error instanceof LlmRequestTimeoutError
        ? "timeout"
        : "provider_error";
      return await this.decideWithFallback(context, signal, () => {
        requestOutcome = "fallback_error";
      });
    } finally {
      if (timeoutTimer !== undefined) {
        this.timerClock.clearTimeout(timeoutTimer);
      }
      signal.removeEventListener("abort", abortProvider);
      const providerRequestId = sanitizeProviderRequestId(response?.providerRequestId);
      const usage = sanitizeUsage(response?.usage);
      this.emitTelemetry({
        model: this.options.model,
        ...(providerRequestId === undefined ? {} : { providerRequestId }),
        latencyMs: Math.max(0, this.timerClock.now() - startedAt),
        outcome: requestOutcome,
        ...(usage === undefined ? {} : { usage }),
      });
    }
  }

  private requestProvider(
    context: PlayerDecisionContext,
    signal: AbortSignal,
    timeoutPromise: Promise<never>,
  ): Promise<LlmCompletionResponse> {
    const providerPromise = this.options.provider.complete({
      model: this.options.model,
      messages: this.createMessages(context),
      signal,
    });
    return Promise.race([providerPromise, timeoutPromise]);
  }

  private async decideWithFallback(
    context: PlayerDecisionContext,
    signal: AbortSignal,
    recordFallbackError: () => void,
  ): Promise<PlayerBetDecision | null> {
    if (signal.aborted) {
      throw createAbortError();
    }

    try {
      const fallbackDecision = await this.fallback.decideBet(context, signal);
      if (signal.aborted) {
        throw createAbortError();
      }
      return this.validateDecision(fallbackDecision, context) ? fallbackDecision : null;
    } catch (error) {
      if (signal.aborted) {
        throw createAbortError();
      }
      recordFallbackError();
      return null;
    }
  }

  private createMessages(context: PlayerDecisionContext) {
    const publicState = {
      phase: context.phase,
      round: context.round,
      stack: context.stack,
      allowedBetKinds: context.allowedBetKinds,
      limits: context.limits,
      publicHistory: context.publicHistory,
    };
    return [
      { role: "system" as const, content: SYSTEM_INSTRUCTION },
      { role: "user" as const, content: JSON.stringify(publicState) },
    ];
  }

  private parseDecision(
    content: string,
    context: PlayerDecisionContext,
  ): PlayerBetDecision | null | undefined {
    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch {
      return undefined;
    }

    if (!isRecord(candidate) || typeof candidate.action !== "string") {
      return undefined;
    }
    if (candidate.action === "sit_out") {
      return hasExactKeys(candidate, ["action"]) ? null : undefined;
    }
    if (
      candidate.action !== "bet" ||
      !hasExactKeys(candidate, ["action", "betKind", "amount"])
    ) {
      return undefined;
    }

    const decision = {
      betKind: candidate.betKind,
      amount: candidate.amount,
    };
    return this.validateDecision(decision, context) ? decision : undefined;
  }

  private validateDecision(
    candidate: unknown,
    context: PlayerDecisionContext,
  ): candidate is PlayerBetDecision | null {
    if (candidate === null) {
      return true;
    }
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["betKind", "amount"]) ||
      !isBetKind(candidate.betKind) ||
      !context.allowedBetKinds.includes(candidate.betKind) ||
      !this.isEnabledByRulePack(candidate.betKind) ||
      typeof candidate.amount !== "number" ||
      !Number.isFinite(candidate.amount) ||
      !Number.isInteger(candidate.amount) ||
      candidate.amount <= 0 ||
      candidate.amount < context.limits.min ||
      candidate.amount > context.limits.max ||
      candidate.amount < this.options.rulePack.limits.min ||
      candidate.amount > this.options.rulePack.limits.max ||
      candidate.amount > context.stack
    ) {
      return false;
    }
    return true;
  }

  private isEnabledByRulePack(betKind: BetKind): boolean {
    if (betKind === "player" || betKind === "banker" || betKind === "tie") {
      return true;
    }
    return this.options.rulePack.sideBets.some(
      (sideBet) => sideBet.kind === betKind,
    );
  }

  private emitTelemetry(event: LlmPlayerAiTelemetry): void {
    try {
      this.options.onTelemetry?.(event);
    } catch {
      // Observability must never interrupt room scheduling.
    }
  }
}
