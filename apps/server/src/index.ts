/**
 * Server entry point.
 *
 * Builds the app and opens the WebSocket gateway on PORT (default 8787). The
 * demo room's system dealer drives timed betting, dealing, and settlement
 * phases so a connected client sees a realistic round lifecycle.
 */
import { startServer } from "./server-startup.js";

const PORT = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  await startServer({ port: PORT });
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exitCode = 1;
});
