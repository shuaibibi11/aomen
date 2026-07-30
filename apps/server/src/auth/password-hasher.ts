import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_ALGORITHM = "scrypt";
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
export const MAXIMUM_TRAINING_PASSWORD_LENGTH = 128;
export const MINIMUM_TRAINING_PASSWORD_LENGTH = 12;

export interface ScryptPasswordHashConfig {
  readonly version: string;
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly maxmem: number;
}

/** Production password cost: scrypt requires approximately 128 MiB per derivation. */
export const DEFAULT_SCRYPT_PASSWORD_HASH_CONFIG: ScryptPasswordHashConfig = Object.freeze({
  version: "v2",
  cost: 131_072,
  blockSize: 8,
  parallelization: 1,
  maxmem: 256 * 1024 * 1024,
});

export type PasswordValidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: "invalid_password" }>;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedPasswordHash: string): Promise<boolean>;
  verifyUnknownPassword(password: string): Promise<boolean>;
}

export function validateTrainingPassword(password: string): PasswordValidationResult {
  if (
    typeof password !== "string" ||
    password.length < MINIMUM_TRAINING_PASSWORD_LENGTH ||
    password.length > MAXIMUM_TRAINING_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "invalid_password" };
  }

  return { ok: true };
}

function deriveScryptKey(
  password: string,
  salt: Buffer,
  configuration: ScryptPasswordHashConfig,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: configuration.cost,
        r: configuration.blockSize,
        p: configuration.parallelization,
        maxmem: configuration.maxmem,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(Buffer.from(derivedKey));
      },
    );
  });
}

function formatScryptParameters(configuration: ScryptPasswordHashConfig): string {
  return `N=${configuration.cost},r=${configuration.blockSize},p=${configuration.parallelization}`;
}

function parseEncodedPasswordHash(
  encodedPasswordHash: string,
  configuration: ScryptPasswordHashConfig,
): Readonly<{
  salt: Buffer;
  expectedHash: Buffer;
}> | undefined {
  const parts = encodedPasswordHash.split("$");
  if (parts.length !== 5) {
    return undefined;
  }

  const [algorithm, version, parameters, encodedSalt, encodedHash] = parts;
  if (
    algorithm !== SCRYPT_ALGORITHM ||
    version !== configuration.version ||
    parameters !== formatScryptParameters(configuration) ||
    encodedSalt === undefined ||
    encodedHash === undefined ||
    !/^[A-Za-z0-9_-]+$/.test(encodedSalt) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedHash)
  ) {
    return undefined;
  }

  const salt = Buffer.from(encodedSalt, "base64url");
  const expectedHash = Buffer.from(encodedHash, "base64url");
  if (salt.length !== SCRYPT_SALT_LENGTH || expectedHash.length !== SCRYPT_KEY_LENGTH) {
    return undefined;
  }

  return { salt, expectedHash };
}

/** Asynchronous Node scrypt implementation for password credentials. */
export class ScryptPasswordHasher implements PasswordHasher {
  private readonly unknownPasswordSalt = randomBytes(SCRYPT_SALT_LENGTH);
  private readonly unknownPasswordHash = randomBytes(SCRYPT_KEY_LENGTH);

  constructor(
    private readonly configuration: ScryptPasswordHashConfig = DEFAULT_SCRYPT_PASSWORD_HASH_CONFIG,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT_SALT_LENGTH);
    const derivedHash = await deriveScryptKey(password, salt, this.configuration);

    return [
      SCRYPT_ALGORITHM,
      this.configuration.version,
      formatScryptParameters(this.configuration),
      salt.toString("base64url"),
      derivedHash.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedPasswordHash: string): Promise<boolean> {
    try {
      const parsedPasswordHash = parseEncodedPasswordHash(encodedPasswordHash, this.configuration);
      if (parsedPasswordHash === undefined) {
        return false;
      }

      const actualHash = await deriveScryptKey(password, parsedPasswordHash.salt, this.configuration);
      return timingSafeEqual(actualHash, parsedPasswordHash.expectedHash);
    } catch {
      return false;
    }
  }

  /** Performs a full-cost comparison for an identity that has no stored hash. */
  async verifyUnknownPassword(password: string): Promise<boolean> {
    try {
      const actualHash = await deriveScryptKey(
        password,
        this.unknownPasswordSalt,
        this.configuration,
      );
      return timingSafeEqual(actualHash, this.unknownPasswordHash);
    } catch {
      return false;
    }
  }
}
