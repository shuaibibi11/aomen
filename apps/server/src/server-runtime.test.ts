import { describe, expect, it, vi } from "vitest";
import type { RunningServer, StartServerOptions } from "./server-startup.js";
import { startConfiguredServer } from "./server-runtime.js";

describe("startConfiguredServer", () => {
  it("resolves injected network settings before passing them to startup", async () => {
    const startServer = vi.fn(async (_options: StartServerOptions) => {
      return {} as RunningServer;
    });
    const environment = {
      PORT: "9443",
      BIND_HOST: "::1",
      ALLOWED_ORIGIN: "https://staging.example.test:8443",
      WEBSOCKET_MAX_PAYLOAD_BYTES: "32768",
      PERSISTENCE_MODE: "memory",
    };

    await startConfiguredServer(environment, startServer);

    expect(startServer).toHaveBeenCalledWith({
      port: 9443,
      host: "::1",
      allowedOrigin: "https://staging.example.test:8443",
      maximumPayloadBytes: 32_768,
      environment,
    });
  });
});
