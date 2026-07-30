import { once } from "node:events";
import { request as createHttpRequest, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RulePack } from "@mct/rule-packs";
import { asActorId, asTableId } from "@mct/shared";
import { MemoryEventStore } from "./memory-event-store.js";
import { RoomManager, type Room } from "./room-manager.js";
import { ServerTransport } from "./server-transport.js";

const TEST_ORIGIN = "https://staging.example.test:8443";
const TEST_JOIN_CREDENTIAL = "test-only-join-credential";
const openTransports: ServerTransport[] = [];

interface HttpResponse {
  readonly statusCode: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

function createRulePack(): RulePack {
  return {
    id: "transport-test-rule-pack",
    version: "1.0.0",
    displayName: "Transport test rule pack",
    variant: "standard",
    limits: { min: 100, max: 100_000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  };
}

function createRoom(): { readonly roomManager: RoomManager; readonly room: Room } {
  const roomManager = new RoomManager(new MemoryEventStore());
  const tableId = asTableId("transport-test-table");
  const room = roomManager.createRoom({
    tableId,
    rulePack: createRulePack(),
    humanActorId: asActorId("transport-test-human"),
    joinCredential: TEST_JOIN_CREDENTIAL,
    seatCount: 2,
    aiCount: 0,
    shoeSeed: "transport-test-seed",
  });
  return { roomManager, room };
}

async function createTransport(options: {
  readonly allowedOrigin?: string;
  readonly maximumPayloadBytes?: number;
  readonly isReady?: () => boolean;
} = {}): Promise<{ readonly transport: ServerTransport; readonly room: Room }> {
  const { roomManager, room } = createRoom();
  const transport = new ServerTransport({
    port: 0,
    host: "127.0.0.1",
    roomManager,
    allowedOrigin: options.allowedOrigin,
    maximumPayloadBytes: options.maximumPayloadBytes ?? 65_536,
    isReady: options.isReady ?? (() => true),
    onError: () => undefined,
  });
  openTransports.push(transport);
  await transport.waitUntilListening();
  return { transport, room };
}

function requestHttp(
  port: number,
  path: string,
  method = "GET",
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = createHttpRequest(
      { host: "127.0.0.1", port, path, method },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function requestRejectedUpgrade(url: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, origin === undefined ? {} : { origin });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out waiting for rejected WebSocket upgrade"));
    }, 1_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
    socket.once("open", () => {
      clearTimeout(timeout);
      socket.terminate();
      reject(new Error("WebSocket upgrade unexpectedly succeeded"));
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WebSocket join response"));
    }, 1_000);
    socket.once("message", (message) => {
      clearTimeout(timeout);
      resolve(JSON.parse(message.toString()) as Record<string, unknown>);
    });
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  const closed = once(socket, "close");
  socket.close();
  await closed;
}

afterEach(async () => {
  await Promise.all(openTransports.splice(0).map((transport) => transport.close()));
});

describe("ServerTransport HTTP endpoints", () => {
  it("binds the configured loopback address", async () => {
    const { transport } = await createTransport();

    expect(transport.getAddress()).toMatchObject({ address: "127.0.0.1" });
  });

  it("serves live and ready health JSON without caching", async () => {
    const { transport } = await createTransport();
    const port = transport.getPort();

    const [liveResponse, readyResponse, headResponse] = await Promise.all([
      requestHttp(port, "/livez"),
      requestHttp(port, "/healthz"),
      requestHttp(port, "/livez", "HEAD"),
    ]);

    expect(liveResponse).toMatchObject({
      statusCode: 200,
      body: '{"status":"live"}',
      headers: { "cache-control": "no-store" },
    });
    expect(readyResponse).toMatchObject({
      statusCode: 200,
      body: '{"status":"ready"}',
      headers: { "cache-control": "no-store" },
    });
    expect(headResponse).toMatchObject({
      statusCode: 200,
      body: "",
      headers: { "cache-control": "no-store" },
    });
  });

  it("reports not ready when the application readiness query is false", async () => {
    const { transport } = await createTransport({ isReady: () => false });

    expect(await requestHttp(transport.getPort(), "/healthz")).toMatchObject({
      statusCode: 503,
      body: '{"status":"not_ready"}',
    });
  });

  it("samples application readiness once for each health request", async () => {
    let readinessChecks = 0;
    const { transport } = await createTransport({
      isReady: () => {
        readinessChecks += 1;
        return readinessChecks === 1;
      },
    });

    expect(await requestHttp(transport.getPort(), "/healthz")).toMatchObject({
      statusCode: 200,
      body: '{"status":"ready"}',
    });
    expect(readinessChecks).toBe(1);
  });

  it("rejects unsupported HTTP routes and methods without CORS headers", async () => {
    const { transport } = await createTransport();
    const port = transport.getPort();

    const [
      missingRoute,
      invalidHealthMethod,
      plainWebSocketGetRoute,
      plainWebSocketHeadRoute,
    ] = await Promise.all([
      requestHttp(port, "/missing"),
      requestHttp(port, "/healthz", "POST"),
      requestHttp(port, "/ws"),
      requestHttp(port, "/ws", "HEAD"),
    ]);

    expect(missingRoute.statusCode).toBe(404);
    expect(invalidHealthMethod).toMatchObject({
      statusCode: 405,
      headers: { allow: "GET, HEAD" },
    });
    for (const response of [plainWebSocketGetRoute, plainWebSocketHeadRoute]) {
      expect(response).toMatchObject({
        statusCode: 426,
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
        },
        body: "",
      });
    }
    expect(missingRoute.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("ServerTransport WebSocket upgrades", () => {
  it("rejects missing or wrong origins before opening a socket", async () => {
    const { transport } = await createTransport({ allowedOrigin: TEST_ORIGIN });
    const url = `ws://127.0.0.1:${transport.getPort()}/ws`;

    expect(await requestRejectedUpgrade(url)).toBe(403);
    expect(await requestRejectedUpgrade(url, "https://wrong.example.test")).toBe(403);
  });

  it("rejects a different upgrade path and a query string", async () => {
    const { transport } = await createTransport({ allowedOrigin: TEST_ORIGIN });
    const baseUrl = `ws://127.0.0.1:${transport.getPort()}`;

    expect(await requestRejectedUpgrade(`${baseUrl}/other`, TEST_ORIGIN)).toBe(404);
    expect(await requestRejectedUpgrade(`${baseUrl}/ws?table=1`, TEST_ORIGIN)).toBe(404);
  });

  it("accepts the exact origin and routes joins through the existing gateway", async () => {
    const { transport, room } = await createTransport({ allowedOrigin: TEST_ORIGIN });
    const socket = new WebSocket(`ws://127.0.0.1:${transport.getPort()}/ws`, {
      origin: TEST_ORIGIN,
    });
    socket.once("error", () => undefined);
    await once(socket, "open");

    try {
      const snapshot = room.getSnapshot();
      const joined = waitForMessage(socket);
      socket.send(JSON.stringify({
        type: "join_room",
        tableId: snapshot.tableId,
        actorId: snapshot.seats[0]?.occupantId,
        credential: TEST_JOIN_CREDENTIAL,
      }));
      expect(await joined).toMatchObject({
        type: "joined",
        tableId: snapshot.tableId,
      });
    } finally {
      await closeSocket(socket);
    }
  });

  it("applies the configured payload limit with compression disabled", async () => {
    const { transport } = await createTransport({ maximumPayloadBytes: 256 });
    const socket = new WebSocket(`ws://127.0.0.1:${transport.getPort()}/ws`, {
      perMessageDeflate: true,
    });
    socket.once("error", () => undefined);
    await once(socket, "open");

    try {
      expect(socket.extensions).toBe("");
      const closed = once(socket, "close");
      socket.send(Buffer.alloc(257, "a"));
      const [closeCode] = await closed;
      expect(closeCode).toBe(1009);
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    }
  });

  it("closes the listener and active gateway resources idempotently", async () => {
    const { transport } = await createTransport();
    const port = transport.getPort();

    await Promise.all([transport.close(), transport.close()]);
    await expect(requestHttp(port, "/livez")).rejects.toThrow();
  });
});
