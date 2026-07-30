import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_ALGORITHM = "scrypt";
const SCRYPT_VERSION = "v1";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const MAXIMUM_PASSWORD_LENGTH = 128;
const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordValidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: "invalid_password" }>;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedPasswordHash: string): Promise<boolean>;
}

export function validateTrainingPassword(password: string): PasswordValidationResult {
  if (
    typeof password !== "string" ||
    password.length < MINIMUM_PASSWORD_LENGTH ||
    password.length > MAXIMUM_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "invalid_password" };
  }

  return { ok: true };
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 32 * 1024 * 1024,
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

function parseEncodedPasswordHash(encodedPasswordHash: string): Readonly<{
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
    version !== SCRYPT_VERSION ||
    parameters !== `N=${SCRYPT_COST},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELIZATION}` ||
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
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT_SALT_LENGTH);
    const derivedHash = await deriveScryptKey(password, salt);

    return [
      SCRYPT_ALGORITHM,
      SCRYPT_VERSION,
      `N=${SCRYPT_COST},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELIZATION}`,
      salt.toString("base64url"),
      derivedHash.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedPasswordHash: string): Promise<boolean> {
    try {
      const parsedPasswordHash = parseEncodedPasswordHash(encodedPasswordHash);
      if (parsedPasswordHash === undefined) {
        return false;
      }

      const actualHash = await deriveScryptKey(password, parsedPasswordHash.salt);
      return timingSafeEqual(actualHash, parsedPasswordHash.expectedHash);
    } catch {
      return false;
    }
  }
}
