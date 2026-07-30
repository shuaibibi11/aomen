import type { PersistenceRuntimeEnvironment } from "./persistence/persistence-runtime-config.js";
import {
  resolveServerNetworkConfig,
  type ServerNetworkEnvironment,
} from "./server-network-config.js";
import {
  startServer,
  type RunningServer,
  type StartServerOptions,
} from "./server-startup.js";

export interface ServerRuntimeEnvironment
  extends PersistenceRuntimeEnvironment, ServerNetworkEnvironment {}

export type StartServer = (options: StartServerOptions) => Promise<RunningServer>;

/** Resolve the full injected runtime environment before opening a listener. */
export function startConfiguredServer(
  environment: ServerRuntimeEnvironment,
  startServerFunction: StartServer = startServer,
): Promise<RunningServer> {
  const networkConfig = resolveServerNetworkConfig(environment);
  return startServerFunction({
    port: networkConfig.port,
    host: networkConfig.host,
    allowedOrigin: networkConfig.allowedOrigin,
    maximumPayloadBytes: networkConfig.maximumPayloadBytes,
    environment,
  });
}
