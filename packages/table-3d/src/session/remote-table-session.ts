import type {
  JoinedMessage,
  RoomInstanceId,
  RoomSessionCapabilities,
  ServerMessage,
} from "@mct/room-protocol";
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
const TRANSIENT_JOIN_ERROR_CODES = new Set(["room_unavailable", "internal_error"]);

export interface RemoteRoomConnection {
  connect(): Promise<JoinedMessage>;
  submitIntent(requestId: string, intent: TableIntent): Promise<void>;
  subscribeMessage(listener: RoomMessageListener): () => void;
  subscribeState(listener: (state: RoomConnectionStateSnapshot) => void): () => void;
  close(): void;
}

export class UnsupportedSessionCommandError extends Error {
  constructor(command: string) {
    super(`Remote session does not support command: ${command}`);
    this.name = "UnsupportedSessionCommandError";
  }
}

export class RoomInstanceChangedError extends Error {
  constructor(previousInstanceId: RoomInstanceId, nextInstanceId: RoomInstanceId) {
    super(`Room instance changed from ${previousInstanceId} to ${nextInstanceId}`);
    this.name = "RoomInstanceChangedError";
  }
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
  readonly intent: TableIntent;
  timeout: ReturnType<typeof setTimeout> | null;
}

export class RemoteTableSession implements TableSession {
  private readonly connection: RemoteRoomConnection;
  private readonly actorId: JoinedMessage["actorId"];
  private rulePack: RulePack;
  private seats: readonly SessionSeat[];
  private guestSeat: SessionSeat;
  private betSpots: readonly BetSpotSpec[];
  private roomInstanceId: RoomInstanceId;
  private readonly commandTimeoutMs: number;
  private readonly ownsConnection: boolean;
  private readonly createRequestId: () => string;
  private capabilities: RoomSessionCapabilities;
  private readonly listeners = new Set<TableSessionListener>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly eventsBySequence = new Map<number, TableEvent>();
  private readonly snapshotsBySequence = new Map<number, TableSnapshot>();
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeState: () => void;
  private snapshot: TableSnapshot;
  private connected = true;
  private resendPendingAfterConnected = false;
  private disposed = false;

  static async create(options: RemoteTableSessionCreateOptions): Promise<RemoteTableSession> {
    const ownsConnection = options.ownsConnection ?? true;
    try {
      const joined = await options.connection.connect();
      return new RemoteTableSession(options, joined);
    } catch (error) {
      if (ownsConnection) {
        try {
          await options.connection.close();
        } catch {
          // Cleanup must not replace the original connection or bootstrap error.
        }
      }
      throw error;
    }
  }

  private constructor(options: RemoteTableSessionCreateOptions, joined: JoinedMessage) {
    this.connection = options.connection;
    this.actorId = joined.actorId;
    this.roomInstanceId = joined.roomInstanceId;
    this.rulePack = joined.rulePack;
    this.snapshot = joined.snapshot;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
    this.ownsConnection = options.ownsConnection ?? true;
    this.createRequestId = options.createRequestId ?? createUniqueRequestId;
    this.capabilities = Object.freeze({ ...joined.capabilities });
    this.seats = createOccupiedSeats(joined);
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

  getCapabilities(): RoomSessionCapabilities { return this.capabilities; }
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
    if (!this.capabilities.canBet) {
      return this.rejectUnsupportedCommand("placeBet");
    }
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
    if (!this.capabilities.canClearBets) {
      return this.rejectUnsupportedCommand("clearBets");
    }
    const seat = this.requireGuestSeat(seatLabel);
    return this.submitCommand({
      type: "clear_bets",
      actorId: this.actorId,
      seatId: seat.seatId,
    });
  }

  closeBetting(): Promise<TableEvent> {
    if (!this.capabilities.canControlDealer) {
      return this.rejectUnsupportedCommand("closeBetting");
    }
    return this.submitCommand({ type: "no_more_bets", actorId: this.actorId });
  }
  dealNext(): Promise<TableEvent> {
    if (!this.capabilities.canControlDealer) {
      return this.rejectUnsupportedCommand("dealNext");
    }
    return this.submitCommand({ type: "deal_next", actorId: this.actorId });
  }
  settleRound(): Promise<TableEvent> {
    if (!this.capabilities.canControlDealer) {
      return this.rejectUnsupportedCommand("settleRound");
    }
    return this.submitCommand({ type: "settle_round", actorId: this.actorId });
  }
  startRound(): Promise<TableEvent> {
    if (!this.capabilities.canControlDealer) {
      return this.rejectUnsupportedCommand("startRound");
    }
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
    if (this.ownsConnection) void this.connection.close();
  }

  private requireGuestSeat(seatLabel: number): SessionSeat {
    if (seatLabel !== this.guestSeat.label) {
      throw new Error(`Remote commands are limited to guest seat ${this.guestSeat.label}`);
    }
    return this.guestSeat;
  }

  private rejectUnsupportedCommand(command: string): Promise<TableEvent> {
    return Promise.reject(new UnsupportedSessionCommandError(command));
  }

  private submitCommand(intent: TableIntent): Promise<TableEvent> {
    if (this.disposed) return Promise.reject(new Error("Remote table session disposed"));
    if (!this.connected) return Promise.reject(new Error("Remote table session disconnected"));
    const requestId = this.createRequestId();
    return new Promise<TableEvent>((resolve, reject) => {
      const pending: PendingCommand = { resolve, reject, intent, timeout: null };
      this.pendingCommands.set(requestId, pending);
      this.startPendingTimeout(requestId, pending);
      void this.connection.submitIntent(requestId, intent).catch((cause) => {
        if (this.connected) {
          this.rejectPending(requestId, toError(cause, "Remote command send failed"));
        }
      });
    });
  }

  private handleMessage(message: ServerMessage): void {
    if (this.disposed) return;
    if (
      message.type !== "joined"
      && message.type !== "error"
      && message.type !== "pong"
      && message.roomInstanceId !== this.roomInstanceId
    ) {
      console.error(`Ignored ${message.type} from stale room instance ${message.roomInstanceId}`);
      return;
    }
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
      if (this.resendPendingAfterConnected) {
        this.resendPendingAfterConnected = false;
        this.resendPendingCommands();
      }
      return;
    }
    if (["reconnecting", "disconnected"].includes(state.state)) {
      this.connected = false;
      const joinErrorCode = readJoinErrorCode(state.lastError);
      if (
        state.state === "disconnected"
        && joinErrorCode !== null
        && !TRANSIENT_JOIN_ERROR_CODES.has(joinErrorCode)
      ) {
        this.rejectAllPending(state.lastError ?? new Error("Room join rejected"));
        return;
      }
      this.pausePendingTimeouts();
      return;
    }
    if (state.state === "closed") {
      this.connected = false;
      this.rejectAllPending(new Error("Remote table session permanently closed"));
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
    const roomInstanceChanged = message.roomInstanceId !== this.roomInstanceId;
    if (!roomInstanceChanged && message.snapshot.lastEventSeq < this.snapshot.lastEventSeq) return;
    if (roomInstanceChanged) {
      const previousInstanceId = this.roomInstanceId;
      this.roomInstanceId = message.roomInstanceId;
      this.eventsBySequence.clear();
      this.snapshotsBySequence.clear();
      this.rejectAllPending(new RoomInstanceChangedError(previousInstanceId, message.roomInstanceId));
    }
    this.applyBootstrapDescriptors(message);
    this.connected = false;
    for (const listener of this.listeners) listener({ snapshot: message.snapshot });
    this.resendPendingAfterConnected = !roomInstanceChanged;
  }

  private applyBootstrapDescriptors(message: JoinedMessage): void {
    this.rulePack = message.rulePack;
    this.snapshot = message.snapshot;
    this.capabilities = Object.freeze({ ...message.capabilities });
    this.seats = createOccupiedSeats(message);
    const guestSeat = this.seats.find((seat) => seat.occupantId === this.actorId);
    if (guestSeat === undefined) throw new Error("Joined actor does not occupy an authoritative seat");
    this.guestSeat = guestSeat;
    this.betSpots = buildSeatBetSpots(
      `${message.rulePack.mainPayouts.tie} : 1`,
      message.rulePack.variant === "standard",
    );
  }

  private pausePendingTimeouts(): void {
    for (const pending of this.pendingCommands.values()) {
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pending.timeout = null;
    }
  }

  private resendPendingCommands(): void {
    for (const [requestId, pending] of this.pendingCommands) {
      this.startPendingTimeout(requestId, pending);
      void this.connection.submitIntent(requestId, pending.intent).catch((cause) => {
        if (this.connected) this.rejectPending(requestId, toError(cause, "Remote command resend failed"));
      });
    }
  }

  private startPendingTimeout(requestId: string, pending: PendingCommand): void {
    if (pending.timeout !== null) clearTimeout(pending.timeout);
    pending.timeout = setTimeout(() => {
      this.pendingCommands.delete(requestId);
      pending.timeout = null;
      pending.reject(new Error(`Remote command timed out: ${requestId}`));
    }, this.commandTimeoutMs);
  }

  private resolvePending(requestId: string, event: TableEvent): void {
    const pending = this.pendingCommands.get(requestId);
    if (pending === undefined) return;
    this.pendingCommands.delete(requestId);
    if (pending.timeout !== null) clearTimeout(pending.timeout);
    pending.resolve(event);
  }

  private rejectPending(requestId: string, error: Error): void {
    const pending = this.pendingCommands.get(requestId);
    if (pending === undefined) return;
    this.pendingCommands.delete(requestId);
    if (pending.timeout !== null) clearTimeout(pending.timeout);
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

function createOccupiedSeats(message: JoinedMessage): readonly SessionSeat[] {
  return message.seats
    .filter((seat): seat is typeof seat & { occupantId: NonNullable<typeof seat.occupantId> } =>
      seat.occupantId !== null)
    .map((seat) => Object.freeze({
      label: seat.label,
      seatId: seat.seatId,
      occupantId: seat.occupantId,
    }));
}

function readJoinErrorCode(error: Error | null): string | null {
  if (error?.name !== "JoinRejectedError" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
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
