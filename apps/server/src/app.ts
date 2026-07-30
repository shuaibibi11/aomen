/**
 * Server application assembly.
 *
 * Wires the pieces together: one event store, one room manager, and — for a
 * no-human-dealer table — a phase scheduler that drives rounds. Kept apart
 * from the entry point so a test can build the app without opening a port.
 */
import { asActorId, asTableId, type TableId } from "@mct/shared";
import { loadRulePack } from "@mct/rule-packs";
import {
  createAiDecisionSourceFactory,
  resolveAiRuntimeConfig,
  type AiRuntimeEnvironment,
} from "./ai/ai-runtime-config.js";
import type { OpenAiCompatibleFetch } from "./ai/openai-compatible-llm-provider.js";
import { MemoryEventStore } from "./memory-event-store.js";
import {
  RoomManager,
  type AiDecisionSourceFactory,
  type Room,
} from "./room-manager.js";
import {
  AutomaticRoundScheduler,
  type AutomaticRoundTiming,
} from "./automatic-round-scheduler.js";

export const DEFAULT_AUTOMATIC_ROUND_TIMING: AutomaticRoundTiming = {
  bettingWindowMs: 8_000,
  cardDealIntervalMs: 1_000,
  settlementDisplayMs: 3_000,
  interRoundDelayMs: 1_000,
};

export interface AppOptions {
  /** Server-only environment values; defaults to the process environment. */
  readonly environment?: AiRuntimeEnvironment;
  /** Relative path of the rule pack to load for the demo table. */
  readonly rulePackPath?: string;
  /** Table id for the demo room. */
  readonly tableId?: string;
  /** Shoe seed for the demo room. */
  readonly shoeSeed?: string;
  /** Credential required by clients joining the demo human actor. */
  readonly demoRoomCredential?: string;
  /** Phase durations for the automatic demo table. */
  readonly automaticRoundTiming?: AutomaticRoundTiming;
  /** Optional provider-neutral AI source factory for the demo seats. */
  readonly aiDecisionSourceFactory?: AiDecisionSourceFactory;
  /** Injectable HTTP transport used only by configured LLM decision sources. */
  readonly llmFetch?: OpenAiCompatibleFetch;
}

export interface App {
  readonly store: MemoryEventStore;
  readonly roomManager: RoomManager;
  readonly demoTableId: TableId;
  readonly demoRoom: Room;
  readonly demoScheduler: AutomaticRoundScheduler;
  readonly automaticRoundTiming: AutomaticRoundTiming;
}

function resolveDemoRoomCredential(
  options: AppOptions,
  environment: AiRuntimeEnvironment,
): string {
  const configuredCredential =
    options.demoRoomCredential ?? environment.DEMO_ROOM_CREDENTIAL;

  if (configuredCredential === undefined || configuredCredential.trim() === "") {
    throw new Error(
      "Demo room join credential must be configured through AppOptions or DEMO_ROOM_CREDENTIAL",
    );
  }

  return configuredCredential;
}

/**
 * Build the app with one demo room seated with a human plus two basic AI. The
 * demo room's dealer is the system dealer, so rounds can be driven by the
 * scheduler or by explicit calls without a human dealer present.
 */
export async function createApp(options: AppOptions = {}): Promise<App> {
  const environment = options.environment ?? process.env;
  const demoRoomCredential = resolveDemoRoomCredential(options, environment);
  const aiDecisionSourceFactory = options.aiDecisionSourceFactory ??
    createAiDecisionSourceFactory(resolveAiRuntimeConfig(environment), {
      ...(options.llmFetch === undefined ? {} : { fetch: options.llmFetch }),
    });
  const store = new MemoryEventStore();
  const roomManager = new RoomManager(store);

  const rulePack = await loadRulePack(
    options.rulePackPath ?? "dev/generic-macau-baccarat.v1.json",
  );

  const demoTableId = asTableId(options.tableId ?? "demo-table");
  const demoRoom = roomManager.createRoom({
    tableId: demoTableId,
    rulePack,
    humanActorId: asActorId("demo-human"),
    joinCredential: demoRoomCredential,
    seatCount: 7,
    aiCount: 2,
    shoeSeed: options.shoeSeed ?? "demo-seed",
    ...(aiDecisionSourceFactory === undefined
      ? {}
      : { aiDecisionSourceFactory }),
  });
  const automaticRoundTiming =
    options.automaticRoundTiming ?? DEFAULT_AUTOMATIC_ROUND_TIMING;
  const demoScheduler = new AutomaticRoundScheduler(
    demoRoom,
    automaticRoundTiming,
  );

  return {
    store,
    roomManager,
    demoTableId,
    demoRoom,
    demoScheduler,
    automaticRoundTiming,
  };
}
