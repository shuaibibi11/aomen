import { describe, expect, it } from "vitest";
import { readSessionRuntimeConfig } from "./session-runtime-config.js";

describe("readSessionRuntimeConfig", () => {
  it("defaults to local unless remote is explicitly selected", () => {
    expect(readSessionRuntimeConfig(new URLSearchParams())).toEqual({ runtime: "local" });
    expect(readSessionRuntimeConfig(new URLSearchParams("wsUrl=ws%3A%2F%2Fhost&credential=secret")))
      .toEqual({ runtime: "local" });
  });

  it("combines non-sensitive URL fields with an injected in-memory credential", () => {
    const query = new URLSearchParams(
      "runtime=remote&wsUrl=ws%3A%2F%2Fhost&tableId=table-1&actorId=actor-1",
    );
    const config = readSessionRuntimeConfig(query, { credential: "secret" });

    expect(config).toEqual({
      runtime: "remote",
      wsUrl: "ws://host",
      tableId: "table-1",
      actorId: "actor-1",
    });
    expect(config.runtime === "remote" && config.credential).toBe("secret");
    expect(JSON.stringify(config)).not.toContain("secret");
    expect(query.toString()).not.toContain("secret");
  });

  it("ignores URL credentials and rejects remote mode without an injected credential", () => {
    const query = new URLSearchParams(
      "runtime=remote&wsUrl=ws%3A%2F%2Fhost&tableId=table-1&actorId=actor-1&credential=url-secret",
    );

    expect(() => readSessionRuntimeConfig(query)).toThrow(/credential.*URL|secure.*credential/i);
    try {
      readSessionRuntimeConfig(query);
    } catch (error) {
      expect(String(error)).not.toContain("url-secret");
    }
  });

  it("rejects an incomplete explicit remote configuration", () => {
    expect(() => readSessionRuntimeConfig(new URLSearchParams("runtime=remote")))
      .toThrow(/wsUrl/i);
  });
});
