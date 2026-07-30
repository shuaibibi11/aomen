import { createApp, type App } from "./app.js";
import type { PersistenceRuntimeEnvironment } from "./persistence/persistence-runtime-config.js";
import {
  ServerTransport,
  type ServerTransportOptions,
} from "./server-transport.js";
import { resolveServerStartupConfiguration } from "./server-startup-configuration.js";
import type { ServerNetworkConfig } from "./server-network-config.js";

type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface GatewayLifecycle {
  waitUntilListening(): Promise<void>;
  getPort(): number;
  close(): Promise<void>;
}

export interface StartServerOptions {
  readonly port: number;
  readonly host: ServerNetworkConfig["host"];
  readonly allowedOrigin: string | undefined;
  readonly maximumPayloadBytes: number;
  /** Allows tests and embedding hosts to supply startup settings explicitly. */
  readonly environment?: PersistenceRuntimeEnvironment;
  readonly createApplication?: () => Promise<App>;
  readonly createTransport?: (options: ServerTransportOptions) => GatewayLifecycle;
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

function formatUrlHost(host: ServerNetworkConfig["host"]): string {
  return host.includes(":") ? `[${host}]` : host;
}

function formatListeningMessage(
  app: App,
  host: ServerNetworkConfig["host"],
  port: number,
): string {
  const urlHost = formatUrlHost(host);
  return (
    `Room server listening on http://${urlHost}:${port} and ws://${urlHost}:${port}/ws ` +
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
  const createTransport = options.createTransport ??
    ((transportOptions: ServerTransportOptions) => new ServerTransport(transportOptions));
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
  let transport: GatewayLifecycle | null = null;

  try {
    transport = createTransport({
      port: options.port,
      host: options.host,
      allowedOrigin: options.allowedOrigin,
      maximumPayloadBytes: options.maximumPayloadBytes,
      roomManager: app.roomManager,
      isReady: () => app.demoScheduler.isRunning() && !app.demoRoom.isFaulted(),
    });
    await transport.waitUntilListening();
    const boundPort = transport.getPort();
    app.demoScheduler.start();
    log(formatListeningMessage(app, options.host, boundPort));
  } catch (startupError) {
    app.demoScheduler.stop();
    if (transport !== null) {
      try {
        await transport.close();
      } catch (cleanupError) {
        reportShutdownError(cleanupError);
      }
    }
    throw startupError;
  }
  const activeTransport = transport;

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
    shutdownPromise = activeTransport.close();
    return shutdownPromise;
  };

  addSignalListener("SIGINT", handleSignal);
  addSignalListener("SIGTERM", handleSignal);

  return { app, gateway: activeTransport, shutdown };
}
