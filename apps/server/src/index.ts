/**
 * Server entry point.
 *
 * Builds the app and opens the WebSocket gateway on PORT (default 8787). The
 * demo room's system dealer drives a round on a fixed interval so a connected
 * client sees live events without a human dealer.
 */
import { createApp } from "./app.js";
import { WsGateway } from "./ws-gateway.js";

const PORT = Number(process.env.PORT ?? 8787);
/** How often the system dealer plays a round, in milliseconds. */
const ROUND_INTERVAL_MS = 8000;

async function main(): Promise<void> {
  const app = await createApp();
  const gateway = new WsGateway({ port: PORT, roomManager: app.roomManager });

  // Drive the demo table with the system dealer so clients see live rounds.
  const timer = setInterval(() => {
    try {
      app.demoRoom.playAutomaticRound();
    } catch (error) {
      console.error("Round tick failed:", error);
    }
  }, ROUND_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(timer);
    gateway.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `Room server listening on ws://localhost:${PORT} ` +
      `(demo table "${app.demoTableId}", system dealer every ${ROUND_INTERVAL_MS}ms)`,
  );
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
