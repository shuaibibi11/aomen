export interface LocalSessionRuntimeConfig {
  readonly runtime: "local";
}

export interface RemoteSessionRuntimeConfig {
  readonly runtime: "remote";
  readonly wsUrl: string;
  readonly tableId: string;
  readonly actorId: string;
  readonly credential: string;
}

export type SessionRuntimeConfig = LocalSessionRuntimeConfig | RemoteSessionRuntimeConfig;

export function readSessionRuntimeConfig(
  query: URLSearchParams,
  globalConfig?: Partial<RemoteSessionRuntimeConfig>,
): SessionRuntimeConfig {
  const selectedRuntime = query.get("runtime") ?? globalConfig?.runtime ?? "local";
  if (selectedRuntime !== "remote") return { runtime: "local" };

  const remoteConfig = {
    runtime: "remote" as const,
    wsUrl: query.get("wsUrl") ?? globalConfig?.wsUrl,
    tableId: query.get("tableId") ?? globalConfig?.tableId,
    actorId: query.get("actorId") ?? globalConfig?.actorId,
    credential: query.get("credential") ?? globalConfig?.credential,
  };
  for (const fieldName of ["wsUrl", "tableId", "actorId", "credential"] as const) {
    if (remoteConfig[fieldName]?.trim() === "" || remoteConfig[fieldName] === undefined) {
      throw new Error(`Remote session requires ${fieldName}`);
    }
  }
  return remoteConfig as RemoteSessionRuntimeConfig;
}
