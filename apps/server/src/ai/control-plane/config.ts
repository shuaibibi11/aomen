import { parseAllowedLlmEndpointHosts } from "./endpoint-policy.js";
import { decodeBase64url32ByteKey } from "./secret-encryption.js";

export type LlmControlPlaneEnvironment = Readonly<Record<string, string | undefined>>;

export interface DisabledLlmControlPlaneConfig {
  readonly mode: "disabled";
}

export interface PostgresLlmControlPlaneConfig {
  readonly mode: "postgres";
  readonly encryptionKey: string;
  readonly allowedHosts: readonly string[];
}

export type LlmControlPlaneConfig = DisabledLlmControlPlaneConfig | PostgresLlmControlPlaneConfig;

/**
 * Parses dormant control-plane configuration without integrating it into the
 * current application runtime. The existing AI_MODE path remains unchanged.
 */
export function resolveLlmControlPlaneConfig(
  environment: LlmControlPlaneEnvironment,
): LlmControlPlaneConfig {
  const mode = environment.LLM_CONTROL_PLANE_MODE;
  if (mode === undefined || mode === "disabled") {
    return { mode: "disabled" };
  }
  if (mode !== "postgres") {
    throw new Error("LLM_CONTROL_PLANE_MODE must be either disabled or postgres");
  }
  if (environment.PERSISTENCE_MODE !== "postgres") {
    throw new Error("LLM_CONTROL_PLANE_MODE=postgres requires PERSISTENCE_MODE=postgres");
  }
  const encryptionKey = environment.LLM_CREDENTIAL_ENCRYPTION_KEY;
  if (encryptionKey === undefined) {
    throw new Error("LLM_CREDENTIAL_ENCRYPTION_KEY is required when LLM_CONTROL_PLANE_MODE=postgres");
  }
  decodeBase64url32ByteKey(encryptionKey);
  return {
    mode: "postgres",
    encryptionKey,
    allowedHosts: parseAllowedLlmEndpointHosts(environment.LLM_ENDPOINT_ALLOWED_HOSTS),
  };
}
