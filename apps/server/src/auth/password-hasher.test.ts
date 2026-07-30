import { describe, expect, it } from "vitest";

describe("ScryptPasswordHasher", () => {
  it("hashes valid passwords and safely rejects incorrect or malformed hashes", async () => {
    const passwordModulePath = "./password-hasher.js";
    const passwordDomain = await import(passwordModulePath);
    const passwordHasher = new passwordDomain.ScryptPasswordHasher();
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
    expect(passwordHash).toMatch(/^scrypt\$v1\$N=16384,r=8,p=1\$[^$]+\$[^$]+$/);
    await expect(passwordHasher.verify(password, passwordHash)).resolves.toBe(true);
    await expect(passwordHasher.verify("incorrect password", passwordHash)).resolves.toBe(false);
    await expect(passwordHasher.verify(password, "not-a-password-hash")).resolves.toBe(false);
  });
});
