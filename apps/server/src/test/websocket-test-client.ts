import { once } from "node:events";
import { WebSocket } from "ws";
import type { ServerMessage } from "@mct/room-protocol";

interface PendingMessageWaiter {
  readonly predicate: (message: ServerMessage) => boolean;
  readonly resolve: (message: ServerMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

/** Queue-backed real WebSocket client that avoids listener timing races in tests. */
export class WebSocketTestClient {
  private readonly receivedMessages: ServerMessage[] = [];
  private readonly pendingWaiters = new Set<PendingMessageWaiter>();
  private closePromise: Promise<void> | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (rawMessage) => {
      const message = JSON.parse(rawMessage.toString()) as ServerMessage;
      const matchingWaiter = [...this.pendingWaiters].find((waiter) =>
        waiter.predicate(message),
      );
      if (matchingWaiter === undefined) {
        this.receivedMessages.push(message);
        return;
      }

      clearTimeout(matchingWaiter.timeout);
      this.pendingWaiters.delete(matchingWaiter);
      matchingWaiter.resolve(message);
    });
  }

  static async connect(url: string): Promise<WebSocketTestClient> {
    const socket = new WebSocket(url);
    const client = new WebSocketTestClient(socket);
    await once(socket, "open");
    return client;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(rawMessage: string): void {
    this.socket.send(rawMessage);
  }

  waitForMessage(
    predicate: (message: ServerMessage) => boolean,
    timeoutMilliseconds = 2_000,
  ): Promise<ServerMessage> {
    const queuedMessageIndex = this.receivedMessages.findIndex(predicate);
    if (queuedMessageIndex >= 0) {
      const [queuedMessage] = this.receivedMessages.splice(queuedMessageIndex, 1);
      return Promise.resolve(queuedMessage!);
    }

    return new Promise((resolve, reject) => {
      const waiter: PendingMessageWaiter = {
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.pendingWaiters.delete(waiter);
          reject(new Error("Timed out waiting for WebSocket message"));
        }, timeoutMilliseconds),
      };
      this.pendingWaiters.add(waiter);
    });
  }

  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    this.closePromise = this.closeSocket();
    return this.closePromise;
  }

  private async closeSocket(): Promise<void> {
    for (const waiter of this.pendingWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("WebSocket client closed before receiving message"));
    }
    this.pendingWaiters.clear();

    if (this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    const closed = once(this.socket, "close");
    this.socket.close();
    await closed;
  }
}
