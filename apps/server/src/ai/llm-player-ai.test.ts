import { describe, expect, it, vi } from "vitest";
import type { RulePack } from "@mct/rule-packs";
import { FakeLlmProvider } from "./fake-llm-provider.js";
import {
  LlmPlayerAi,
  type LlmPlayerAiTelemetry,
  type TimerClock,
} from "./llm-player-ai.js";
import type { PlayerDecisionContext } from "./player-decision-context.js";

function createRulePack(): RulePack {
  return {
    id: "std",
    version: "1.0.0",
    displayName: "Standard",
    variant: "standard",
    limits: { min: 100, max: 1_000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [{ kind: "player_pair", payout: 11 }],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  };
}

function createContext(overrides: Partial<PlayerDecisionContext> = {}): PlayerDecisionContext {
  return {
    phase: "round_betting",
    round: "round-public-7",
    stack: 600,
    allowedBetKinds: ["player", "banker", "tie", "player_pair"],
    limits: { min: 100, max: 1_000 },
    publicHistory: {
      completedRounds: 3,
      recentOutcomes: ["player", "banker", "tie"],
      currentBetTotals: [
        { betKind: "player", amount: 300 },
        { betKind: "banker", amount: 100 },
      ],
    },
    ...overrides,
  };
}

function createAi(
  provider: FakeLlmProvider,
  overrides: Partial<ConstructorParameters<typeof LlmPlayerAi>[0]> = {},
): LlmPlayerAi {
  return new LlmPlayerAi({
    provider,
    model: "provider-neutral-model",
    rulePack: createRulePack(),
    seed: "fallback-seed",
    timeoutMs: 1_000,
    ...overrides,
  });
}

async function expectDeterministicFallback(
  content: string,
  context: PlayerDecisionContext = createContext(),
): Promise<void> {
  const provider = new FakeLlmProvider([{ content }]);
  const firstDecision = await createAi(provider).decideBet(
    context,
    new AbortController().signal,
  );
  const secondDecision = await createAi(new FakeLlmProvider([{ content }])).decideBet(
    context,
    new AbortController().signal,
  );

  expect(firstDecision).toEqual(secondDecision);
  expect(firstDecision).toEqual(expect.objectContaining({ amount: 100 }));
}

class ManualTimerClock implements TimerClock {
  private callback: (() => void) | null = null;
  private currentTime = 50;

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, _delayMilliseconds: number): object {
    this.callback = callback;
    return {};
  }

  clearTimeout(_timer: object): void {
    this.callback = null;
  }

  expire(): void {
    this.currentTime += 1_000;
    const callback = this.callback;
    this.callback = null;
    callback?.();
  }
}

describe("LlmPlayerAi", () => {
  it("accepts a legal strict JSON bet candidate", async () => {
    const provider = new FakeLlmProvider([{
      content: '{"action":"bet","betKind":"player_pair","amount":200}',
      providerRequestId: "request-1",
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    }]);

    const decision = await createAi(provider).decideBet(
      createContext(),
      new AbortController().signal,
    );

    expect(decision).toEqual({ betKind: "player_pair", amount: 200 });
  });

  it("returns null for a strict sit_out candidate", async () => {
    const provider = new FakeLlmProvider([{ content: '{"action":"sit_out"}' }]);

    await expect(
      createAi(provider).decideBet(createContext(), new AbortController().signal),
    ).resolves.toBeNull();
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["unknown action", '{"action":"double_down"}'],
    ["illegal bet kind", '{"action":"bet","betKind":"dragon","amount":100}'],
    ["disabled side bet", '{"action":"bet","betKind":"banker_pair","amount":100}'],
    ["below minimum", '{"action":"bet","betKind":"player","amount":99}'],
    ["above maximum", '{"action":"bet","betKind":"player","amount":1001}'],
    ["insufficient stack", '{"action":"bet","betKind":"player","amount":700}'],
    ["fractional amount", '{"action":"bet","betKind":"player","amount":100.5}'],
    ["zero amount", '{"action":"bet","betKind":"player","amount":0}'],
    ["negative amount", '{"action":"bet","betKind":"player","amount":-100}'],
    ["non-finite amount", '{"action":"bet","betKind":"player","amount":"Infinity"}'],
    ["unexpected identity", '{"action":"bet","betKind":"player","amount":100,"actorId":"x"}'],
  ])("uses deterministic Basic fallback for %s", async (_caseName, content) => {
    await expectDeterministicFallback(content);
  });

  it("enforces authoritative rule-pack limits even if context is broader", async () => {
    const context = createContext({
      stack: 5_000,
      limits: { min: 1, max: 5_000 },
    });
    const provider = new FakeLlmProvider([{
      content: '{"action":"bet","betKind":"player","amount":1500}',
    }]);

    const decision = await createAi(provider).decideBet(
      context,
      new AbortController().signal,
    );

    expect(decision).toEqual(expect.objectContaining({ amount: 100 }));
  });

  it("uses deterministic fallback when the provider throws", async () => {
    const provider = new FakeLlmProvider([new Error("provider unavailable")]);

    const decision = await createAi(provider).decideBet(
      createContext(),
      new AbortController().signal,
    );

    expect(decision).toEqual(expect.objectContaining({ amount: 100 }));
  });

  it("aborts a timed-out provider request and uses fallback without real waiting", async () => {
    const timerClock = new ManualTimerClock();
    const provider = new FakeLlmProvider(["pending"]);
    const telemetryEvents: LlmPlayerAiTelemetry[] = [];
    const decisionPromise = createAi(provider, {
      timerClock,
      onTelemetry: (event) => telemetryEvents.push(event),
    }).decideBet(
      createContext(),
      new AbortController().signal,
    );

    await Promise.resolve();
    timerClock.expire();

    await expect(decisionPromise).resolves.toEqual(
      expect.objectContaining({ amount: 100 }),
    );
    expect(provider.requests[0]?.signal.aborted).toBe(true);
    expect(telemetryEvents).toEqual([
      expect.objectContaining({ outcome: "timeout" }),
    ]);
  });

  it("ends on external abort without invoking fallback", async () => {
    const provider = new FakeLlmProvider(["pending"]);
    const fallback = { decideBet: vi.fn(async () => ({ betKind: "player" as const, amount: 100 })) };
    const controller = new AbortController();
    const decisionPromise = createAi(provider, { fallback }).decideBet(
      createContext(),
      controller.signal,
    );

    await Promise.resolve();
    controller.abort();

    await expect(decisionPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback.decideBet).not.toHaveBeenCalled();
    expect(provider.requests[0]?.signal.aborted).toBe(true);
  });

  it("builds a prompt from public aggregate context only", async () => {
    const provider = new FakeLlmProvider([{ content: '{"action":"sit_out"}' }]);
    await createAi(provider).decideBet(
      createContext(),
      new AbortController().signal,
    );

    const prompt = provider.requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("round-public-7");
    expect(prompt).toContain("currentBetTotals");
    expect(prompt).toContain("player_pair");
    expect(prompt).not.toMatch(/hands|cards|credential|actorId|seatId|occupant/i);
  });

  it("emits only allowlisted telemetry fields", async () => {
    const telemetryEvents: LlmPlayerAiTelemetry[] = [];
    const provider = new FakeLlmProvider([{
      content: '{"action":"bet","betKind":"banker","amount":100}',
      providerRequestId: "safe-request-id",
      usage: { totalTokens: 12 },
    }]);
    await createAi(provider, {
      onTelemetry: (event) => telemetryEvents.push(event),
    }).decideBet(createContext(), new AbortController().signal);

    expect(telemetryEvents).toEqual([{
      model: "provider-neutral-model",
      providerRequestId: "safe-request-id",
      latencyMs: expect.any(Number),
      outcome: "accepted",
      usage: { totalTokens: 12 },
    }]);
    const serializedTelemetry = JSON.stringify(telemetryEvents);
    expect(serializedTelemetry).not.toMatch(/prompt|content|credential|actorId|seatId/i);
  });
});
