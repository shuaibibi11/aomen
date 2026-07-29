/**
 * Room manager.
 *
 * A room wraps one TableRuntime with the actors around it: a human dealer or a
 * system dealer, a human guest, and enough basic AI to fill the remaining
 * seats. It funds every seat at creation so a later place-bet is never rejected
 * for an empty stack, and it appends every accepted engine event to the store.
 *
 * The manager is transport-agnostic: it advances a round through direct method
 * calls, so it can be unit-tested without opening a socket. The WS gateway is a
 * thin layer on top.
 */
import {
  asActorId,
  asSeatId,
  SYSTEM_DEALER,
  type ActorId,
  type RoundId,
  type SeatId,
  type TableEvent,
  type TableId,
  type TableIntent,
  type TableSnapshot,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { TableRuntime, createShoe } from "@mct/table-engine";
import { BasicPlayerAi } from "./ai/basic-player-ai.js";
import type { EventStore } from "./memory-event-store.js";
import type {
  RoomUpdate,
  RoomUpdateListener,
  UnsubscribeRoomUpdates,
} from "./room-events.js";

type AiBetDecision = Awaited<ReturnType<BasicPlayerAi["decideBet"]>>;

interface AiDecisionCacheEntry {
  readonly decisionPromise: Promise<AiBetDecision>;
}

export interface CreateRoomOptions {
  readonly tableId: TableId;
  readonly rulePack: RulePack;
  /** The human guest's actor id; seated at the first seat. */
  readonly humanActorId: ActorId;
  /** Credential required together with the human actor id when joining. */
  readonly joinCredential: string;
  /** How many seats the table has in total. */
  readonly seatCount: number;
  /** How many of the seats (after the human) are filled by basic AI. */
  readonly aiCount: number;
  /** Shoe seed, so the room's card order is reproducible. */
  readonly shoeSeed: string;
  /** Buy-in granted to every seat at creation, in training chips. */
  readonly startingStack?: number;
}

interface SeatedAi {
  readonly actorId: ActorId;
  readonly seatId: SeatId;
  readonly ai: BasicPlayerAi;
}

export interface RoomListenerErrorContext {
  readonly tableId: TableId;
  readonly update: RoomUpdate;
}

export interface RoomManagerOptions {
  readonly onListenerError?: (
    error: unknown,
    context: RoomListenerErrorContext,
  ) => void;
}

/**
 * Raised once a room can no longer guarantee agreement between runtime state
 * and its event log.
 */
export class RoomFaultedError extends Error {
  constructor(
    readonly tableId: TableId,
    readonly rootCause: unknown,
  ) {
    super(`Room ${tableId} is faulted and cannot process operations`);
    this.name = "RoomFaultedError";
  }
}

/**
 * One live room: a runtime, its dealer, its seated actors and their AI.
 *
 * The dealer is the system dealer, so the room can drive deal/settle itself in
 * a tick without waiting on a human.
 */
export class Room {
  private readonly runtime: TableRuntime;
  private readonly humanSeatId: SeatId;
  private readonly humanActorId: ActorId;
  private readonly joinCredential: string;
  private readonly allowedClientActorIds: ReadonlySet<ActorId>;
  private readonly aiSeats: readonly SeatedAi[];
  private readonly store: EventStore;
  private readonly aiDecisionCache = new Map<string, AiDecisionCacheEntry>();
  private cacheRoundId: RoundId | null = null;
  private fault: RoomFaultedError | null = null;

  constructor(
    options: CreateRoomOptions,
    store: EventStore,
    private readonly publishUpdate: RoomUpdateListener,
  ) {
    this.store = store;
    this.humanActorId = options.humanActorId;
    this.joinCredential = options.joinCredential;
    this.allowedClientActorIds = new Set([options.humanActorId]);

    const seatIds = Array.from({ length: options.seatCount }, (_unused, index) =>
      asSeatId(`${options.tableId}-seat-${index + 1}`),
    );
    const humanSeatId = seatIds[0];
    if (humanSeatId === undefined) {
      throw new Error("A room needs at least one seat");
    }
    this.humanSeatId = humanSeatId;

    const shoe = createShoe({
      seed: options.shoeSeed,
      deckCount: options.rulePack.shoe.deckCount,
    });

    this.runtime = new TableRuntime({
      tableId: options.tableId,
      rulePack: options.rulePack,
      dealerId: SYSTEM_DEALER,
      seatIds,
      drawCard: () => shoe.draw(),
    });
    this.cacheRoundId = this.runtime.getSnapshot().roundId;

    // Fill seats after the human with basic AI, up to the requested count.
    const aiSeats: SeatedAi[] = [];
    for (let index = 1; index <= options.aiCount && index < seatIds.length; index += 1) {
      const seatId = seatIds[index];
      if (seatId === undefined) {
        continue;
      }
      const actorId = asActorId(`${options.tableId}-ai-${index}`);
      aiSeats.push({
        actorId,
        seatId,
        ai: new BasicPlayerAi({
          actorId,
          seatId,
          rulePack: options.rulePack,
          seed: `${options.shoeSeed}-ai-${index}`,
        }),
      });
    }
    this.aiSeats = aiSeats;

    // Fund every occupied seat so a later bet is never rejected for an empty
    // stack. Buy-in is a real intent, so the event log records the funding.
    const startingStack = options.startingStack ?? options.rulePack.limits.min * 100;
    this.applyIntentAndStore({
      type: "buy_in",
      actorId: options.humanActorId,
      seatId: humanSeatId,
      amount: startingStack,
    });
    for (const seated of this.aiSeats) {
      this.applyIntentAndStore({
        type: "buy_in",
        actorId: seated.actorId,
        seatId: seated.seatId,
        amount: startingStack,
      });
    }
  }

  /** Submit an intent to the runtime and append the resulting event. */
  private applyIntentAndStore(
    intent: Parameters<TableRuntime["submitIntent"]>[0],
  ): TableEvent {
    this.assertOperational();
    const event = this.runtime.submitIntent(intent);
    try {
      this.store.append(event);
    } catch (error) {
      // The in-memory runtime mutates before append and has no rollback. Fail
      // stop permanently rather than serving a state that diverged from the
      // authoritative event log. A persistent engine should use a transaction
      // or transactional outbox before replacing this model.
      this.aiDecisionCache.clear();
      this.fault = new RoomFaultedError(event.tableId, error);
      throw this.fault;
    }
    const snapshot = this.runtime.getSnapshot();
    this.synchronizeAiDecisionCache(snapshot.roundId);
    if (event.seq !== snapshot.lastEventSeq) {
      throw new Error(
        `Room update sequence mismatch: event ${event.seq}, snapshot ${snapshot.lastEventSeq}`,
      );
    }
    // Rejected engine submissions are authoritative events too. Publishing
    // both event and snapshot lets every client inspect accepted/rejectReason.
    this.publishUpdate({ event, snapshot });
    return event;
  }

  /** Apply a lifecycle intent and stop before later automation on rejection. */
  private applyAutomaticIntent(
    intent: Parameters<TableRuntime["submitIntent"]>[0],
  ): TableEvent {
    const event = this.applyIntentAndStore(intent);
    if (event.accepted !== true) {
      const rejectReason = event.rejectReason ?? "unknown_reject_reason";
      throw new Error(
        `Automatic round intent ${intent.type} was rejected: ${rejectReason}`,
      );
    }
    return event;
  }

  /** Public passthrough for externally submitted intents (e.g. from a socket). */
  submitIntent(
    intent: Parameters<TableRuntime["submitIntent"]>[0],
  ): TableEvent {
    return this.applyIntentAndStore(intent);
  }

  getSnapshot(): TableSnapshot {
    return this.runtime.getSnapshot();
  }

  getHumanSeatId(): SeatId {
    return this.humanSeatId;
  }

  isFaulted(): boolean {
    return this.fault !== null;
  }

  private assertOperational(): void {
    if (this.fault !== null) {
      throw this.fault;
    }
  }

  /** Drop decisions as soon as the runtime advances to another round. */
  private synchronizeAiDecisionCache(roundId: RoundId): void {
    if (this.cacheRoundId === roundId) {
      return;
    }

    this.aiDecisionCache.clear();
    this.cacheRoundId = roundId;
  }

  /** Whether an ordinary client socket may bind to this actor identity. */
  canClientJoin(actorId: ActorId, credential: string): boolean {
    return (
      !this.isFaulted() &&
      actorId === this.humanActorId &&
      this.allowedClientActorIds.has(actorId) &&
      credential === this.joinCredential
    );
  }

  /**
   * Authorize an intent arriving from an ordinary client socket.
   *
   * Socket clients can only perform player actions as the room's human actor,
   * and those actions are confined to the human seat. Dealer lifecycle intents
   * and every AI seat remain server-controlled.
   */
  isClientIntentAllowed(intent: TableIntent): boolean {
    if (
      intent.actorId !== this.humanActorId ||
      !this.allowedClientActorIds.has(intent.actorId)
    ) {
      return false;
    }

    switch (intent.type) {
      case "buy_in":
      case "place_bet":
      case "clear_bets":
      case "cash_out":
        return intent.seatId === this.humanSeatId;
      case "start_round":
      case "no_more_bets":
      case "deal_next":
      case "reveal":
      case "settle_round":
        return false;
    }
  }

  /** Open a new system-dealt round and its betting window. */
  startAutomaticRound(): void {
    this.applyAutomaticIntent({ type: "start_round", actorId: SYSTEM_DEALER });
  }

  /** Ask each seated AI for its bet while betting remains open. */
  async placeAutomaticPlayerBets(signal: AbortSignal): Promise<void> {
    for (const seated of this.aiSeats) {
      const snapshotBeforeDecision = this.runtime.getSnapshot();
      this.synchronizeAiDecisionCache(snapshotBeforeDecision.roundId);
      if (signal.aborted || snapshotBeforeDecision.phase !== "round_betting") {
        return;
      }
      if (snapshotBeforeDecision.bets.some((bet) => bet.seatId === seated.seatId)) {
        continue;
      }

      const decisionRoundId = snapshotBeforeDecision.roundId;
      const decisionKey = seated.seatId;
      let decisionEntry = this.aiDecisionCache.get(decisionKey);
      if (decisionEntry === undefined) {
        const decisionPromise = Promise.resolve().then(() => seated.ai.decideBet());
        decisionEntry = { decisionPromise };
        this.aiDecisionCache.set(decisionKey, decisionEntry);
      }

      const bet = await decisionEntry.decisionPromise;
      const snapshotAfterDecision = this.runtime.getSnapshot();
      this.synchronizeAiDecisionCache(snapshotAfterDecision.roundId);
      if (
        signal.aborted ||
        snapshotAfterDecision.phase !== "round_betting" ||
        snapshotAfterDecision.roundId !== decisionRoundId
      ) {
        return;
      }
      if (snapshotAfterDecision.bets.some((placedBet) => placedBet.seatId === seated.seatId)) {
        continue;
      }
      if (bet !== null) {
        this.applyAutomaticIntent(bet);
      }
    }
  }

  /** Close the betting window using the authoritative system dealer intent. */
  closeAutomaticBetting(): void {
    this.applyAutomaticIntent({ type: "no_more_bets", actorId: SYSTEM_DEALER });
  }

  /** Deal exactly one card through the table runtime. */
  dealNextAutomaticCard(): void {
    this.applyAutomaticIntent({ type: "deal_next", actorId: SYSTEM_DEALER });
  }

  /** Settle the completed hand through the table runtime. */
  settleAutomaticRound(): void {
    this.applyAutomaticIntent({ type: "settle_round", actorId: SYSTEM_DEALER });
  }

  getAutomaticRoundPhase(): TableSnapshot["phase"] {
    return this.runtime.getSnapshot().phase;
  }

  /**
   * Advance one full round with the system dealer driving:
   * start → AI bets → no-more-bets → deal to completion → settle.
   *
   * A human's bets are expected to have been submitted during the betting
   * window in a live setting; here the tick opens and closes betting itself so
  * a round can be driven end to end without a socket.
   */
  playAutomaticRound(): void {
    this.startAutomaticRound();
    for (const seated of this.aiSeats) {
      const bet = seated.ai.decideBet();
      if (bet !== null) {
        this.applyAutomaticIntent(bet);
      }
    }
    this.closeAutomaticBetting();

    // Deal until the runtime leaves the dealing phase.
    let guard = 0;
    this.dealNextAutomaticCard();
    while (this.runtime.getSnapshot().phase === "dealing") {
      this.dealNextAutomaticCard();
      guard += 1;
      if (guard > 12) {
        throw new Error("deal did not reach settling");
      }
    }

    this.settleAutomaticRound();
  }
}

/**
 * Creates and tracks rooms, backed by one shared event store.
 */
export class RoomManager {
  private readonly rooms = new Map<TableId, Room>();
  private readonly listenersByTable = new Map<
    TableId,
    Set<RoomUpdateListener>
  >();

  private readonly onListenerError: (
    error: unknown,
    context: RoomListenerErrorContext,
  ) => void;

  constructor(
    private readonly store: EventStore,
    options: RoomManagerOptions = {},
  ) {
    this.onListenerError =
      options.onListenerError ??
      ((error, context) => {
        console.error(`Room listener failed for table ${context.tableId}:`, error);
      });
  }

  /** Create a room, seat and fund its actors, and return it. */
  createRoom(options: CreateRoomOptions): Room {
    if (this.rooms.has(options.tableId)) {
      throw new Error(`Room already exists for table ${options.tableId}`);
    }

    const room = new Room(options, this.store, (update) => {
      this.publishUpdate(options.tableId, update);
    });
    this.rooms.set(options.tableId, room);
    return room;
  }

  getRoom(tableId: TableId): Room | undefined {
    return this.rooms.get(tableId);
  }

  /** Read-only join authorization used by transport gateways. */
  canClientJoin(
    tableId: TableId,
    actorId: ActorId,
    credential: string,
  ): boolean {
    return this.rooms.get(tableId)?.canClientJoin(actorId, credential) ?? false;
  }

  /** Expose quarantine state for health checks and operational monitoring. */
  isRoomFaulted(tableId: TableId): boolean {
    return this.rooms.get(tableId)?.isFaulted() ?? false;
  }

  subscribe(
    tableId: TableId,
    listener: RoomUpdateListener,
  ): UnsubscribeRoomUpdates {
    let listeners = this.listenersByTable.get(tableId);
    if (listeners === undefined) {
      listeners = new Set<RoomUpdateListener>();
      this.listenersByTable.set(tableId, listeners);
    }
    listeners.add(listener);

    return () => {
      const currentListeners = this.listenersByTable.get(tableId);
      currentListeners?.delete(listener);
      if (currentListeners?.size === 0) {
        this.listenersByTable.delete(tableId);
      }
    };
  }

  private publishUpdate(tableId: TableId, update: RoomUpdate): void {
    const listeners = this.listenersByTable.get(tableId);
    if (listeners === undefined) {
      return;
    }

    for (const listener of listeners) {
      try {
        listener(update);
      } catch (error) {
        this.reportListenerError(error, { tableId, update });
      }
    }
  }

  private reportListenerError(
    error: unknown,
    context: RoomListenerErrorContext,
  ): void {
    try {
      this.onListenerError(error, context);
    } catch (reporterError) {
      // Error reporting is observational and must never affect game delivery.
      console.error("Room listener error reporter failed:", reporterError);
    }
  }
}
