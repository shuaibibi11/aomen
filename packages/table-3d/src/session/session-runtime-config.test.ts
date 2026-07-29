import { describe, expect, it } from "vitest";
import { readSessionRuntimeConfig } from "./session-runtime-config.js";

describe("readSessionRuntimeConfig", () => {
  it("defaults to local unless remote is explicitly selected", () => {
    expect(readSessionRuntimeConfig(new URLSearchParams())).toEqual({ runtime: "local" });
    expect(readSessionRuntimeConfig(new URLSearchParams("wsUrl=ws%3A%2F%2Fhost&credential=secret")))
      .toEqual({ runtime: "local" });
  });

  it("uses the complete trusted in-memory remote configuration", () => {
    const query = new URLSearchParams(
      "runtime=remote&camera=dealer",
    );
    const config = readSessionRuntimeConfig(query, {
      runtime: "remote",
      wsUrl: "wss://trusted.example/room",
      tableId: "trusted-table",
      actorId: "trusted-actor",
      credential: "trusted-secret",
    });

    expect(config).toEqual({
      runtime: "remote",
      wsUrl: "wss://trusted.example/room",
      tableId: "trusted-table",
      actorId: "trusted-actor",
    });
    expect(config.runtime === "remote" && config.credential).toBe("trusted-secret");
    expect(JSON.stringify(config)).not.toContain("trusted-secret");
  });

  it("ignores every URL endpoint, identity, and credential override", () => {
    const query = new URLSearchParams(
      "runtime=remote&wsUrl=wss%3A%2F%2Fevil.example%2Fsteal&tableId=evil-table&actorId=evil-actor&credential=evil-secret",
    );
    const config = readSessionRuntimeConfig(query, {
      runtime: "remote",
      wsUrl: "wss://trusted.example/room",
      tableId: "trusted-table",
      actorId: "trusted-actor",
      credential: "trusted-secret",
    });

    expect(config).toMatchObject({
      runtime: "remote",
      wsUrl: "wss://trusted.example/room",
      tableId: "trusted-table",
      actorId: "trusted-actor",
    });
    expect(config.runtime === "remote" && config.credential).toBe("trusted-secret");
    expect(JSON.stringify(config)).not.toContain("evil");
  });

  it("rejects remote selection unless the trusted configuration is complete", () => {
    expect(() => readSessionRuntimeConfig(new URLSearchParams("runtime=remote")))
      .toThrow(/wsUrl/i);
    expect(() => readSessionRuntimeConfig(
      new URLSearchParams("runtime=remote&wsUrl=wss%3A%2F%2Fevil.example&tableId=evil&actorId=evil&credential=evil"),
    )).toThrow(/wsUrl/i);
  });
});
