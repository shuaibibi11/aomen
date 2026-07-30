import { describe, expect, it } from "vitest";

describe("ScryptPasswordHasher", () => {
  it("uses the versioned production configuration with a 128 MiB memory-hard baseline", async () => {
    const passwordModulePath = "./password-hasher.js";
    const passwordDomain = await import(passwordModulePath);

    expect(passwordDomain.DEFAULT_SCRYPT_PASSWORD_HASH_CONFIG).toMatchObject({
      version: "v2",
      cost: 131_072,
      blockSize: 8,
      parallelization: 1,
    });
    expect(passwordDomain.DEFAULT_SCRYPT_PASSWORD_HASH_CONFIG.maxmem).toBeGreaterThanOrEqual(
      256 * 1024 * 1024,
    );
  });

  it("hashes and verifies with the same explicit encoding version using test costs", async () => {
    const passwordModulePath = "./password-hasher.js";
    const passwordDomain = await import(passwordModulePath);
    const TestableScryptPasswordHasher = passwordDomain.ScryptPasswordHasher as unknown as new (
      configuration: Readonly<{
        version: string;
        cost: number;
        blockSize: number;
        parallelization: number;
        maxmem: number;
      }>,
    ) => {
      hash(password: string): Promise<string>;
      verify(password: string, encodedPasswordHash: string): Promise<boolean>;
    };
    const passwordHasher = new TestableScryptPasswordHasher({
      version: "v2",
      cost: 1_024,
      blockSize: 8,
      parallelization: 1,
      maxmem: 16 * 1024 * 1024,
    });
    const password = "correct horse battery staple";

    expect(passwordDomain.validateTrainingPassword(password)).toEqual({ ok: true });
    expect(passwordDomain.validateTrainingPassword("too-short")).toEqual({
      ok: false,
      error: "invalid_password",
    });
    expect(passwordDomain.validateTrainingPassword("a".repeat(129))).toEqual({
      ok: false,
      error: "invalid_password",
    });

    const passwordHash = await passwordHasher.hash(password);
    expect(passwordHash).toMatch(/^scrypt\$v2\$N=1024,r=8,p=1\$[^$]+\$[^$]+$/);
    await expect(passwordHasher.verify(password, passwordHash)).resolves.toBe(true);
    await expect(passwordHasher.verify("incorrect password", passwordHash)).resolves.toBe(false);
    await expect(passwordHasher.verify(password, "not-a-password-hash")).resolves.toBe(false);
  });
});
