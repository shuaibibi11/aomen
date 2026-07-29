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
  ROOM_PROTOCOL_VERSION,
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
  readonly port: number;
  readonly roomManager: RoomManager;
}

interface SocketContext {
  readonly tableId: TableId;
  readonly actorId: ActorId;
}

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
  private readonly roomManager: RoomManager;
  /** Authoritative identity and table established by each successful join. */
  private readonly socketContexts = new Map<WebSocket, SocketContext>();
  private readonly roomSubscriptions = new Map<
    TableId,
    UnsubscribeRoomUpdates
  >();

  constructor(options: WsGatewayOptions) {
    this.roomManager = options.roomManager;
    this.server = new WebSocketServer({ port: options.port });
    this.server.on("connection", (socket) => this.handleConnection(socket));
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => this.handleMessage(socket, raw.toString()));
    socket.on("close", () => {
      const context = this.socketContexts.get(socket);
      this.socketContexts.delete(socket);
      if (context !== undefined) {
        this.removeUnusedRoomSubscription(context.tableId);
      }
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(socket, {
        type: "error",
        code: "malformed_message",
        message: "Message was not valid JSON",
      });
      return;
    }

    switch (message.type) {
      case "join_room":
        this.handleJoin(socket, message.tableId, message.actorId);
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
    });
  }

  private handleIntent(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: "submit_intent" }>,
  ): void {
    const context = this.socketContexts.get(socket);
    if (context === undefined) {
      this.send(socket, {
        type: "error",
        code: "not_joined",
        message: "Join a room before submitting intents",
      });
      return;
    }
    const actorError = getIntentActorError(context.actorId, message.intent);
    if (actorError !== null) {
      this.send(socket, {
        type: "error",
        code: actorError,
        message: "Intent actor must match the actor bound when joining",
      });
      return;
    }

    const room = this.roomManager.getRoom(context.tableId);
    if (room === undefined) {
      this.send(socket, {
        type: "error",
        code: "unknown_room",
        message: `No room for table ${context.tableId}`,
      });
      return;
    }

    try {
      room.submitIntent(message.intent);
    } catch (error) {
      this.send(socket, {
        type: "error",
        code: "internal_error",
        message: error instanceof Error ? error.message : "Intent submission failed",
      });
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

  /** Stop listening and close all sockets. */
  close(): void {
    for (const unsubscribe of this.roomSubscriptions.values()) {
      unsubscribe();
    }
    this.roomSubscriptions.clear();
    this.socketContexts.clear();
    for (const socket of this.server.clients) {
      socket.close();
    }
    this.server.close();
  }
}
