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
  type SeatId,
  type TableEvent,
  type TableId,
  type TableSnapshot,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { TableRuntime, createShoe } from "@mct/table-engine";
import { BasicPlayerAi } from "./ai/basic-player-ai.js";
import type { EventStore } from "./memory-event-store.js";

export interface CreateRoomOptions {
  readonly tableId: TableId;
  readonly rulePack: RulePack;
  /** The human guest's actor id; seated at the first seat. */
  readonly humanActorId: ActorId;
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

/**
 * One live room: a runtime, its dealer, its seated actors and their AI.
 *
 * The dealer is the system dealer, so the room can drive deal/settle itself in
 * a tick without waiting on a human.
 */
export class Room {
  private readonly runtime: TableRuntime;
  private readonly humanSeatId: SeatId;
  private readonly aiSeats: readonly SeatedAi[];
  private readonly store: EventStore;

  constructor(options: CreateRoomOptions, store: EventStore) {
    this.store = store;

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
    const event = this.runtime.submitIntent(intent);
    this.store.append(event);
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

  /**
   * Advance one full round with the system dealer driving:
   * start → AI bets → no-more-bets → deal to completion → settle.
   *
   * A human's bets are expected to have been submitted during the betting
   * window in a live setting; here the tick opens and closes betting itself so
   * a round can be driven end to end without a socket.
   */
  playAutomaticRound(): void {
    this.applyIntentAndStore({ type: "start_round", actorId: SYSTEM_DEALER });

    for (const seated of this.aiSeats) {
      const bet = seated.ai.decideBet();
      if (bet !== null) {
        this.applyIntentAndStore(bet);
      }
    }

    this.applyIntentAndStore({ type: "no_more_bets", actorId: SYSTEM_DEALER });

    // Deal until the runtime leaves the dealing phase.
    let guard = 0;
    this.applyIntentAndStore({ type: "deal_next", actorId: SYSTEM_DEALER });
    while (this.runtime.getSnapshot().phase === "dealing") {
      this.applyIntentAndStore({ type: "deal_next", actorId: SYSTEM_DEALER });
      guard += 1;
      if (guard > 12) {
        throw new Error("deal did not reach settling");
      }
    }

    this.applyIntentAndStore({ type: "settle_round", actorId: SYSTEM_DEALER });
  }
}

/**
 * Creates and tracks rooms, backed by one shared event store.
 */
export class RoomManager {
  private readonly rooms = new Map<TableId, Room>();

  constructor(private readonly store: EventStore) {}

  /** Create a room, seat and fund its actors, and return it. */
  createRoom(options: CreateRoomOptions): Room {
    const room = new Room(options, this.store);
    this.rooms.set(options.tableId, room);
    return room;
  }

  getRoom(tableId: TableId): Room | undefined {
    return this.rooms.get(tableId);
  }
}
