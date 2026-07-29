import { describe, expect, it } from "vitest";
import { readSessionRuntimeConfig } from "./session-runtime-config.js";

describe("readSessionRuntimeConfig", () => {
  it("defaults to local unless remote is explicitly selected", () => {
    expect(readSessionRuntimeConfig(new URLSearchParams())).toEqual({ runtime: "local" });
    expect(readSessionRuntimeConfig(new URLSearchParams("wsUrl=ws%3A%2F%2Fhost&credential=secret")))
      .toEqual({ runtime: "local" });
  });

  it("reads complete explicit remote query configuration", () => {
    expect(readSessionRuntimeConfig(new URLSearchParams(
      "runtime=remote&wsUrl=ws%3A%2F%2Fhost&tableId=table-1&actorId=actor-1&credential=secret",
    ))).toEqual({
      runtime: "remote",
      wsUrl: "ws://host",
      tableId: "table-1",
      actorId: "actor-1",
      credential: "secret",
    });
  });

  it("rejects an incomplete explicit remote configuration", () => {
    expect(() => readSessionRuntimeConfig(new URLSearchParams("runtime=remote")))
      .toThrow(/wsUrl/i);
  });
});
