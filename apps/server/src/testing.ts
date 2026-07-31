export { MemoryEventStore } from "./memory-event-store.js";
export { RoomManager } from "./room-manager.js";
export { ServerTransport, type ServerTransportOptions } from "./server-transport.js";
export { WsGateway, type WsGatewayOptions } from "./ws-gateway.js";

import type { RoomManager } from "./room-manager.js";
import {
  DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES,
  type ServerNetworkConfig,
} from "./server-network-config.js";
import { ServerTransport } from "./server-transport.js";
import { WsGateway } from "./ws-gateway.js";

/** Options for the loopback-only transport used by server integration tests. */
export interface TestServerTransportOptions {
  readonly roomManager: RoomManager;
  readonly port?: number;
  readonly host?: ServerNetworkConfig["host"];
  readonly allowedOrigin?: string;
  readonly maximumPayloadBytes?: number;
  readonly isReady?: () => boolean;
  readonly onError?: (error: unknown) => void;
}

/** A ready transport, its gateway, and one idempotent shutdown lifecycle. */
export interface TestServerTransport {
  readonly transport: ServerTransport;
  readonly gateway: WsGateway;
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * Create a ready loopback transport for tests.
 *
 * The returned gateway is always managed by ServerTransport. Callers must use
 * the returned close lifecycle rather than constructing a listener themselves.
 */
export async function createTestServerTransport(
  options: TestServerTransportOptions,
): Promise<TestServerTransport> {
  const transportOptions = {
    port: options.port ?? 0,
    host: options.host ?? "127.0.0.1",
    roomManager: options.roomManager,
    allowedOrigin: options.allowedOrigin,
    maximumPayloadBytes:
      options.maximumPayloadBytes ?? DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES,
    isReady: options.isReady ?? (() => true),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  };
  const transport = new ServerTransport(transportOptions);

  try {
    await transport.waitUntilListening();
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }

  return {
    transport,
    gateway: transport.getGateway(),
    port: transport.getPort(),
    close: () => transport.close(),
  };
}
