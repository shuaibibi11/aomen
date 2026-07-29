import type { JoinedMessage, ServerMessage } from "@mct/room-protocol";
import type {
  RoomConnectionStateSnapshot,
  RoomMessageListener,
} from "@mct/room-client";
import type {
  BetKind,
  TableEvent,
  TableIntent,
  TableSnapshot,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs/schema";
import {
  buildSeatBetSpots,
  type BetSpotSpec,
} from "../specs/table-layout.js";
import type {
  SessionSeat,
  TableSession,
  TableSessionListener,
  TableSessionUnsubscribe,
} from "./table-session.js";

const MAXIMUM_CACHED_EVENTS = 1024;

export interface RemoteRoomConnection {
  connect(): Promise<JoinedMessage>;
  submitIntent(requestId: string, intent: TableIntent): Promise<void>;
  subscribeMessage(listener: RoomMessageListener): () => void;
  subscribeState(listener: (state: RoomConnectionStateSnapshot) => void): () => void;
  close(): void;
}

export interface RemoteTableSessionCreateOptions {
  readonly connection: RemoteRoomConnection;
  readonly commandTimeoutMs?: number;
  /** Sessions created with a connection own and close that connection. */
  readonly ownsConnection?: boolean;
  readonly createRequestId?: () => string;
}

interface PendingCommand {
  readonly resolve: (event: TableEvent) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class RemoteTableSession implements TableSession {
  private readonly connection: RemoteRoomConnection;
  private readonly actorId: JoinedMessage["actorId"];
  private readonly rulePack: RulePack;
  private readonly seats: readonly SessionSeat[];
  private readonly guestSeat: SessionSeat;
  private readonly betSpots: readonly BetSpotSpec[];
  private readonly commandTimeoutMs: number;
  private readonly ownsConnection: boolean;
  private readonly createRequestId: () => string;
  private readonly listeners = new Set<TableSessionListener>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly eventsBySequence = new Map<number, TableEvent>();
  private readonly snapshotsBySequence = new Map<number, TableSnapshot>();
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeState: () => void;
  private snapshot: TableSnapshot;
  private connected = true;
  private disposed = false;

  static async create(options: RemoteTableSessionCreateOptions): Promise<RemoteTableSession> {
    const joined = await options.connection.connect();
    return new RemoteTableSession(options, joined);
  }

  private constructor(options: RemoteTableSessionCreateOptions, joined: JoinedMessage) {
    this.connection = options.connection;
    this.actorId = joined.actorId;
    this.rulePack = joined.rulePack;
    this.snapshot = joined.snapshot;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
    this.ownsConnection = options.ownsConnection ?? true;
    this.createRequestId = options.createRequestId ?? createUniqueRequestId;
    this.seats = joined.seats
      .filter((seat): seat is typeof seat & { occupantId: NonNullable<typeof seat.occupantId> } =>
        seat.occupantId !== null)
      .map((seat) => Object.freeze({
        label: seat.label,
        seatId: seat.seatId,
        occupantId: seat.occupantId,
      }));
    const guestSeat = this.seats.find((seat) => seat.occupantId === joined.actorId);
    if (guestSeat === undefined) {
      throw new Error("Joined actor does not occupy an authoritative seat");
    }
    this.guestSeat = guestSeat;
    this.betSpots = buildSeatBetSpots(
      `${joined.rulePack.mainPayouts.tie} : 1`,
      joined.rulePack.variant === "standard",
    );
    this.unsubscribeMessage = this.connection.subscribeMessage((message) => {
      this.handleMessage(message);
    });
    this.unsubscribeState = this.connection.subscribeState((state) => {
      this.handleConnectionState(state);
    });
  }

  getRulePack(): RulePack { return this.rulePack; }
  getBetSpots(): readonly BetSpotSpec[] { return this.betSpots; }
  getSeats(): readonly SessionSeat[] { return this.seats; }
  getGuestSeat(): SessionSeat { return this.guestSeat; }
  getSnapshot(): TableSnapshot { return this.snapshot; }
  getEvents(): readonly TableEvent[] {
    return [...this.eventsBySequence.values()].sort((left, right) => left.seq - right.seq);
  }

  getStack(seatLabel: number): number {
    const seat = this.seats.find((candidate) => candidate.label === seatLabel);
    return this.snapshot.seats.find((candidate) => candidate.seatId === seat?.seatId)?.stack ?? 0;
  }

  getBetAmount(seatLabel: number, betKind: BetKind): number {
    const seat = this.seats.find((candidate) => candidate.label === seatLabel);
    return this.snapshot.bets
      .filter((bet) => bet.seatId === seat?.seatId && bet.betKind === betKind)
      .reduce((total, bet) => total + bet.amount, 0);
  }

  placeBet(seatLabel: number, betKind: BetKind, amount: number): Promise<TableEvent> {
    const seat = this.requireGuestSeat(seatLabel);
    return this.submitCommand({
      type: "place_bet",
      actorId: this.actorId,
      seatId: seat.seatId,
      betKind,
      amount,
    });
  }

  clearBets(seatLabel: number): Promise<TableEvent> {
    const seat = this.requireGuestSeat(seatLabel);
    return this.submitCommand({
      type: "clear_bets",
      actorId: this.actorId,
      seatId: seat.seatId,
    });
  }

  closeBetting(): Promise<TableEvent> {
    return this.submitCommand({ type: "no_more_bets", actorId: this.actorId });
  }
  dealNext(): Promise<TableEvent> {
    return this.submitCommand({ type: "deal_next", actorId: this.actorId });
  }
  settleRound(): Promise<TableEvent> {
    return this.submitCommand({ type: "settle_round", actorId: this.actorId });
  }
  startRound(): Promise<TableEvent> {
    return this.submitCommand({ type: "start_round", actorId: this.actorId });
  }

  subscribe(listener: TableSessionListener): TableSessionUnsubscribe {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connected = false;
    this.unsubscribeMessage();
    this.unsubscribeState();
    this.rejectAllPending(new Error("Remote table session disposed"));
    this.listeners.clear();
    if (this.ownsConnection) this.connection.close();
  }

  private requireGuestSeat(seatLabel: number): SessionSeat {
    if (seatLabel !== this.guestSeat.label) {
      throw new Error(`Remote commands are limited to guest seat ${this.guestSeat.label}`);
    }
    return this.guestSeat;
  }

  private submitCommand(intent: TableIntent): Promise<TableEvent> {
    if (this.disposed) return Promise.reject(new Error("Remote table session disposed"));
    if (!this.connected) return Promise.reject(new Error("Remote table session disconnected"));
    const requestId = this.createRequestId();
    return new Promise<TableEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Remote command timed out: ${requestId}`));
      }, this.commandTimeoutMs);
      this.pendingCommands.set(requestId, { resolve, reject, timeout });
      void this.connection.submitIntent(requestId, intent).catch((cause) => {
        this.rejectPending(requestId, toError(cause, "Remote command send failed"));
      });
    });
  }

  private handleMessage(message: ServerMessage): void {
    if (this.disposed) return;
    switch (message.type) {
      case "intent_result":
        if (message.event.accepted === false) {
          this.rejectPending(
            message.requestId,
            new Error(message.event.rejectReason ?? "Intent rejected"),
          );
        } else {
          this.resolvePending(message.requestId, message.event);
        }
        this.cacheEvent(message.event);
        return;
      case "error":
        if (message.requestId !== undefined) {
          this.rejectPending(message.requestId, new Error(`${message.code}: ${message.message}`));
        }
        return;
      case "event":
        this.cacheEvent(message.event);
        this.publishPairedUpdate(message.event.seq);
        return;
      case "snapshot":
        this.cacheSnapshot(message.snapshot);
        this.publishPairedUpdate(message.snapshot.lastEventSeq);
        return;
      case "joined":
        this.applyRejoinedBootstrap(message);
        return;
      default:
        return;
    }
  }

  private handleConnectionState(state: RoomConnectionStateSnapshot): void {
    const connected = state.state === "connected";
    if (connected) {
      this.connected = true;
      return;
    }
    if (["reconnecting", "disconnected", "closed"].includes(state.state)) {
      this.connected = false;
      this.rejectAllPending(new Error("Remote table session disconnected"));
    }
  }

  private cacheEvent(event: TableEvent): void {
    this.eventsBySequence.set(event.seq, event);
    trimOldestEntries(this.eventsBySequence, MAXIMUM_CACHED_EVENTS);
  }

  private cacheSnapshot(snapshot: TableSnapshot): void {
    if (snapshot.lastEventSeq < this.snapshot.lastEventSeq) return;
    this.snapshotsBySequence.set(snapshot.lastEventSeq, snapshot);
    trimOldestEntries(this.snapshotsBySequence, MAXIMUM_CACHED_EVENTS);
  }

  private publishPairedUpdate(sequence: number): void {
    const event = this.eventsBySequence.get(sequence);
    const pairedSnapshot = this.snapshotsBySequence.get(sequence);
    if (event === undefined || pairedSnapshot === undefined) return;
    if (sequence <= this.snapshot.lastEventSeq) return;
    this.snapshot = pairedSnapshot;
    for (const listener of this.listeners) listener({ event, snapshot: pairedSnapshot });
  }

  private applyRejoinedBootstrap(message: JoinedMessage): void {
    if (message.actorId !== this.actorId) return;
    if (message.snapshot.lastEventSeq < this.snapshot.lastEventSeq) return;
    this.snapshot = message.snapshot;
    for (const listener of this.listeners) listener({ snapshot: message.snapshot });
  }

  private resolvePending(requestId: string, event: TableEvent): void {
    const pending = this.pendingCommands.get(requestId);
    if (pending === undefined) return;
    this.pendingCommands.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(event);
  }

  private rejectPending(requestId: string, error: Error): void {
    const pending = this.pendingCommands.get(requestId);
    if (pending === undefined) return;
    this.pendingCommands.delete(requestId);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectAllPending(error: Error): void {
    for (const requestId of [...this.pendingCommands.keys()]) {
      this.rejectPending(requestId, error);
    }
  }
}

function createUniqueRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function trimOldestEntries<TKey, TValue>(map: Map<TKey, TValue>, maximumSize: number): void {
  while (map.size > maximumSize) {
    const oldestKey = map.keys().next().value as TKey | undefined;
    if (oldestKey === undefined) return;
    map.delete(oldestKey);
  }
}

function toError(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
}
