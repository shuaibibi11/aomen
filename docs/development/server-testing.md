# Server testing boundary

Use the `@mct/server/testing` export for server integration tests. The
`createTestServerTransport` helper creates one loopback `ServerTransport` with
an internal `WebSocketServer({ noServer: true })`, waits for its listener, and
returns the ready port, managed gateway, and idempotent close lifecycle.

```ts
import {
  createTestServerTransport,
  MemoryEventStore,
  RoomManager,
} from "@mct/server/testing";

const testServer = await createTestServerTransport({
  roomManager: new RoomManager(new MemoryEventStore()),
});

const websocketUrl = `ws://127.0.0.1:${testServer.port}/ws`;
// testServer.gateway is available for gateway-level assertions.
await testServer.close();
```

The migration helper is additive to the existing testing exports, so consumers
that already import `MemoryEventStore`, `RoomManager`, `ServerTransport`, or
`WsGateway` continue to typecheck. It is the preferred replacement for tests
that previously assembled a separate HTTP listener around `WsGateway`.

`WsGateway` intentionally has no `port`, `host`, or `listen` option. It accepts
only an injected `WebSocketServer` in `noServer` mode. `ServerTransport` remains
the sole owner of the HTTP listener, upgrade checks, WebSocket server, and
shutdown ordering. Do not call `listen` from a test or attach a WebSocket
server directly to a gateway.

