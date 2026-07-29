import { describe, expect, it, vi } from "vitest";
import { PreviewApp } from "./preview-app.js";

interface PreviewAppLifecycleHarness {
  activeMode: "chip-set" | "table-mass";
  activeCasinoId: "sands-venetian";
  turntableEnabled: boolean;
  contentGroup: { rotation: { y: number } };
  contentBuildSequence: number;
  tableCommandPending: boolean;
  betInteraction: {
    dispose: () => void;
    playRoundToSettlement: () => Promise<void>;
    clearSeatBets: (seatLabel: number) => Promise<void>;
    getSession: () => { getGuestSeat: () => { label: number } };
  } | null;
  unsubscribeTableSession: (() => void) | null;
  feltMesh: null;
  disposeContent: () => void;
  buildFullTable: () => Promise<void>;
  updateInfoPanel: () => void;
  frameActiveContent: () => void;
  onCommandError: ((error: unknown) => void) | null;
  onTableStateChanged: (() => void) | null;
  rebuildContent: () => void;
  rebuildContentAsync: () => Promise<void>;
  setMode: (mode: "table-mass") => void;
  playRoundToSettlement: () => Promise<void>;
  clearGuestSeatBets: () => Promise<void>;
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createLifecycleHarness(): PreviewAppLifecycleHarness {
  const previewApp = Object.create(PreviewApp.prototype) as PreviewAppLifecycleHarness;
  previewApp.activeMode = "table-mass";
  previewApp.activeCasinoId = "sands-venetian";
  previewApp.turntableEnabled = true;
  previewApp.contentGroup = { rotation: { y: 0 } };
  previewApp.contentBuildSequence = 0;
  previewApp.tableCommandPending = true;
  previewApp.betInteraction = {
    dispose: vi.fn(),
    playRoundToSettlement: vi.fn().mockResolvedValue(undefined),
    clearSeatBets: vi.fn().mockResolvedValue(undefined),
    getSession: () => ({ getGuestSeat: () => ({ label: 3 }) }),
  };
  previewApp.unsubscribeTableSession = vi.fn();
  previewApp.feltMesh = null;
  previewApp.disposeContent = vi.fn();
  previewApp.buildFullTable = vi.fn().mockResolvedValue(undefined);
  previewApp.updateInfoPanel = vi.fn();
  previewApp.frameActiveContent = vi.fn();
  previewApp.onCommandError = null;
  previewApp.onTableStateChanged = null;
  return previewApp;
}

describe("PreviewApp asynchronous rebuild lifecycle", () => {
  it("notifies when the first table session finishes building", async () => {
    const factoryResult = createDeferred();
    const previewApp = createLifecycleHarness();
    const onTableStateChanged = vi.fn();
    previewApp.activeMode = "chip-set";
    previewApp.betInteraction = null;
    previewApp.unsubscribeTableSession = null;
    previewApp.onTableStateChanged = onTableStateChanged;
    previewApp.buildFullTable = vi.fn(async () => {
      await factoryResult.promise;
      previewApp.betInteraction = {
        dispose: vi.fn(),
        playRoundToSettlement: vi.fn().mockResolvedValue(undefined),
        clearSeatBets: vi.fn().mockResolvedValue(undefined),
        getSession: () => ({ getGuestSeat: () => ({ label: 3 }) }),
      };
      previewApp.unsubscribeTableSession = vi.fn();
    });

    previewApp.setMode("table-mass");

    expect(onTableStateChanged).toHaveBeenCalledOnce();
    expect(previewApp.betInteraction).toBeNull();

    factoryResult.resolve();
    await vi.waitFor(() => expect(onTableStateChanged).toHaveBeenCalledTimes(2));

    expect(previewApp.betInteraction).not.toBeNull();
    expect(previewApp.tableCommandPending).toBe(false);
    expect(previewApp.updateInfoPanel).toHaveBeenCalledOnce();
  });

  it("does not notify when a stale table build finishes", async () => {
    const staleFactoryResult = createDeferred();
    const previewApp = createLifecycleHarness();
    const onTableStateChanged = vi.fn();
    previewApp.onTableStateChanged = onTableStateChanged;
    previewApp.buildFullTable = vi
      .fn()
      .mockImplementationOnce(() => staleFactoryResult.promise)
      .mockImplementationOnce(async () => {
        previewApp.betInteraction = {
          dispose: vi.fn(),
          playRoundToSettlement: vi.fn().mockResolvedValue(undefined),
          clearSeatBets: vi.fn().mockResolvedValue(undefined),
          getSession: () => ({ getGuestSeat: () => ({ label: 3 }) }),
        };
        previewApp.unsubscribeTableSession = vi.fn();
      });

    const staleRebuild = previewApp.rebuildContentAsync();
    await previewApp.rebuildContentAsync();
    expect(onTableStateChanged).toHaveBeenCalledOnce();

    staleFactoryResult.resolve();
    await staleRebuild;

    expect(onTableStateChanged).toHaveBeenCalledOnce();
  });

  it("disables the old interaction before a replacement factory settles", async () => {
    const factoryResult = createDeferred();
    const previewApp = createLifecycleHarness();
    const oldInteraction = previewApp.betInteraction;
    const oldUnsubscribe = previewApp.unsubscribeTableSession;
    previewApp.buildFullTable = vi.fn(() => factoryResult.promise);

    const rebuild = previewApp.rebuildContentAsync();

    expect(oldInteraction?.dispose).toHaveBeenCalledOnce();
    expect(oldUnsubscribe).toHaveBeenCalledOnce();
    expect(previewApp.betInteraction).toBeNull();
    expect(previewApp.unsubscribeTableSession).toBeNull();
    expect(previewApp.tableCommandPending).toBe(false);
    await previewApp.playRoundToSettlement();
    await previewApp.clearGuestSeatBets();
    expect(oldInteraction?.playRoundToSettlement).not.toHaveBeenCalled();
    expect(oldInteraction?.clearSeatBets).not.toHaveBeenCalled();

    factoryResult.resolve();
    await rebuild;
  });

  it("reports a current factory failure once and allows a successful retry", async () => {
    const previewApp = createLifecycleHarness();
    const factoryError = new Error("session factory rejected");
    const onTableError = vi.fn();
    const onTableStateChanged = vi.fn();
    previewApp.onCommandError = onTableError;
    previewApp.onTableStateChanged = onTableStateChanged;
    previewApp.buildFullTable = vi
      .fn()
      .mockRejectedValueOnce(factoryError)
      .mockResolvedValueOnce(undefined);

    previewApp.rebuildContent();
    await vi.waitFor(() => expect(onTableError).toHaveBeenCalledOnce());

    expect(onTableError).toHaveBeenCalledWith(factoryError);
    expect(previewApp.tableCommandPending).toBe(false);
    expect(previewApp.betInteraction).toBeNull();
    expect(onTableStateChanged).toHaveBeenCalledOnce();

    await expect(previewApp.rebuildContentAsync()).resolves.toBeUndefined();
    expect(onTableError).toHaveBeenCalledOnce();
    expect(previewApp.updateInfoPanel).toHaveBeenCalledOnce();
  });

  it("captures a synchronous rebuild failure through the unified error callback", async () => {
    const previewApp = createLifecycleHarness();
    const rebuildError = new Error("content disposal failed");
    const onTableError = vi.fn();
    previewApp.onCommandError = onTableError;
    previewApp.disposeContent = vi
      .fn()
      .mockImplementationOnce(() => {
        throw rebuildError;
      })
      .mockImplementation(() => undefined);

    await expect(previewApp.rebuildContentAsync()).resolves.toBeUndefined();

    expect(onTableError).toHaveBeenCalledOnce();
    expect(onTableError).toHaveBeenCalledWith(rebuildError);
    expect(previewApp.tableCommandPending).toBe(false);
    expect(previewApp.betInteraction).toBeNull();
  });

  it("ignores an error from a stale build generation", async () => {
    const staleFactoryResult = createDeferred();
    const previewApp = createLifecycleHarness();
    const onTableError = vi.fn();
    previewApp.onCommandError = onTableError;
    previewApp.buildFullTable = vi
      .fn()
      .mockImplementationOnce(async () => {
        await staleFactoryResult.promise;
        throw new Error("stale failure");
      })
      .mockResolvedValueOnce(undefined);

    const staleRebuild = previewApp.rebuildContentAsync();
    await previewApp.rebuildContentAsync();
    staleFactoryResult.resolve();
    await expect(staleRebuild).resolves.toBeUndefined();

    expect(onTableError).not.toHaveBeenCalled();
  });
});
