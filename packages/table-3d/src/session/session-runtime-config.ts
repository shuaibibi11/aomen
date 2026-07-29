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

export class InsecureSessionCredentialError extends Error {
  constructor() {
    super("Remote sessions require a secure in-memory credential; URL credentials are ignored");
    this.name = "InsecureSessionCredentialError";
  }
}

export function readSessionRuntimeConfig(
  query: URLSearchParams,
  globalConfig?: Partial<RemoteSessionRuntimeConfig>,
): SessionRuntimeConfig {
  const selectedRuntime = query.get("runtime") ?? globalConfig?.runtime ?? "local";
  if (selectedRuntime !== "remote") return { runtime: "local" };

  // Endpoint, identity, and credential form one trust unit. URL values are
  // intentionally never considered, so a crafted link cannot pair an
  // application credential with an attacker-controlled endpoint or identity.
  const remoteConfig = {
    runtime: "remote" as const,
    wsUrl: globalConfig?.wsUrl,
    tableId: globalConfig?.tableId,
    actorId: globalConfig?.actorId,
    credential: globalConfig?.credential,
  };
  for (const fieldName of ["wsUrl", "tableId", "actorId", "credential"] as const) {
    if (remoteConfig[fieldName]?.trim() === "" || remoteConfig[fieldName] === undefined) {
      if (fieldName === "credential") {
        throw new InsecureSessionCredentialError();
      }
      throw new Error(`Remote session requires ${fieldName}`);
    }
  }
  const serializableConfig = {
    runtime: remoteConfig.runtime,
    wsUrl: remoteConfig.wsUrl,
    tableId: remoteConfig.tableId,
    actorId: remoteConfig.actorId,
  } as RemoteSessionRuntimeConfig;
  Object.defineProperty(serializableConfig, "credential", {
    value: remoteConfig.credential,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(serializableConfig);
}
