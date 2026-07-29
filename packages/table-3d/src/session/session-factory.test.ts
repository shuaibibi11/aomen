import { describe, expect, it } from "vitest";
import type { TableSession, TableSessionFactory } from "./table-session.js";
import { TableSessionController } from "./session-factory.js";

interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  readonly resolve: (value: TValue) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise!: (value: TValue) => void;
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createFakeSession(): TableSession & { disposeCalls: number } {
  const fakeSession = {
    disposeCalls: 0,
    dispose() {
      fakeSession.disposeCalls += 1;
    },
  };
  return fakeSession as unknown as TableSession & { disposeCalls: number };
}

describe("TableSessionController", () => {
  it("reuses an in-flight creation for the same variant without an active session", async () => {
    const massResult = createDeferred<TableSession>();
    const massSession = createFakeSession();
    let factoryCalls = 0;
    const factory: TableSessionFactory = () => {
      factoryCalls += 1;
      return massResult.promise;
    };
    const controller = new TableSessionController(factory);

    const firstOpeningMass = controller.open({ variant: "mass" });
    const secondOpeningMass = controller.open({ variant: "mass" });

    expect(secondOpeningMass).toBe(firstOpeningMass);
    expect(factoryCalls).toBe(1);

    massResult.resolve(massSession);
    expect(await firstOpeningMass).toBe(massSession);
    expect(controller.current).toBe(massSession);
    expect(massSession.disposeCalls).toBe(0);
  });

  it("does not let an older factory result replace the newest session", async () => {
    const massResult = createDeferred<TableSession>();
    const vipResult = createDeferred<TableSession>();
    let factoryCalls = 0;
    const factory: TableSessionFactory = (options) => {
      factoryCalls += 1;
      return options.variant === "mass" ? massResult.promise : vipResult.promise;
    };
    const controller = new TableSessionController(factory);
    const massSession = createFakeSession();
    const vipSession = createFakeSession();

    const openingMass = controller.open({ variant: "mass" });
    const openingVip = controller.open({ variant: "vip" });
    massResult.resolve(massSession);
    await openingMass;
    const repeatedOpeningVip = controller.open({ variant: "vip" });

    expect(repeatedOpeningVip).toBe(openingVip);
    expect(factoryCalls).toBe(2);

    vipResult.resolve(vipSession);
    await openingVip;

    expect(controller.current).toBe(vipSession);
    expect(massSession.disposeCalls).toBe(1);
    expect(vipSession.disposeCalls).toBe(0);
  });

  it("invalidates a pending replacement before reusing the active variant", async () => {
    const vipResult = createDeferred<TableSession>();
    const massSession = createFakeSession();
    const vipSession = createFakeSession();
    let factoryCalls = 0;
    const factory: TableSessionFactory = (options) => {
      factoryCalls += 1;
      return options.variant === "mass"
        ? Promise.resolve(massSession)
        : vipResult.promise;
    };
    const controller = new TableSessionController(factory);

    await controller.open({ variant: "mass" });
    const openingVip = controller.open({ variant: "vip" });
    const reopenedMass = await controller.open({ variant: "mass" });
    vipResult.resolve(vipSession);
    const staleVip = await openingVip;

    expect(reopenedMass).toBe(massSession);
    expect(staleVip).toBeNull();
    expect(controller.current).toBe(massSession);
    expect(vipSession.disposeCalls).toBe(1);
    expect(massSession.disposeCalls).toBe(0);
    expect(factoryCalls).toBe(2);
  });

  it("reuses a pending replacement for its variant while another session is active", async () => {
    const vipResult = createDeferred<TableSession>();
    const massSession = createFakeSession();
    const vipSession = createFakeSession();
    let factoryCalls = 0;
    const factory: TableSessionFactory = (options) => {
      factoryCalls += 1;
      return options.variant === "mass"
        ? Promise.resolve(massSession)
        : vipResult.promise;
    };
    const controller = new TableSessionController(factory);

    await controller.open({ variant: "mass" });
    const firstOpeningVip = controller.open({ variant: "vip" });
    const secondOpeningVip = controller.open({ variant: "vip" });

    expect(secondOpeningVip).toBe(firstOpeningVip);
    expect(factoryCalls).toBe(2);

    vipResult.resolve(vipSession);
    expect(await firstOpeningVip).toBe(vipSession);
    expect(controller.current).toBe(vipSession);
    expect(massSession.disposeCalls).toBe(1);
    expect(vipSession.disposeCalls).toBe(0);
  });
});
