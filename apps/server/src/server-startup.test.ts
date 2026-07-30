import { describe, expect, it, vi } from "vitest";
import type { App } from "./app.js";
import { startServer } from "./server-startup.js";

function createTestApp(eventLog: string[]): App {
  return {
    store: {} as App["store"],
    roomManager: {} as App["roomManager"],
    demoTableId: "startup-test-table" as App["demoTableId"],
    demoRoom: {} as App["demoRoom"],
    demoScheduler: {
      start: vi.fn(() => eventLog.push("scheduler.start")),
      stop: vi.fn(() => eventLog.push("scheduler.stop")),
    } as unknown as App["demoScheduler"],
    automaticRoundTiming: {
      bettingWindowMs: 8_000,
      cardDealIntervalMs: 1_000,
      settlementDisplayMs: 3_000,
      interRoundDelayMs: 1_000,
    },
  };
}

describe("startServer", () => {
  it("waits for port zero to bind before starting and logging the actual port", async () => {
    const eventLog: string[] = [];
    const app = createTestApp(eventLog);
    const gateway = {
      waitUntilListening: vi.fn(async () => {
        eventLog.push("gateway.listening");
      }),
      getPort: vi.fn(() => 43_123),
      close: vi.fn(async () => {
        eventLog.push("gateway.close");
      }),
    };
    const log = vi.fn((message: string) => eventLog.push(`log:${message}`));
    const addSignalListener = vi.fn();
    const removeSignalListener = vi.fn();

    const runningServer = await startServer({
      port: 0,
      environment: {},
      createApplication: async () => app,
      createGateway: () => gateway,
      log,
      addSignalListener,
      removeSignalListener,
    });

    expect(eventLog.slice(0, 3)).toEqual([
      "gateway.listening",
      "scheduler.start",
      expect.stringContaining("ws://localhost:43123"),
    ]);
    expect(addSignalListener).toHaveBeenCalledTimes(2);

    await runningServer.shutdown();
    expect(app.demoScheduler.stop).toHaveBeenCalledOnce();
    expect(gateway.close).toHaveBeenCalledOnce();
    expect(removeSignalListener).toHaveBeenCalledTimes(2);
  });

  it("cleans startup resources and leaves no handlers when binding fails", async () => {
    const eventLog: string[] = [];
    const app = createTestApp(eventLog);
    const bindingError = new Error("address already in use");
    const gateway = {
      waitUntilListening: vi.fn(async () => {
        throw bindingError;
      }),
      getPort: vi.fn(() => 0),
      close: vi.fn(async () => {
        eventLog.push("gateway.close");
      }),
    };
    const addSignalListener = vi.fn();

    await expect(
      startServer({
        port: 0,
        environment: {},
        createApplication: async () => app,
        createGateway: () => gateway,
        addSignalListener,
        removeSignalListener: vi.fn(),
      }),
    ).rejects.toBe(bindingError);

    expect(app.demoScheduler.start).not.toHaveBeenCalled();
    expect(app.demoScheduler.stop).toHaveBeenCalledOnce();
    expect(gateway.close).toHaveBeenCalledOnce();
    expect(addSignalListener).not.toHaveBeenCalled();
  });

  it("rejects an incomplete postgres configuration before creating a room or gateway", async () => {
    const createApplication = vi.fn(async () => createTestApp([]));
    const createGateway = vi.fn(() => ({
      waitUntilListening: async () => undefined,
      getPort: () => 0,
      close: async () => undefined,
    }));

    await expect(
      startServer({
        port: 0,
        environment: { PERSISTENCE_MODE: "postgres" },
        createApplication,
        createGateway,
        addSignalListener: vi.fn(),
        removeSignalListener: vi.fn(),
      }),
    ).rejects.toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");

    expect(createApplication).not.toHaveBeenCalled();
    expect(createGateway).not.toHaveBeenCalled();
  });
});
