import {
  ROOM_PROTOCOL_VERSION,
  ServerMessageParseError,
  parseServerMessage,
  type ClientMessage,
  type RoomErrorCode,
  type ServerMessage,
} from "@mct/room-protocol";
import type { ActorId, TableId, TableIntent, TableSnapshot } from "@mct/shared";
import type {
  RoomConnectionState,
  RoomConnectionStateListener,
  RoomConnectionStateSnapshot,
  Unsubscribe,
} from "./connection-state.js";
import {
  browserWebSocketFactory,
  systemRandomSource,
  systemTimerClock,
  type RandomSource,
  type TimerClock,
  type WebSocketEventListener,
  type WebSocketFactory,
  type WebSocketLike,
  type WebSocketMessageEvent,
} from "./websocket-adapter.js";

const WEB_SOCKET_OPEN_STATE = 1;
const HEARTBEAT_CLOSE_CODE = 4000;
const JOIN_REJECTED_CLOSE_CODE = 4001;
const TRANSIENT_JOIN_ERROR_CODES: ReadonlySet<RoomErrorCode> = new Set([
  "room_unavailable",
  "internal_error",
]);

export interface RoomConnectionConfig {
  readonly url: string;
  readonly tableId: TableId;
  readonly actorId: ActorId;
  readonly credential: string;
  readonly heartbeatIntervalMs: number;
  readonly pongTimeoutMs: number;
  readonly reconnectBaseDelayMs: number;
  readonly reconnectMaxDelayMs: number;
  readonly reconnectJitterRatio: number;
  readonly websocketFactory?: WebSocketFactory;
  readonly clock?: TimerClock;
  readonly randomSource?: RandomSource;
}

export type RoomMessageListener = (message: ServerMessage) => void;
export type RoomConnectionErrorListener = (error: Error) => void;

export class RoomConnectionUnavailableError extends Error {
  constructor(message = "Room connection is not joined") {
    super(message);
    this.name = "RoomConnectionUnavailableError";
  }
}

export class JoinRejectedError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "JoinRejectedError";
  }
}

interface SocketListeners {
  readonly open: WebSocketEventListener;
  readonly message: WebSocketEventListener;
  readonly close: WebSocketEventListener;
  readonly error: WebSocketEventListener;
}

interface ActiveSocket {
  readonly generation: number;
  readonly socket: WebSocketLike;
  readonly listeners: SocketListeners;
}

interface BootstrapPromise {
  readonly promise: Promise<TableSnapshot>;
  readonly resolve: (snapshot: TableSnapshot) => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
}

function validateNonEmptyString(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function validatePositiveTiming(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive finite integer`);
  }
}

function validateConfig(config: RoomConnectionConfig): void {
  validateNonEmptyString(config.url, "url");
  validateNonEmptyString(config.tableId, "tableId");
  validateNonEmptyString(config.actorId, "actorId");
  validateNonEmptyString(config.credential, "credential");
  validatePositiveTiming(config.heartbeatIntervalMs, "heartbeatIntervalMs");
  validatePositiveTiming(config.pongTimeoutMs, "pongTimeoutMs");
  validatePositiveTiming(config.reconnectBaseDelayMs, "reconnectBaseDelayMs");
  validatePositiveTiming(config.reconnectMaxDelayMs, "reconnectMaxDelayMs");
  if (config.reconnectMaxDelayMs < config.reconnectBaseDelayMs) {
    throw new RangeError("reconnectMaxDelayMs must be at least reconnectBaseDelayMs");
  }
  if (
    !Number.isFinite(config.reconnectJitterRatio)
    || config.reconnectJitterRatio < 0
    || config.reconnectJitterRatio > 1
  ) {
    throw new RangeError("reconnectJitterRatio must be between 0 and 1");
  }
}

function createBootstrapPromise(): BootstrapPromise {
  let resolvePromise: (snapshot: TableSnapshot) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<TableSnapshot>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    settled: false,
  };
}

export class RoomConnection {
  private readonly config: RoomConnectionConfig;
  private readonly websocketFactory: WebSocketFactory;
  private readonly clock: TimerClock;
  private readonly randomSource: RandomSource;
  private readonly stateListeners = new Set<RoomConnectionStateListener>();
  private readonly messageListeners = new Set<RoomMessageListener>();
  private readonly errorListeners = new Set<RoomConnectionErrorListener>();
  private stateSnapshot: RoomConnectionStateSnapshot = Object.freeze({
    state: "idle",
    lastMessageAt: null,
    lastPongAt: null,
    reconnectAttempt: 0,
    lastError: null,
  });
  private activeSocket: ActiveSocket | null = null;
  private reconnectTimer: unknown | null = null;
  private heartbeatTimer: unknown | null = null;
  private outstandingPingNonce: number | null = null;
  private outstandingPingSentAt: number | null = null;
  private nextPingNonce = 1;
  private socketGeneration = 0;
  private bootstrap: BootstrapPromise | null = null;
  private permanentlyClosed = false;

  constructor(config: RoomConnectionConfig) {
    validateConfig(config);
    this.config = config;
    this.websocketFactory = config.websocketFactory ?? browserWebSocketFactory;
    this.clock = config.clock ?? systemTimerClock;
    this.randomSource = config.randomSource ?? systemRandomSource;
  }

  get snapshot(): RoomConnectionStateSnapshot {
    return this.stateSnapshot;
  }

  subscribeState(listener: RoomConnectionStateListener): Unsubscribe {
    this.stateListeners.add(listener);
    this.invokeStateListener(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeMessage(listener: RoomMessageListener): Unsubscribe {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  subscribeError(listener: RoomConnectionErrorListener): Unsubscribe {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  connect(): Promise<TableSnapshot> {
    if (this.permanentlyClosed) {
      return Promise.reject(new RoomConnectionUnavailableError("Room connection is permanently closed"));
    }
    if (this.bootstrap !== null) {
      return this.bootstrap.promise;
    }

    this.bootstrap = createBootstrapPromise();
    this.openSocket(false);
    return this.bootstrap.promise;
  }

  sendClientMessage(message: ClientMessage): void {
    const activeSocket = this.activeSocket;
    if (
      this.stateSnapshot.state !== "connected"
      || activeSocket === null
      || activeSocket.socket.readyState !== WEB_SOCKET_OPEN_STATE
    ) {
      throw new RoomConnectionUnavailableError();
    }
    this.sendSerialized(activeSocket, message);
  }

  async submitIntent(intent: TableIntent): Promise<void> {
    this.sendClientMessage({ type: "submit_intent", intent });
  }

  close(): void {
    if (this.permanentlyClosed) {
      return;
    }
    this.permanentlyClosed = true;
    this.socketGeneration += 1;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.outstandingPingNonce = null;
    this.outstandingPingSentAt = null;

    const activeSocket = this.activeSocket;
    this.activeSocket = null;
    if (activeSocket !== null) {
      this.detachSocketListeners(activeSocket);
      activeSocket.socket.close(1000, "Room connection closed");
    }
    if (this.bootstrap !== null && !this.bootstrap.settled) {
      this.bootstrap.settled = true;
      this.bootstrap.reject(new RoomConnectionUnavailableError("Room connection closed before joining"));
    }
    this.transitionState("closed");
    this.stateListeners.clear();
    this.messageListeners.clear();
    this.errorListeners.clear();
  }

  dispose(): void {
    this.close();
  }

  private openSocket(isReconnect: boolean): void {
    if (this.permanentlyClosed || this.activeSocket !== null) {
      return;
    }
    this.clearReconnectTimer();
    if (!isReconnect) {
      this.transitionState("connecting");
    }

    const generation = ++this.socketGeneration;
    let socket: WebSocketLike;
    try {
      socket = this.websocketFactory.create(this.config.url);
    } catch (cause) {
      this.handleSocketCreationFailure(cause);
      return;
    }

    const listeners: SocketListeners = {
      open: () => this.handleOpen(generation),
      message: (event) => this.handleMessage(generation, event as WebSocketMessageEvent),
      close: () => this.handleTransportFailure(generation, new Error("WebSocket closed unexpectedly")),
      error: () => this.handleTransportFailure(generation, new Error("WebSocket transport error")),
    };
    const activeSocket = { generation, socket, listeners };
    this.activeSocket = activeSocket;
    socket.addEventListener("open", listeners.open);
    socket.addEventListener("message", listeners.message);
    socket.addEventListener("close", listeners.close);
    socket.addEventListener("error", listeners.error);
  }

  private handleOpen(generation: number): void {
    const activeSocket = this.getCurrentSocket(generation);
    if (activeSocket === null) {
      return;
    }
    this.transitionState("joining");
    try {
      this.sendSerialized(activeSocket, {
        type: "join_room",
        tableId: this.config.tableId,
        actorId: this.config.actorId,
        credential: this.config.credential,
      });
    } catch {
      // sendSerialized already converted this generation's send error into transport recovery.
    }
  }

  private handleMessage(generation: number, event: WebSocketMessageEvent): void {
    if (this.getCurrentSocket(generation) === null) {
      return;
    }

    let message: ServerMessage;
    let receivedAt: number;
    try {
      const wireValue = typeof event.data === "string" ? JSON.parse(event.data) as unknown : event.data;
      message = parseServerMessage(wireValue);
      receivedAt = this.clock.now();
      this.validateMessageForConnection(message);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new ServerMessageParseError("Unable to parse server message");
      this.reportError(error, true);
      this.handleTransportFailure(generation, error);
      return;
    }

    if (message.type === "pong") {
      this.handlePong(message.nonce, receivedAt);
    } else if (message.type === "error" && this.stateSnapshot.state === "joining") {
      this.updateSnapshot({ lastMessageAt: receivedAt });
      this.notifyMessageListeners(message);
      this.handleJoinRejection(generation, message.code, message.message);
      return;
    } else if (message.type === "error") {
      this.reportError(new Error(`${message.code}: ${message.message}`), true);
      this.updateSnapshot({ lastMessageAt: receivedAt });
    } else if (message.type !== "joined") {
      this.updateSnapshot({ lastMessageAt: receivedAt });
    }

    this.notifyMessageListeners(message);

    if (message.type === "joined") {
      this.updateSnapshot({
        state: "connected",
        lastMessageAt: receivedAt,
        reconnectAttempt: 0,
        lastError: null,
      });
      this.startHeartbeat();
      if (this.bootstrap !== null && !this.bootstrap.settled) {
        this.bootstrap.settled = true;
        this.bootstrap.resolve(message.snapshot);
      }
    }
  }

  private validateMessageForConnection(message: ServerMessage): void {
    if (message.type !== "joined") {
      return;
    }
    if (
      message.tableId !== this.config.tableId
      || message.actorId !== this.config.actorId
      || message.protocolVersion !== ROOM_PROTOCOL_VERSION
    ) {
      throw new ServerMessageParseError("joined message does not match the requested room identity or protocol version");
    }
  }

  private handlePong(nonce: number, receivedAt: number): void {
    if (this.outstandingPingNonce === null || nonce !== this.outstandingPingNonce) {
      this.updateSnapshot({ lastMessageAt: receivedAt });
      return;
    }
    this.outstandingPingNonce = null;
    this.outstandingPingSentAt = null;
    this.updateSnapshot({ lastMessageAt: receivedAt, lastPongAt: receivedAt });
  }

  private handleJoinRejection(
    generation: number,
    code: RoomErrorCode,
    message: string,
  ): void {
    const activeSocket = this.getCurrentSocket(generation);
    if (activeSocket === null || this.permanentlyClosed) {
      return;
    }

    const rejectionError = new JoinRejectedError(code, message);
    this.socketGeneration += 1;
    this.activeSocket = null;
    this.detachSocketListeners(activeSocket);
    this.clearHeartbeatTimer();
    if (activeSocket.socket.readyState <= WEB_SOCKET_OPEN_STATE) {
      activeSocket.socket.close(JOIN_REJECTED_CLOSE_CODE, rejectionError.message);
    }
    this.reportError(rejectionError, true);
    this.rejectBootstrap(rejectionError);
    this.transitionState("disconnected");

    if (TRANSIENT_JOIN_ERROR_CODES.has(code)) {
      this.scheduleReconnect();
    }
  }

  private rejectBootstrap(error: Error): void {
    const bootstrap = this.bootstrap;
    if (bootstrap === null || bootstrap.settled) {
      return;
    }
    bootstrap.settled = true;
    bootstrap.reject(error);
    this.bootstrap = null;
  }

  private startHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.outstandingPingNonce = null;
    this.outstandingPingSentAt = null;
    this.scheduleHeartbeat(this.config.heartbeatIntervalMs);
  }

  private scheduleHeartbeat(delayMs: number): void {
    this.heartbeatTimer = this.clock.setTimeout(() => {
      this.heartbeatTimer = null;
      this.runHeartbeat();
    }, delayMs);
  }

  private runHeartbeat(): void {
    const activeSocket = this.activeSocket;
    if (this.stateSnapshot.state !== "connected" || activeSocket === null) {
      return;
    }

    if (this.outstandingPingNonce !== null && this.outstandingPingSentAt !== null) {
      const elapsedMs = this.clock.now() - this.outstandingPingSentAt;
      if (elapsedMs >= this.config.pongTimeoutMs) {
        const generation = activeSocket.generation;
        this.handleTransportFailure(generation, new Error("WebSocket pong timeout"));
        return;
      }
      this.scheduleHeartbeat(Math.min(
        this.config.heartbeatIntervalMs,
        this.config.pongTimeoutMs - elapsedMs,
      ));
      return;
    }

    const nonce = this.nextPingNonce++;
    this.outstandingPingNonce = nonce;
    this.outstandingPingSentAt = this.clock.now();
    try {
      this.sendSerialized(activeSocket, { type: "ping", nonce });
    } catch {
      // Timer callbacks cannot surface send exceptions; transport recovery is already scheduled.
      return;
    }
    this.scheduleHeartbeat(Math.min(this.config.heartbeatIntervalMs, this.config.pongTimeoutMs));
  }

  private handleTransportFailure(generation: number, error: Error): void {
    const activeSocket = this.getCurrentSocket(generation);
    if (activeSocket === null || this.permanentlyClosed) {
      return;
    }

    this.socketGeneration += 1;
    this.activeSocket = null;
    this.detachSocketListeners(activeSocket);
    this.clearHeartbeatTimer();
    this.outstandingPingNonce = null;
    this.outstandingPingSentAt = null;
    if (activeSocket.socket.readyState <= WEB_SOCKET_OPEN_STATE) {
      activeSocket.socket.close(HEARTBEAT_CLOSE_CODE, error.message);
    }
    this.reportError(error, true);
    this.transitionState("disconnected");
    this.scheduleReconnect();
  }

  private handleSocketCreationFailure(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error("WebSocket factory failed");
    this.reportError(error, true);
    this.transitionState("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.permanentlyClosed || this.reconnectTimer !== null || this.activeSocket !== null) {
      return;
    }
    const reconnectAttempt = this.stateSnapshot.reconnectAttempt + 1;
    this.updateSnapshot({ reconnectAttempt });
    this.transitionState("reconnecting");
    const exponentialDelayMs = Math.min(
      this.config.reconnectMaxDelayMs,
      this.config.reconnectBaseDelayMs * (2 ** (reconnectAttempt - 1)),
    );
    const randomValue = this.randomSource.next();
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
      throw new RangeError("RandomSource.next() must return a number between 0 and 1");
    }
    const jitterMultiplier = 1 + ((randomValue * 2) - 1) * this.config.reconnectJitterRatio;
    const reconnectDelayMs = Math.min(
      this.config.reconnectMaxDelayMs,
      Math.max(0, Math.round(exponentialDelayMs * jitterMultiplier)),
    );
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(true);
    }, reconnectDelayMs);
  }

  private sendSerialized(activeSocket: ActiveSocket, message: ClientMessage): void {
    try {
      activeSocket.socket.send(JSON.stringify(message));
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Unable to send WebSocket message");
      this.handleTransportFailure(activeSocket.generation, error);
      throw error;
    }
  }

  private getCurrentSocket(generation: number): ActiveSocket | null {
    const activeSocket = this.activeSocket;
    if (
      activeSocket === null
      || activeSocket.generation !== generation
      || generation !== this.socketGeneration
    ) {
      return null;
    }
    return activeSocket;
  }

  private detachSocketListeners(activeSocket: ActiveSocket): void {
    activeSocket.socket.removeEventListener("open", activeSocket.listeners.open);
    activeSocket.socket.removeEventListener("message", activeSocket.listeners.message);
    activeSocket.socket.removeEventListener("close", activeSocket.listeners.close);
    activeSocket.socket.removeEventListener("error", activeSocket.listeners.error);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      this.clock.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private transitionState(state: RoomConnectionState): void {
    if (this.stateSnapshot.state === state) {
      return;
    }
    this.updateSnapshot({ state });
  }

  private updateSnapshot(changes: Partial<RoomConnectionStateSnapshot>): void {
    this.stateSnapshot = Object.freeze({ ...this.stateSnapshot, ...changes });
    for (const listener of [...this.stateListeners]) {
      this.invokeStateListener(listener);
    }
  }

  private invokeStateListener(listener: RoomConnectionStateListener): void {
    try {
      listener(this.stateSnapshot);
    } catch (cause) {
      this.reportError(cause instanceof Error ? cause : new Error("State listener failed"), false);
    }
  }

  private notifyMessageListeners(message: ServerMessage): void {
    for (const listener of [...this.messageListeners]) {
      try {
        listener(message);
      } catch (cause) {
        this.reportError(cause instanceof Error ? cause : new Error("Message listener failed"), false);
      }
    }
  }

  private reportError(error: Error, updateState: boolean): void {
    if (updateState) {
      this.stateSnapshot = Object.freeze({ ...this.stateSnapshot, lastError: error });
    }
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error);
      } catch {
        // Error listeners are the final reporting boundary and must stay isolated.
      }
    }
  }
}
