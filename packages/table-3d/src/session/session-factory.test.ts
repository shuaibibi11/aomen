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
  it("does not let an older factory result replace the newest session", async () => {
    const massResult = createDeferred<TableSession>();
    const vipResult = createDeferred<TableSession>();
    const factory: TableSessionFactory = (options) =>
      options.variant === "mass" ? massResult.promise : vipResult.promise;
    const controller = new TableSessionController(factory);
    const massSession = createFakeSession();
    const vipSession = createFakeSession();

    const openingMass = controller.open({ variant: "mass" });
    const openingVip = controller.open({ variant: "vip" });
    vipResult.resolve(vipSession);
    await openingVip;
    massResult.resolve(massSession);
    await openingMass;

    expect(controller.current).toBe(vipSession);
    expect(massSession.disposeCalls).toBe(1);
    expect(vipSession.disposeCalls).toBe(0);
  });
});
