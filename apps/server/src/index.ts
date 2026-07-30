/**
 * Server entry point.
 *
 * Builds the app and opens one loopback HTTP and WebSocket listener. The demo
 * room's system dealer drives timed betting, dealing, and settlement phases
 * so a connected client sees a realistic round lifecycle.
 */
import { loadRepositoryEnvironment } from "./server-environment.js";
import { startConfiguredServer } from "./server-runtime.js";

loadRepositoryEnvironment(import.meta.url);

async function main(): Promise<void> {
  await startConfiguredServer(process.env);
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exitCode = 1;
});
