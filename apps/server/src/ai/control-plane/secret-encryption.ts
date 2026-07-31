import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from "node:crypto";
import { requireNonEmptyIdentifier } from "./domain.js";

export interface EncryptedCredentialPayload {
  readonly credentialId: string;
  readonly providerId: string;
  readonly keyVersion: number;
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
}

export type RandomBytes = (size: number) => Buffer;

function decodeBase64url32ByteKey(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("LLM credential encryption key must be a base64url 32-byte key");
  }
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) {
    throw new Error("LLM credential encryption key must be a base64url 32-byte key");
  }
  return key;
}

function createAssociatedData(credentialId: string, providerId: string, keyVersion: number): Buffer {
  requireNonEmptyIdentifier(credentialId, "credentialId");
  requireNonEmptyIdentifier(providerId, "providerId");
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
    throw new Error("credential keyVersion must be a positive safe integer");
  }
  return Buffer.from(`${credentialId}\u0000${providerId}\u0000${keyVersion}`, "utf8");
}

/** Server-only AES-256-GCM credential cryptography with immutable AAD binding. */
export class LlmCredentialEncryption {
  private readonly masterKey: Buffer;

  constructor(masterKeyBase64url: string, private readonly randomBytes: RandomBytes = nodeRandomBytes) {
    this.masterKey = decodeBase64url32ByteKey(masterKeyBase64url);
  }

  encrypt(
    credentialId: string,
    providerId: string,
    apiKey: string,
    keyVersion = 1,
  ): EncryptedCredentialPayload {
    if (apiKey.length === 0) {
      throw new Error("LLM credential value must not be empty");
    }
    const nonce = this.randomBytes(12);
    if (nonce.length !== 12) {
      throw new Error("LLM credential encryption random source returned an invalid nonce");
    }
    const associatedData = createAssociatedData(credentialId, providerId, keyVersion);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, nonce);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    return {
      credentialId,
      providerId,
      keyVersion,
      nonce: Buffer.from(nonce),
      ciphertext,
      authTag: cipher.getAuthTag(),
    };
  }

  decrypt(payload: EncryptedCredentialPayload): string {
    try {
      if (payload.nonce.length !== 12 || payload.authTag.length !== 16) {
        throw new Error("invalid encrypted credential payload");
      }
      const decipher = createDecipheriv("aes-256-gcm", this.masterKey, payload.nonce);
      decipher.setAAD(createAssociatedData(payload.credentialId, payload.providerId, payload.keyVersion));
      decipher.setAuthTag(payload.authTag);
      return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Unable to decrypt LLM credential");
    }
  }
}

export { decodeBase64url32ByteKey };
