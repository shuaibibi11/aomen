import {
  resolvePersistenceRuntimeConfig,
  type PersistenceRuntimeConfig,
  type PersistenceRuntimeEnvironment,
} from "./persistence/persistence-runtime-config.js";

/**
 * Resolves settings that must be valid before constructing rooms or opening
 * network listeners. This slice validates PostgreSQL configuration only; it
 * intentionally does not connect to PostgreSQL or change room persistence.
 */
export function resolveServerStartupConfiguration(
  environment: PersistenceRuntimeEnvironment,
): PersistenceRuntimeConfig {
  return resolvePersistenceRuntimeConfig(environment);
}
