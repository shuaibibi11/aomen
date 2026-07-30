import { request as createHttpRequest } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { App } from "./app.js";
import { startServer } from "./server-startup.js";

function createTestApp(
  eventLog: string[],
  isRoomFaulted = false,
): App {
  let schedulerRunning = false;
  return {
    store: {} as App["store"],
    roomManager: {} as App["roomManager"],
    demoTableId: "startup-test-table" as App["demoTableId"],
    demoRoom: {
      isFaulted: () => isRoomFaulted,
    } as App["demoRoom"],
    demoScheduler: {
      start: vi.fn(() => {
        schedulerRunning = true;
        eventLog.push("scheduler.start");
      }),
      stop: vi.fn(() => eventLog.push("scheduler.stop")),
      isRunning: () => schedulerRunning,
    } as unknown as App["demoScheduler"],
    automaticRoundTiming: {
      bettingWindowMs: 8_000,
      cardDealIntervalMs: 1_000,
      settlementDisplayMs: 3_000,
      interRoundDelayMs: 1_000,
    },
  };
}

function requestHttp(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = createHttpRequest({ host: "127.0.0.1", port, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.once("error", reject);
    request.end();
  });
}

describe("startServer", () => {
  it("waits for the HTTP transport before starting and logging bound endpoints", async () => {
    const eventLog: string[] = [];
    const app = createTestApp(eventLog);
    const transport = {
      waitUntilListening: vi.fn(async () => {
        eventLog.push("transport.listening");
      }),
      getPort: vi.fn(() => 43_123),
      close: vi.fn(async () => {
        eventLog.push("transport.close");
      }),
    };
    const log = vi.fn((message: string) => eventLog.push(`log:${message}`));
    const addSignalListener = vi.fn();
    const removeSignalListener = vi.fn();

    const options = {
      port: 0,
      host: "127.0.0.1" as const,
      allowedOrigin: undefined,
      maximumPayloadBytes: 32_768,
      environment: {},
      createApplication: async () => app,
      createTransport: vi.fn((transportOptions) => {
        eventLog.push(transportOptions.isReady() ? "transport.ready" : "transport.not_ready");
        return transport;
      }),
      log,
      addSignalListener,
      removeSignalListener,
    };
    const runningServer = await startServer(options);

    expect(options.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 0,
      host: "127.0.0.1",
      allowedOrigin: undefined,
      maximumPayloadBytes: 32_768,
      roomManager: app.roomManager,
    }));
    expect(eventLog.slice(0, 4)).toEqual([
      "transport.not_ready",
      "transport.listening",
      "scheduler.start",
      expect.stringContaining("http://127.0.0.1:43123"),
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ws://127.0.0.1:43123/ws"));
    expect(addSignalListener).toHaveBeenCalledTimes(2);

    await runningServer.shutdown();
    expect(app.demoScheduler.stop).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(removeSignalListener).toHaveBeenCalledTimes(2);
  });

  it("cleans startup resources and leaves no handlers when binding fails", async () => {
    const eventLog: string[] = [];
    const app = createTestApp(eventLog);
    const bindingError = new Error("address already in use");
    const transport = {
      waitUntilListening: vi.fn(async () => {
        throw bindingError;
      }),
      getPort: vi.fn(() => 0),
      close: vi.fn(async () => {
        eventLog.push("transport.close");
      }),
    };
    const addSignalListener = vi.fn();

    const options = {
      port: 0,
      host: "127.0.0.1" as const,
      allowedOrigin: undefined,
      maximumPayloadBytes: 65_536,
      environment: {},
      createApplication: async () => app,
      createTransport: () => transport,
      addSignalListener,
      removeSignalListener: vi.fn(),
    };
    await expect(
      startServer(options),
    ).rejects.toBe(bindingError);

    expect(app.demoScheduler.start).not.toHaveBeenCalled();
    expect(app.demoScheduler.stop).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(addSignalListener).not.toHaveBeenCalled();
  });

  it("rejects an incomplete postgres configuration before creating a room or gateway", async () => {
    const createApplication = vi.fn(async () => createTestApp([]));
    const createTransport = vi.fn(() => ({
      waitUntilListening: async () => undefined,
      getPort: () => 0,
      close: async () => undefined,
    }));

    await expect(
      startServer({
        port: 0,
        host: "127.0.0.1",
        allowedOrigin: undefined,
        maximumPayloadBytes: 65_536,
        environment: { PERSISTENCE_MODE: "postgres" },
        createApplication,
        createTransport,
        addSignalListener: vi.fn(),
        removeSignalListener: vi.fn(),
      }),
    ).rejects.toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");

    expect(createApplication).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("reports a faulted room as not ready through the default HTTP transport", async () => {
    const eventLog: string[] = [];
    const app = createTestApp(eventLog, true);
    const runningServer = await startServer({
      port: 0,
      host: "127.0.0.1",
      allowedOrigin: undefined,
      maximumPayloadBytes: 65_536,
      environment: {},
      createApplication: async () => app,
      addSignalListener: vi.fn(),
      removeSignalListener: vi.fn(),
      log: () => undefined,
    });

    try {
      expect(await requestHttp(runningServer.gateway.getPort(), "/healthz")).toEqual({
        statusCode: 503,
        body: '{"status":"not_ready"}',
      });
    } finally {
      await runningServer.shutdown();
    }
  });
});
