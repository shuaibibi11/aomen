import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RoomManager } from "./room-manager.js";
import type { ServerNetworkConfig } from "./server-network-config.js";
import { WsGateway } from "./ws-gateway.js";

const LIVE_RESPONSE = JSON.stringify({ status: "live" });
const READY_RESPONSE = JSON.stringify({ status: "ready" });
const NOT_READY_RESPONSE = JSON.stringify({ status: "not_ready" });

export interface ServerTransportOptions {
  readonly port: number;
  readonly host: ServerNetworkConfig["host"];
  readonly allowedOrigin: string | undefined;
  readonly maximumPayloadBytes: number;
  readonly roomManager: RoomManager;
  /** Returns true only after the scheduler is genuinely running. */
  readonly isReady: () => boolean;
  readonly onError?: (error: unknown) => void;
}

/** One loopback HTTP listener that owns health endpoints and WebSocket upgrades. */
export class ServerTransport {
  private readonly httpServer: HttpServer;
  private readonly webSocketServer: WebSocketServer;
  private readonly gateway: WsGateway;
  private readonly listeningPromise: Promise<void>;
  private readonly isReady: () => boolean;
  private readonly allowedOrigin: string | undefined;
  private readonly onError: (error: unknown) => void;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: ServerTransportOptions) {
    this.isReady = options.isReady;
    this.allowedOrigin = options.allowedOrigin;
    this.onError = options.onError ?? ((error) => console.error("Server transport error:", error));
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: options.maximumPayloadBytes,
      perMessageDeflate: false,
    });
    this.gateway = new WsGateway({
      roomManager: options.roomManager,
      webSocketServer: this.webSocketServer,
      onError: this.onError,
    });
    this.httpServer = createServer((request, response) => {
      this.handleHttpRequest(request, response);
    });
    this.httpServer.on("error", (error) => this.reportError(error));
    this.httpServer.on("clientError", (_error, socket) => {
      this.endSocket(socket, 400, "Bad Request");
    });
    this.httpServer.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
    this.listeningPromise = this.createListeningPromise();
    void this.listeningPromise.catch(() => undefined);
    this.httpServer.listen({ port: options.port, host: options.host });
  }

  /** Resolve once the shared HTTP listener has bound its loopback port. */
  waitUntilListening(): Promise<void> {
    return this.listeningPromise;
  }

  /** Return the bound TCP port after the listener is ready. */
  getPort(): number {
    return this.getAddress().port;
  }

  /** Exposes only the TCP listener address needed by host integration checks. */
  getAddress(): AddressInfo {
    const address = this.httpServer.address();
    if (address === null) {
      throw new Error("HTTP server is not listening");
    }
    if (typeof address === "string") {
      throw new Error("HTTP server is listening on a non-TCP address");
    }
    return address;
  }

  /** Stop upgrades first, then close WebSockets and the HTTP listener exactly once. */
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    this.closing = true;
    this.closePromise = this.closeTransport();
    return this.closePromise;
  }

  private createListeningPromise(): Promise<void> {
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
        reject(new Error("HTTP server closed before listening"));
      };
      const removeStartupListeners = (): void => {
        this.httpServer.off("listening", handleListening);
        this.httpServer.off("error", handleError);
        this.httpServer.off("close", handleClose);
      };

      this.httpServer.once("listening", handleListening);
      this.httpServer.once("error", handleError);
      this.httpServer.once("close", handleClose);
    });
  }

  private handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const path = request.url ?? "";
    if (path === "/livez" || path === "/healthz") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end();
        return;
      }

      if (path === "/livez") {
        this.sendJson(response, request.method, 200, LIVE_RESPONSE);
        return;
      }

      const isReady = this.isApplicationReady();
      this.sendJson(
        response,
        request.method,
        isReady ? 200 : 503,
        isReady ? READY_RESPONSE : NOT_READY_RESPONSE,
      );
      return;
    }

    if (path === "/ws" && (request.method === "GET" || request.method === "HEAD")) {
      response.statusCode = 426;
      response.setHeader("Connection", "Upgrade");
      response.end();
      return;
    }

    response.statusCode = 404;
    response.end();
  }

  private isApplicationReady(): boolean {
    try {
      return this.isReady();
    } catch (error) {
      this.reportError(error);
      return false;
    }
  }

  private sendJson(
    response: ServerResponse,
    method: string | undefined,
    statusCode: number,
    body: string,
  ): void {
    response.statusCode = statusCode;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Length", Buffer.byteLength(body));
    response.end(method === "HEAD" ? undefined : body);
  }

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    if (this.closing) {
      this.endSocket(socket, 503, "Service Unavailable");
      return;
    }
    if (request.method !== "GET" || request.url !== "/ws") {
      this.endSocket(socket, 404, "Not Found");
      return;
    }
    if (
      this.allowedOrigin !== undefined
      && request.headers.origin !== this.allowedOrigin
    ) {
      this.endSocket(socket, 403, "Forbidden");
      return;
    }

    this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.webSocketServer.emit("connection", webSocket, request);
    });
  }

  private endSocket(socket: Duplex, statusCode: number, reasonPhrase: string): void {
    // Rejecting the handshake never creates a WebSocket or room context.
    socket.once("error", () => socket.destroy());
    socket.end(
      `HTTP/1.1 ${statusCode} ${reasonPhrase}\r\n` +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n\r\n",
    );
  }

  private async closeTransport(): Promise<void> {
    const httpClosePromise = this.closeHttpServer();
    const gatewayClosePromise = this.gateway.close();
    await Promise.all([httpClosePromise, gatewayClosePromise]);
  }

  private closeHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error !== undefined && error.message !== "Server is not running.") {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch (reportingError) {
      console.error("Server transport error reporter failed:", reportingError);
    }
  }
}
