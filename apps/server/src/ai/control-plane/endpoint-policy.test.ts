import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_ENDPOINT_ALLOWED_HOSTS,
  LlmEndpointPolicy,
  parseAllowedLlmEndpointHosts,
} from "./endpoint-policy.js";

describe("LlmEndpointPolicy", () => {
  it("normalizes an allowed HTTPS endpoint to a canonical URL", () => {
    const policy = new LlmEndpointPolicy(["API.OpenAI.com"]);

    expect(policy.normalizeEndpoint("HTTPS://API.OpenAI.com:443/v1/messages")).toBe(
      "https://api.openai.com/v1/messages",
    );
  });

  it.each([
    "http://api.openai.com/v1",
    "https://user:password@api.openai.com/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
    "https://api.openai.com:8443/v1",
    "https://api.openai.com/v1?token=not-a-secret",
    "https://api.openai.com/v1#fragment",
    "https://untrusted.example/v1",
    "https://api.openai.com.evil.example/v1",
  ])("rejects unsafe endpoint %s without echoing the URL", (endpoint) => {
    const policy = new LlmEndpointPolicy(["api.openai.com"]);

    expect(() => policy.normalizeEndpoint(endpoint)).toThrow();
    expect(() => policy.normalizeEndpoint(endpoint)).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(endpoint) }),
    );
  });

  it("rejects malformed allowlist entries and uses safe defaults when omitted", () => {
    expect(parseAllowedLlmEndpointHosts(undefined)).toEqual(
      DEFAULT_LLM_ENDPOINT_ALLOWED_HOSTS,
    );
    expect(() => parseAllowedLlmEndpointHosts("api.openai.com,,api.anthropic.com")).toThrow();
    expect(() => parseAllowedLlmEndpointHosts("*.openai.com")).toThrow();
    expect(() => parseAllowedLlmEndpointHosts("127.0.0.1")).toThrow();
  });
});
