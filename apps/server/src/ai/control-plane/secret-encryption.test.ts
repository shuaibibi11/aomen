import { describe, expect, it } from "vitest";
import { LlmCredentialEncryption } from "./secret-encryption.js";

const TEST_MASTER_KEY = Buffer.alloc(32, 9).toString("base64url");

describe("LlmCredentialEncryption", () => {
  it("round trips an API key with authenticated context and independent nonces", () => {
    const encryption = new LlmCredentialEncryption(TEST_MASTER_KEY, () => Buffer.alloc(12, 1));
    const encrypted = encryption.encrypt("credential-1", "provider-1", "test-only-api-key");
    expect(encrypted).not.toHaveProperty("secret");
    expect(encrypted).not.toHaveProperty("masterKey");
    expect(encryption.decrypt(encrypted)).toBe("test-only-api-key");
    const secondEncryption = new LlmCredentialEncryption(TEST_MASTER_KEY, () => Buffer.alloc(12, 2));
    expect(secondEncryption.encrypt("credential-1", "provider-1", "test-only-api-key").nonce).not.toEqual(encrypted.nonce);
  });

  it("rejects altered ciphertext, tag, or associated data without exposing plaintext", () => {
    const encryption = new LlmCredentialEncryption(TEST_MASTER_KEY, () => Buffer.alloc(12, 3));
    const encrypted = encryption.encrypt("credential-1", "provider-1", "test-only-plaintext");
    const alteredCiphertext = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext).map((byte) => byte ^ 1) };
    const alteredTag = { ...encrypted, authTag: Buffer.from(encrypted.authTag).map((byte) => byte ^ 1) };
    const alteredContext = { ...encrypted, providerId: "provider-2" };
    for (const candidate of [alteredCiphertext, alteredTag, alteredContext]) {
      expect(() => encryption.decrypt(candidate)).toThrow();
      try { encryption.decrypt(candidate); } catch (error) { expect(String(error)).not.toContain("test-only-plaintext"); }
    }
  });

  it("rejects non-canonical keys", () => {
    expect(() => new LlmCredentialEncryption("short")).toThrow();
    expect(() => new LlmCredentialEncryption(Buffer.alloc(32, 9).toString("base64"))).toThrow();
  });
});
