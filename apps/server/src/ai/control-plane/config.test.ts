import { describe, expect, it } from "vitest";
import { resolveLlmControlPlaneConfig } from "./config.js";

describe("resolveLlmControlPlaneConfig", () => {
  it("defaults to disabled without requiring persistence or secrets", () => {
    expect(resolveLlmControlPlaneConfig({})).toEqual({ mode: "disabled" });
  });

  it("requires postgres persistence and an exact base64url 32-byte key", () => {
    expect(() => resolveLlmControlPlaneConfig({ LLM_CONTROL_PLANE_MODE: "postgres" })).toThrow();
    expect(() => resolveLlmControlPlaneConfig({ LLM_CONTROL_PLANE_MODE: "postgres", PERSISTENCE_MODE: "postgres", LLM_CREDENTIAL_ENCRYPTION_KEY: "not-a-key" })).toThrow();
  });

  it("accepts a valid opt-in postgres configuration without exposing its key", () => {
    const key = Buffer.alloc(32, 7).toString("base64url");
    expect(resolveLlmControlPlaneConfig({ LLM_CONTROL_PLANE_MODE: "postgres", PERSISTENCE_MODE: "postgres", LLM_CREDENTIAL_ENCRYPTION_KEY: key })).toMatchObject({ mode: "postgres", allowedHosts: expect.any(Array) });
  });

  it("rejects unknown modes without echoing secret values", () => {
    const secret = "test-only-control-plane-secret";
    expect(() => resolveLlmControlPlaneConfig({ LLM_CONTROL_PLANE_MODE: "unexpected", LLM_CREDENTIAL_ENCRYPTION_KEY: secret })).toThrow();
    expect(() => resolveLlmControlPlaneConfig({ LLM_CONTROL_PLANE_MODE: "unexpected", LLM_CREDENTIAL_ENCRYPTION_KEY: secret })).toThrowError(expect.not.objectContaining({ message: expect.stringContaining(secret) }));
  });
});
