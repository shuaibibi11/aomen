import { createApp, type App } from "./app.js";
import type { PersistenceRuntimeEnvironment } from "./persistence/persistence-runtime-config.js";
import { resolveServerStartupConfiguration } from "./server-startup-configuration.js";
import { WsGateway } from "./ws-gateway.js";

type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface GatewayLifecycle {
  waitUntilListening(): Promise<void>;
  getPort(): number;
  close(): Promise<void>;
}

export interface StartServerOptions {
  readonly port: number;
  /** Allows tests and embedding hosts to supply startup settings explicitly. */
  readonly environment?: PersistenceRuntimeEnvironment;
  readonly createApplication?: () => Promise<App>;
  readonly createGateway?: (app: App, port: number) => GatewayLifecycle;
  readonly log?: (message: string) => void;
  readonly reportShutdownError?: (error: unknown) => void;
  readonly addSignalListener?: (
    signal: ShutdownSignal,
    listener: () => void,
  ) => void;
  readonly removeSignalListener?: (
    signal: ShutdownSignal,
    listener: () => void,
  ) => void;
}

export interface RunningServer {
  readonly app: App;
  readonly gateway: GatewayLifecycle;
  shutdown(): Promise<void>;
}

function formatListeningMessage(app: App, port: number): string {
  return (
    `Room server listening on ws://localhost:${port} ` +
    `(demo table "${app.demoTableId}", automatic timing ` +
    `betting=${app.automaticRoundTiming.bettingWindowMs}ms, ` +
    `card=${app.automaticRoundTiming.cardDealIntervalMs}ms, ` +
    `settlement=${app.automaticRoundTiming.settlementDisplayMs}ms, ` +
    `inter-round=${app.automaticRoundTiming.interRoundDelayMs}ms)`
  );
}

/** Bind the transport before starting background work or installing handlers. */
export async function startServer(
  options: StartServerOptions,
): Promise<RunningServer> {
  // Validate persistence settings before creating rooms or opening a listener.
  resolveServerStartupConfiguration(options.environment ?? process.env);

  const createApplication = options.createApplication ?? createApp;
  const createGateway =
    options.createGateway ??
    ((app, port) => new WsGateway({ port, roomManager: app.roomManager }));
  const log = options.log ?? console.log;
  const reportShutdownError =
    options.reportShutdownError ??
    ((error: unknown) => {
      console.error("Server shutdown failed:", error);
      process.exitCode = 1;
    });
  const addSignalListener =
    options.addSignalListener ??
    ((signal, listener) => process.on(signal, listener));
  const removeSignalListener =
    options.removeSignalListener ??
    ((signal, listener) => process.off(signal, listener));

  const app = await createApplication();
  let gateway: GatewayLifecycle | null = null;

  try {
    gateway = createGateway(app, options.port);
    await gateway.waitUntilListening();
    const boundPort = gateway.getPort();
    app.demoScheduler.start();
    log(formatListeningMessage(app, boundPort));
  } catch (startupError) {
    app.demoScheduler.stop();
    if (gateway !== null) {
      try {
        await gateway.close();
      } catch (cleanupError) {
        reportShutdownError(cleanupError);
      }
    }
    throw startupError;
  }
  const activeGateway = gateway;

  let shutdownPromise: Promise<void> | null = null;
  const handleSignal = (): void => {
    void shutdown().catch(reportShutdownError);
  };
  const removeShutdownHandlers = (): void => {
    removeSignalListener("SIGINT", handleSignal);
    removeSignalListener("SIGTERM", handleSignal);
  };
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== null) {
      return shutdownPromise;
    }

    removeShutdownHandlers();
    app.demoScheduler.stop();
    shutdownPromise = activeGateway.close();
    return shutdownPromise;
  };

  addSignalListener("SIGINT", handleSignal);
  addSignalListener("SIGTERM", handleSignal);

  return { app, gateway: activeGateway, shutdown };
}
