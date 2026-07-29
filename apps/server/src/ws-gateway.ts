/**
 * WebSocket gateway.
 *
 * A thin transport layer over the RoomManager. It parses client messages
 * against the room protocol, forwards intents to the room, and broadcasts the
 * resulting snapshot and event to every socket joined to that table.
 *
 * All game logic lives in the engine and the room; this file only moves
 * messages on and off the wire, so it stays easy to reason about and to
 * replace with a different transport.
 */
import { WebSocket, WebSocketServer } from "ws";
import {
  ClientMessageParseError,
  ROOM_PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type RoomErrorCode,
  type ServerMessage,
} from "@mct/room-protocol";
import {
  SYSTEM_DEALER,
  type ActorId,
  type TableId,
  type TableIntent,
} from "@mct/shared";
import type { RoomManager } from "./room-manager.js";
import type { RoomUpdate, UnsubscribeRoomUpdates } from "./room-events.js";

export interface WsGatewayOptions {
  readonly port?: number;
  readonly webSocketServer?: WebSocketServer;
  readonly roomManager: RoomManager;
  readonly onError?: (error: unknown) => void;
}

interface SocketContext {
  readonly tableId: TableId;
  readonly actorId: ActorId;
}

const MAXIMUM_REQUEST_IDS_PER_SOCKET = 1024;

export function getIntentActorError(
  joinedActorId: ActorId,
  intent: TableIntent,
): RoomErrorCode | null {
  if (intent.actorId === SYSTEM_DEALER || intent.actorId !== joinedActorId) {
    return "actor_mismatch";
  }
  return null;
}

export class WsGateway {
  private readonly server: WebSocketServer;
  private readonly listeningPromise: Promise<void>;
  private readonly roomManager: RoomManager;
  private readonly onError: (error: unknown) => void;
  private closing = false;
  private serverCloseCompleted = false;
  private closePromise: Promise<void> | null = null;
  private resolveClientDrain: (() => void) | null = null;
  private readonly activeSockets = new Set<WebSocket>();
  /** Authoritative identity and table established by each successful join. */
  private readonly socketContexts = new Map<WebSocket, SocketContext>();
  private readonly handledRequestIds = new Map<WebSocket, Map<string, true>>();
  private readonly roomSubscriptions = new Map<
    TableId,
    UnsubscribeRoomUpdates
  >();

  constructor(options: WsGatewayOptions) {
    if ((options.port === undefined) === (options.webSocketServer === undefined)) {
      throw new Error("Provide exactly one of port or webSocketServer");
    }
    this.roomManager = options.roomManager;
    this.onError =
      options.onError ??
      ((error) => {
        console.error("WebSocket gateway error:", error);
      });
    this.server =
      options.webSocketServer ?? new WebSocketServer({ port: options.port! });
    this.listeningPromise = this.createListeningPromise();
    void this.listeningPromise.catch(() => undefined);
    this.server.on("error", (error) => this.reportError(error));
    this.server.on("connection", (socket) => this.handleConnection(socket));
  }

  private createListeningPromise(): Promise<void> {
    if (this.readServerAddress() !== null) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const handleListening = (): void => {
        removeStartupListeners();
        resolve();
      };
      const handleError = (error: Error): void => {
        removeStartupListeners();
        reject(error);
      };
      const handleClose = (): void => {
        removeStartupListeners();
        reject(new Error("WebSocket server closed before listening"));
      };
      const removeStartupListeners = (): void => {
        this.server.off("listening", handleListening);
        this.server.off("error", handleError);
        this.server.off("close", handleClose);
      };

      this.server.once("listening", handleListening);
      this.server.once("error", handleError);
      this.server.once("close", handleClose);
    });
  }

  /** Resolve once the underlying server has bound its TCP listener. */
  waitUntilListening(): Promise<void> {
    return this.listeningPromise;
  }

  /** Return the bound TCP port after listening has started. */
  getPort(): number {
    const address = this.readServerAddress();
    if (address === null) {
      throw new Error("WebSocket server is not listening");
    }
    if (typeof address === "string") {
      throw new Error("WebSocket server is listening on a non-TCP address");
    }
    return address.port;
  }

  private readServerAddress(): ReturnType<WebSocketServer["address"]> {
    try {
      return this.server.address();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'The server is operating in "noServer" mode'
      ) {
        return null;
      }
      throw error;
    }
  }

  private handleConnection(socket: WebSocket): void {
    this.activeSockets.add(socket);
    if (this.closing) {
      socket.once("close", () => this.handleSocketClosed(socket));
      socket.once("error", (error) => this.reportError(error));
      this.terminateSocket(socket);
      return;
    }

    socket.on("error", (error) => this.reportError(error));
    socket.on("message", (raw) => {
      try {
        this.handleMessage(socket, raw.toString());
      } catch (error) {
        this.reportError(error);
        this.send(socket, {
          type: "error",
          code: "internal_error",
          message: "Message processing failed",
        });
      }
    });
    socket.on("close", () => {
      this.handleSocketClosed(socket);
      const context = this.socketContexts.get(socket);
      this.socketContexts.delete(socket);
      this.handledRequestIds.delete(socket);
      if (context !== undefined) {
        this.removeUnusedRoomSubscription(context.tableId);
      }
    });
  }

  private handleSocketClosed(socket: WebSocket): void {
    this.activeSockets.delete(socket);
    this.resolveClientDrainIfComplete();
  }

  private terminateSocket(socket: WebSocket): void {
    if (socket.readyState === WebSocket.CLOSED) {
      this.handleSocketClosed(socket);
      return;
    }
    socket.terminate();
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(raw) as unknown;
    } catch {
      this.send(socket, {
        type: "error",
        code: "malformed_message",
        message: "Message was not valid JSON",
      });
      return;
    }

    let message: ClientMessage;
    try {
      message = parseClientMessage(parsedValue);
    } catch (error) {
      if (!(error instanceof ClientMessageParseError)) {
        throw error;
      }
      this.send(socket, {
        type: "error",
        code: "malformed_message",
        message: "Message did not match the client protocol",
      });
      return;
    }

    switch (message.type) {
      case "join_room":
        this.handleJoin(
          socket,
          message.tableId,
          message.actorId,
          message.credential,
        );
        return;
      case "submit_intent":
        this.handleIntent(socket, message);
        return;
      case "ping":
        this.send(socket, { type: "pong", nonce: message.nonce });
        return;
      default:
        this.send(socket, {
          type: "error",
          code: "malformed_message",
          message: "Unknown message type",
        });
    }
  }

  private handleJoin(
    socket: WebSocket,
    tableId: TableId,
    actorId: ActorId,
    credential: string,
  ): void {
    const room = this.roomManager.getRoom(tableId);
    if (room === undefined) {
      this.send(socket, {
        type: "error",
        code: "unknown_room",
        message: `No room for table ${tableId}`,
      });
      return;
    }
    if (room.isFaulted()) {
      this.send(socket, {
        type: "error",
        code: "room_unavailable",
        message: "Room is unavailable",
      });
      return;
    }
    if (!this.roomManager.canClientJoin(tableId, actorId, credential)) {
      this.send(socket, {
        type: "error",
        code: "actor_not_allowed",
        message: "This actor is not allowed to join the room",
      });
      return;
    }

    // Multiple sockets may bind to the same authorized human actor to support
    // multiple tabs and reconnect overlap. Each remains bound to that actor.
    const previousContext = this.socketContexts.get(socket);
    this.socketContexts.set(socket, { tableId, actorId });
    this.ensureRoomSubscription(tableId);
    if (previousContext !== undefined && previousContext.tableId !== tableId) {
      this.removeUnusedRoomSubscription(previousContext.tableId);
    }
    this.send(socket, {
      type: "joined",
      tableId,
      actorId,
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot: room.getSnapshot(),
      rulePack: room.getRulePack(),
      seats: room.getSeatDescriptors(),
    });
  }

  private handleIntent(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: "submit_intent" }>,
  ): void {
    const requestId = message.requestId;
    const context = this.socketContexts.get(socket);
    if (context === undefined) {
      this.send(socket, {
        type: "error",
        code: "not_joined",
        message: "Join a room before submitting intents",
        requestId,
      });
      return;
    }
    const requestIds = this.handledRequestIds.get(socket) ?? new Map<string, true>();
    this.handledRequestIds.set(socket, requestIds);
    if (requestIds.has(requestId)) {
      this.send(socket, {
        type: "error",
        code: "duplicate_request",
        message: "This request identifier was already handled",
        requestId,
      });
      return;
    }
    requestIds.set(requestId, true);
    if (requestIds.size > MAXIMUM_REQUEST_IDS_PER_SOCKET) {
      const oldestRequestId = requestIds.keys().next().value as string | undefined;
      if (oldestRequestId !== undefined) {
        requestIds.delete(oldestRequestId);
      }
    }
    const actorError = getIntentActorError(context.actorId, message.intent);
    if (actorError !== null) {
      this.send(socket, {
        type: "error",
        code: actorError,
        message: "Intent actor must match the actor bound when joining",
        requestId,
      });
      return;
    }

    const room = this.roomManager.getRoom(context.tableId);
    if (room === undefined) {
      this.send(socket, {
        type: "error",
        code: "unknown_room",
        message: `No room for table ${context.tableId}`,
        requestId,
      });
      return;
    }
    if (!room.isClientIntentAllowed(message.intent)) {
      this.send(socket, {
        type: "error",
        code: "intent_not_allowed",
        message: "This intent is not allowed for the joined actor and seat",
        requestId,
      });
      return;
    }

    try {
      const event = room.submitIntent(message.intent);
      this.send(socket, { type: "intent_result", requestId, event });
    } catch (error) {
      this.reportError(error);
      this.send(socket, {
        type: "error",
        code: "internal_error",
        message: "Intent submission failed",
        requestId,
      });
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch (reporterError) {
      console.error("WebSocket gateway error reporter failed:", reporterError);
    }
  }

  private ensureRoomSubscription(tableId: TableId): void {
    if (this.roomSubscriptions.has(tableId)) {
      return;
    }
    const unsubscribe = this.roomManager.subscribe(tableId, (update) => {
      this.broadcastRoomUpdate(tableId, update);
    });
    this.roomSubscriptions.set(tableId, unsubscribe);
  }

  private removeUnusedRoomSubscription(tableId: TableId): void {
    const tableStillHasSockets = [...this.socketContexts.values()].some(
      (context) => context.tableId === tableId,
    );
    if (tableStillHasSockets) {
      return;
    }
    this.roomSubscriptions.get(tableId)?.();
    this.roomSubscriptions.delete(tableId);
  }

  private broadcastRoomUpdate(tableId: TableId, update: RoomUpdate): void {
    this.broadcast(tableId, { type: "event", event: update.event });
    this.broadcast(tableId, { type: "snapshot", snapshot: update.snapshot });
  }

  /** Send a message to every socket joined to a table. */
  private broadcast(tableId: TableId, message: ServerMessage): void {
    for (const [socket, context] of this.socketContexts) {
      if (context.tableId === tableId) {
        this.send(socket, message);
      }
    }
  }

  /** Stop listening and resolve after every server-side socket has closed. */
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    this.closing = true;
    this.closePromise = this.closeServer();
    return this.closePromise;
  }

  private async closeServer(): Promise<void> {
    const serverClosePromise = new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        this.serverCloseCompleted = true;
        this.resolveClientDrainIfComplete();
        if (error !== undefined && error.message !== "The server is not running") {
          reject(error);
          return;
        }
        resolve();
      });
    });
    const clientDrainPromise = new Promise<void>((resolve) => {
      this.resolveClientDrain = resolve;
      this.resolveClientDrainIfComplete();
    });

    for (const unsubscribe of this.roomSubscriptions.values()) {
      unsubscribe();
    }
    this.roomSubscriptions.clear();
    this.socketContexts.clear();

    for (const socket of this.server.clients) {
      this.terminateSocket(socket);
    }

    await Promise.all([serverClosePromise, clientDrainPromise]);
  }

  private resolveClientDrainIfComplete(): void {
    if (!this.serverCloseCompleted || this.activeSockets.size > 0) {
      return;
    }
    this.resolveClientDrain?.();
    this.resolveClientDrain = null;
  }
}
