export const DEFAULT_SERVER_PORT = 8787;
export const DEFAULT_BIND_HOST = "127.0.0.1";
export const DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES = 65_536;
export const MAXIMUM_WEBSOCKET_PAYLOAD_BYTES = 1_048_576;

export interface ServerNetworkEnvironment {
  readonly PORT?: string;
  readonly BIND_HOST?: string;
  readonly ALLOWED_ORIGIN?: string;
  readonly WEBSOCKET_MAX_PAYLOAD_BYTES?: string;
  /** Deliberately ignored: compression is permanently disabled. */
  readonly WEBSOCKET_PER_MESSAGE_DEFLATE?: string;
}

export interface ServerNetworkConfig {
  readonly port: number;
  readonly host: "127.0.0.1" | "::1" | "localhost";
  readonly allowedOrigin: string | undefined;
  readonly maximumPayloadBytes: number;
  readonly perMessageDeflate: false;
}

const ALLOWED_BIND_HOSTS = new Set<ServerNetworkConfig["host"]>([
  "127.0.0.1",
  "::1",
  "localhost",
]);

function parseBoundedInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  variableName: string,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${variableName} must be an integer from ${minimum} to ${maximum}`);
  }

  const parsedValue = Number(value);
  if (
    !Number.isSafeInteger(parsedValue)
    || parsedValue < minimum
    || parsedValue > maximum
  ) {
    throw new Error(`${variableName} must be an integer from ${minimum} to ${maximum}`);
  }

  return parsedValue;
}

function resolveBindHost(value: string | undefined): ServerNetworkConfig["host"] {
  if (value === undefined) {
    return DEFAULT_BIND_HOST;
  }
  if (!ALLOWED_BIND_HOSTS.has(value as ServerNetworkConfig["host"])) {
    throw new Error("BIND_HOST must be one of 127.0.0.1, ::1, or localhost");
  }
  return value as ServerNetworkConfig["host"];
}

function resolveAllowedOrigin(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(value);
    const isHttpsOrigin = parsedUrl.protocol === "https:";
    const isExactOrigin = value === parsedUrl.origin;
    const hasNoUserInformation =
      parsedUrl.username.length === 0 && parsedUrl.password.length === 0;

    if (!isHttpsOrigin || !isExactOrigin || !hasNoUserInformation) {
      throw new Error("invalid origin");
    }
    return parsedUrl.origin;
  } catch {
    // Do not include a configured value in errors because it may be sensitive.
    throw new Error("ALLOWED_ORIGIN must be a canonical https origin");
  }
}

/** Resolve loopback-only HTTP and WebSocket listener settings without I/O. */
export function resolveServerNetworkConfig(
  environment: ServerNetworkEnvironment,
): ServerNetworkConfig {
  return {
    port: parseBoundedInteger(
      environment.PORT,
      DEFAULT_SERVER_PORT,
      1,
      65_535,
      "PORT",
    ),
    host: resolveBindHost(environment.BIND_HOST),
    allowedOrigin: resolveAllowedOrigin(environment.ALLOWED_ORIGIN),
    maximumPayloadBytes: parseBoundedInteger(
      environment.WEBSOCKET_MAX_PAYLOAD_BYTES,
      DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES,
      1,
      MAXIMUM_WEBSOCKET_PAYLOAD_BYTES,
      "WEBSOCKET_MAX_PAYLOAD_BYTES",
    ),
    // WebSocket compression remains disabled independently of environment input.
    perMessageDeflate: false,
  };
}
