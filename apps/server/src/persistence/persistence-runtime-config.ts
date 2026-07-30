/** Server-only environment values accepted by persistence configuration. */
export type PersistenceRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface MemoryPersistenceRuntimeConfig {
  readonly mode: "memory";
}

export interface PostgresPersistenceRuntimeConfig {
  readonly mode: "postgres";
  readonly databaseUrl: string;
}

export type PersistenceRuntimeConfig =
  | MemoryPersistenceRuntimeConfig
  | PostgresPersistenceRuntimeConfig;

function isSecurePostgresUrl(databaseUrl: string): boolean {
  if (databaseUrl.trim() !== databaseUrl || databaseUrl.length === 0) {
    return false;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    return (
      (parsedUrl.protocol === "postgres:" || parsedUrl.protocol === "postgresql:") &&
      parsedUrl.hostname.length > 0 &&
      parsedUrl.pathname.length > 1
    );
  } catch {
    return false;
  }
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
  if (databaseUrl === undefined || !isSecurePostgresUrl(databaseUrl)) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL when PERSISTENCE_MODE=postgres");
  }

  return { mode: "postgres", databaseUrl };
}
