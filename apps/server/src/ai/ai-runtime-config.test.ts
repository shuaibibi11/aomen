import { describe, expect, it } from "vitest";
import type { RulePack } from "@mct/rule-packs";
import { LlmPlayerAi } from "./llm-player-ai.js";
import {
  DEFAULT_LLM_COMPLETIONS_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  createAiDecisionSourceFactory,
  resolveAiRuntimeConfig,
} from "./ai-runtime-config.js";
import type { OpenAiCompatibleFetch } from "./openai-compatible-llm-provider.js";
import type { PlayerDecisionContext } from "./player-decision-context.js";

const TEST_API_KEY = "test-only-key";

function createRulePack(): RulePack {
  return {
    id: "std",
    version: "1.0.0",
    displayName: "Standard",
    variant: "standard",
    limits: { min: 100, max: 1_000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  };
}

function createContext(): PlayerDecisionContext {
  return {
    phase: "round_betting",
    round: "round-public-7",
    stack: 600,
    allowedBetKinds: ["player", "banker", "tie"],
    limits: { min: 100, max: 1_000 },
    publicHistory: {
      completedRounds: 3,
      recentOutcomes: ["player"],
      currentBetTotals: [],
    },
  };
}

function createLlmEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    AI_MODE: "llm",
    LLM_API_KEY: TEST_API_KEY,
    ...overrides,
  };
}

describe("resolveAiRuntimeConfig", () => {
  it("uses Basic AI when AI_MODE is absent or explicitly basic", () => {
    expect(resolveAiRuntimeConfig({})).toEqual({ mode: "basic" });
    expect(resolveAiRuntimeConfig({ AI_MODE: "basic" })).toEqual({ mode: "basic" });
  });

  it.each(["", "   ", "\t", "basic ", " llm", "LLM", "openai", "basic-ai", "llm "])(
    "rejects the defined but invalid AI_MODE %j without exposing secrets",
    (mode) => {
      const error = (() => {
        try {
          resolveAiRuntimeConfig({ AI_MODE: mode, LLM_API_KEY: TEST_API_KEY });
        } catch (caughtError) {
          return caughtError;
        }
        throw new Error("Expected runtime configuration to reject");
      })();

      expect(error).toMatchObject({ message: "AI_MODE must be either basic or llm" });
      expect(String(error)).not.toContain(TEST_API_KEY);
    },
  );

  it("applies the OpenAI-compatible LLM defaults", () => {
    expect(resolveAiRuntimeConfig(createLlmEnvironment())).toEqual({
      mode: "llm",
      apiKey: TEST_API_KEY,
      completionsUrl: DEFAULT_LLM_COMPLETIONS_URL,
      model: DEFAULT_LLM_MODEL,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
    });
  });

  it("rejects a missing LLM key without including environment values", () => {
    const error = (() => {
      try {
        resolveAiRuntimeConfig({ AI_MODE: "llm" });
      } catch (caughtError) {
        return caughtError;
      }
      throw new Error("Expected runtime configuration to reject");
    })();

    expect(error).toMatchObject({ message: "LLM_API_KEY must be configured when AI_MODE=llm" });
    expect(String(error)).not.toContain(TEST_API_KEY);
  });

  it.each([
    ["non-HTTPS completions URL", { LLM_COMPLETIONS_URL: "http://provider.example.test/v1/chat/completions" }],
    ["malformed completions URL", { LLM_COMPLETIONS_URL: "not a URL" }],
    ["empty model", { LLM_MODEL: "   " }],
    ["zero timeout", { LLM_TIMEOUT_MS: "0" }],
    ["fractional timeout", { LLM_TIMEOUT_MS: "4.5" }],
    ["oversized timeout", { LLM_TIMEOUT_MS: "60001" }],
  ])("rejects a %s", (_caseName, overrides) => {
    const error = (() => {
      try {
        resolveAiRuntimeConfig(createLlmEnvironment(overrides));
      } catch (caughtError) {
        return caughtError;
      }
      throw new Error("Expected runtime configuration to reject");
    })();

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(TEST_API_KEY);
  });
});

describe("createAiDecisionSourceFactory", () => {
  it("returns undefined for Basic runtime configuration", () => {
    expect(createAiDecisionSourceFactory({ mode: "basic" })).toBeUndefined();
  });

  it("creates LLM decision sources with one injected provider and Basic fallback", async () => {
    const fetchCalls: string[] = [];
    const fetch: OpenAiCompatibleFetch = async (url) => {
      fetchCalls.push(url);
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({ error: "not read" }),
      };
    };
    const factory = createAiDecisionSourceFactory(
      resolveAiRuntimeConfig(createLlmEnvironment()),
      { fetch },
    );
    const rulePack = createRulePack();
    const firstDecisionSource = factory?.({ index: 1, seed: "seat-one", rulePack });
    const secondDecisionSource = factory?.({ index: 2, seed: "seat-two", rulePack });

    expect(firstDecisionSource).toBeInstanceOf(LlmPlayerAi);
    expect(secondDecisionSource).toBeInstanceOf(LlmPlayerAi);
    await expect(
      firstDecisionSource?.decideBet(createContext(), new AbortController().signal),
    ).resolves.toEqual(expect.objectContaining({ amount: 100 }));
    await expect(
      secondDecisionSource?.decideBet(createContext(), new AbortController().signal),
    ).resolves.toEqual(expect.objectContaining({ amount: 100 }));
    expect(fetchCalls).toEqual([
      DEFAULT_LLM_COMPLETIONS_URL,
      DEFAULT_LLM_COMPLETIONS_URL,
    ]);
  });
});
