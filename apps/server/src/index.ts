/**
 * Server entry point.
 *
 * Builds the app and opens the WebSocket gateway on PORT (default 8787). The
 * demo room's system dealer drives timed betting, dealing, and settlement
 * phases so a connected client sees a realistic round lifecycle.
 */
import { createApp } from "./app.js";
import { WsGateway } from "./ws-gateway.js";

const PORT = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  const app = await createApp();
  const gateway = new WsGateway({ port: PORT, roomManager: app.roomManager });
  app.demoScheduler.start();

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== null) {
      return shutdownPromise;
    }
    app.demoScheduler.stop();
    shutdownPromise = gateway.close().catch((error: unknown) => {
      console.error("Server shutdown failed:", error);
      process.exitCode = 1;
    });
    return shutdownPromise;
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log(
    `Room server listening on ws://localhost:${PORT} ` +
      `(demo table "${app.demoTableId}", automatic timing ` +
      `betting=${app.automaticRoundTiming.bettingWindowMs}ms, ` +
      `card=${app.automaticRoundTiming.cardDealIntervalMs}ms, ` +
      `settlement=${app.automaticRoundTiming.settlementDisplayMs}ms, ` +
      `inter-round=${app.automaticRoundTiming.interRoundDelayMs}ms)`,
  );
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exitCode = 1;
});
