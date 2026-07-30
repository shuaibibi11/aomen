/** Server-only environment values accepted by persistence configuration. */
export type PersistenceRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface MemoryPersistenceRuntimeConfig {
  readonly mode: "memory";
}

export type PostgresTlsMode = "disable" | "verify-full";

export interface PostgresPersistenceRuntimeConfig {
  readonly mode: "postgres";
  readonly databaseUrl: string;
  readonly tlsMode: PostgresTlsMode;
}

export type PersistenceRuntimeConfig =
  | MemoryPersistenceRuntimeConfig
  | PostgresPersistenceRuntimeConfig;

function parsePostgresUrl(databaseUrl: string): URL | undefined {
  if (databaseUrl.trim() !== databaseUrl || databaseUrl.length === 0) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    if (
      (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") ||
      parsedUrl.pathname.length <= 1 ||
      Array.from(parsedUrl.searchParams.keys()).some((parameterName) =>
        parameterName.toLowerCase().startsWith("ssl"),
      )
    ) {
      return undefined;
    }

    const usesUnixSocket =
      parsedUrl.hostname.length === 0 &&
      parsedUrl.searchParams.get("host")?.startsWith("/") === true;
    if (parsedUrl.hostname.length === 0 && !usesUnixSocket) {
      return undefined;
    }

    return parsedUrl;
  } catch {
    return undefined;
  }
}

function isExplicitLocalDatabaseEndpoint(parsedUrl: URL): boolean {
  if (parsedUrl.hostname.length === 0) {
    return parsedUrl.searchParams.get("host")?.startsWith("/") === true;
  }

  if (parsedUrl.searchParams.has("host")) {
    return false;
  }

  return ["127.0.0.1", "[::1]", "::1", "localhost"].includes(
    parsedUrl.hostname.toLowerCase(),
  );
}

function resolvePostgresTlsMode(
  environment: PersistenceRuntimeEnvironment,
  parsedDatabaseUrl: URL,
): PostgresTlsMode {
  const configuredTlsMode = environment.DATABASE_TLS_MODE ?? "verify-full";
  if (configuredTlsMode === "verify-full") {
    return "verify-full";
  }

  if (configuredTlsMode === "disable" && isExplicitLocalDatabaseEndpoint(parsedDatabaseUrl)) {
    return "disable";
  }

  throw new Error(
    "DATABASE_TLS_MODE must be verify-full, or disable for an explicit local PostgreSQL endpoint",
  );
}

/**
 * Parses the opt-in persistence mode without logging or embedding DATABASE_URL
 * in errors. Existing server startup intentionally keeps the memory default.
 */
export function resolvePersistenceRuntimeConfig(
  environment: PersistenceRuntimeEnvironment,
): PersistenceRuntimeConfig {
  const mode = environment.PERSISTENCE_MODE;
  if (mode === undefined || mode === "memory") {
    return { mode: "memory" };
  }

  if (mode !== "postgres") {
    throw new Error("PERSISTENCE_MODE must be either memory or postgres");
  }

  const databaseUrl = environment.DATABASE_URL;
  const parsedDatabaseUrl = databaseUrl === undefined ? undefined : parsePostgresUrl(databaseUrl);
  if (parsedDatabaseUrl === undefined || databaseUrl === undefined) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL when PERSISTENCE_MODE=postgres");
  }

  return {
    mode: "postgres",
    databaseUrl,
    tlsMode: resolvePostgresTlsMode(environment, parsedDatabaseUrl),
  };
}
