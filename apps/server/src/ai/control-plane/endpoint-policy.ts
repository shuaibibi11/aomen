import { isIP } from "node:net";

export const DEFAULT_LLM_ENDPOINT_ALLOWED_HOSTS = [
  "platform.rainflowtb.com",
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
] as const;

const INTERNAL_HOST_SUFFIXES = [".local", ".localhost", ".internal"];

function normalizeAllowedHostname(value: string): string {
  if (value.length === 0 || value.trim() !== value || value.includes(",") || isIP(value) !== 0) {
    throw new Error("LLM endpoint allowed hosts contains an invalid hostname");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(`https://${value}`);
  } catch {
    throw new Error("LLM endpoint allowed hosts contains an invalid hostname");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    parsedUrl.username.length > 0 ||
    parsedUrl.password.length > 0 ||
    parsedUrl.port.length > 0 ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search.length > 0 ||
    parsedUrl.hash.length > 0 ||
    hostname.length === 0 ||
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
  ) {
    throw new Error("LLM endpoint allowed hosts contains an invalid hostname");
  }
  return hostname;
}

/** Parses exact comma-separated DNS hostnames without permitting wildcards or IPs. */
export function parseAllowedLlmEndpointHosts(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [...DEFAULT_LLM_ENDPOINT_ALLOWED_HOSTS];
  }
  if (value.length === 0) {
    throw new Error("LLM_ENDPOINT_ALLOWED_HOSTS must not be empty when configured");
  }
  const hostnames = value.split(",").map(normalizeAllowedHostname);
  if (new Set(hostnames).size !== hostnames.length) {
    throw new Error("LLM_ENDPOINT_ALLOWED_HOSTS must not contain duplicate hostnames");
  }
  return hostnames;
}

/**
 * Enforces a strict configuration-time HTTPS endpoint policy. Network egress
 * controls remain responsible for DNS rebinding and upstream IP enforcement.
 */
export class LlmEndpointPolicy {
  private readonly allowedHosts: ReadonlySet<string>;

  constructor(allowedHosts: readonly string[]) {
    this.allowedHosts = new Set(allowedHosts.map(normalizeAllowedHostname));
    if (this.allowedHosts.size === 0) {
      throw new Error("LLM endpoint allowed hosts must not be empty");
    }
  }

  normalizeEndpoint(value: string): string {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new Error("LLM endpoint must be an allowed HTTPS service endpoint");
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username.length > 0 ||
      parsedUrl.password.length > 0 ||
      parsedUrl.port.length > 0 ||
      parsedUrl.search.length > 0 ||
      parsedUrl.hash.length > 0 ||
      isIP(hostname) !== 0 ||
      !this.allowedHosts.has(hostname)
    ) {
      throw new Error("LLM endpoint must be an allowed HTTPS service endpoint");
    }
    return parsedUrl.toString();
  }
}
