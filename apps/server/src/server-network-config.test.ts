import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES,
  resolveServerNetworkConfig,
} from "./server-network-config.js";

describe("resolveServerNetworkConfig", () => {
  it("allows local loopback operation when ALLOWED_ORIGIN is omitted", () => {
    expect(resolveServerNetworkConfig({})).toEqual({
      port: 8787,
      host: "127.0.0.1",
      allowedOrigin: undefined,
      maximumPayloadBytes: DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES,
      perMessageDeflate: false,
    });
  });

  it.each(["", " ", "0", "65536", "1.5", "NaN"])(
    "rejects unsafe port %j",
    (port) => {
      expect(() => resolveServerNetworkConfig({ PORT: port })).toThrow(
        "PORT must be an integer from 1 to 65535",
      );
    },
  );

  it.each(["127.0.0.1", "::1", "localhost"])(
    "accepts the explicit loopback host %s",
    (host) => {
      expect(resolveServerNetworkConfig({ BIND_HOST: host }).host).toBe(host);
    },
  );

  it.each(["", " ", "0.0.0.0", "::", "192.168.1.10", "localhost "])(
    "rejects non-loopback bind host %j",
    (host) => {
      expect(() => resolveServerNetworkConfig({ BIND_HOST: host })).toThrow(
        "BIND_HOST must be one of 127.0.0.1, ::1, or localhost",
      );
    },
  );

  it("parses a concrete canonical HTTP origin", () => {
    expect(
      resolveServerNetworkConfig({
        ALLOWED_ORIGIN: "https://203.0.113.10:8443",
      }).allowedOrigin,
    ).toBe("https://203.0.113.10:8443");
  });

  it.each([
    "",
    " ",
    "ftp://staging.example.test",
    "https://staging.example.test/path",
    "https://staging.example.test?query=yes",
    "https://staging.example.test#fragment",
    "https://user@staging.example.test",
    "HTTPS://staging.example.test",
  ])("rejects non-origin ALLOWED_ORIGIN %j", (origin) => {
    expect(() => resolveServerNetworkConfig({ ALLOWED_ORIGIN: origin })).toThrow(
      "ALLOWED_ORIGIN must be a canonical http or https origin",
    );

    if (origin.length > 1) {
      try {
        resolveServerNetworkConfig({ ALLOWED_ORIGIN: origin });
      } catch (error) {
        expect(String(error)).not.toContain(origin);
      }
    }
  });

  it.each(["", " ", "0", "1048577", "1.5", "NaN"])(
    "rejects unsafe payload limit %j",
    (maximumPayloadBytes) => {
      expect(() =>
        resolveServerNetworkConfig({ WEBSOCKET_MAX_PAYLOAD_BYTES: maximumPayloadBytes }),
      ).toThrow(
        "WEBSOCKET_MAX_PAYLOAD_BYTES must be an integer from 1 to 1048576",
      );
    },
  );

  it("uses an injected payload limit and ignores compression overrides", () => {
    expect(
      resolveServerNetworkConfig({
        WEBSOCKET_MAX_PAYLOAD_BYTES: "32768",
        WEBSOCKET_PER_MESSAGE_DEFLATE: "true",
      }),
    ).toMatchObject({
      maximumPayloadBytes: 32768,
      perMessageDeflate: false,
    });
  });
});
