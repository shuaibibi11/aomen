import { describe, expect, it } from "vitest";
import { InviteAuthService } from "./invite-auth-service.js";
import { MemoryInviteAuthRepository } from "./memory-invite-auth-repository.js";
import type { PasswordHasher } from "./password-hasher.js";

const TEST_PASSWORD = "correct horse battery staple";

class DeterministicPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `test-hash:${password}`;
  }

  async verify(password: string, encodedPasswordHash: string): Promise<boolean> {
    return encodedPasswordHash === `test-hash:${password}`;
  }
}

function createDeterministicRandomBytes(): (size: number) => Buffer {
  let sequence = 0;
  return (size) => {
    sequence += 1;
    return Buffer.alloc(size, sequence);
  };
}

function createService(
  repository: MemoryInviteAuthRepository,
  currentTime: { value: Date },
): InviteAuthService {
  return new InviteAuthService({
    repository,
    clock: () => currentTime.value,
    randomBytes: createDeterministicRandomBytes(),
    passwordHasher: new DeterministicPasswordHasher(),
  });
}

describe("InviteAuthService", () => {
  it("activates an invitation only once without returning credential secrets", async () => {
    const repository = new MemoryInviteAuthRepository();
    const service = createService(repository, { value: new Date("2026-07-30T00:00:00.000Z") });
    const invitation = await service.issueInvitation();

    expect(invitation.code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(invitation).not.toHaveProperty("codeHash");

    const activation = await service.activateInvitation({
      code: invitation.code,
      email: " TRAINEE@Example.TEST ",
      password: TEST_PASSWORD,
    });

    expect(activation).toMatchObject({
      ok: true,
      value: {
        user: { email: "trainee@example.test", role: "trainee" },
      },
    });
    if (!activation.ok) {
      throw new Error("Expected invitation activation to succeed");
    }
    expect(activation.value).not.toHaveProperty("tokenHash");
    expect(activation.value.user).not.toHaveProperty("passwordHash");

    await expect(
      service.activateInvitation({
        code: invitation.code,
        email: "second@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_invitation" });
  });

  it("returns a generic error for expired and unknown invitation codes", async () => {
    const repository = new MemoryInviteAuthRepository();
    const currentTime = { value: new Date("2026-07-30T00:00:00.000Z") };
    const service = createService(repository, currentTime);
    const invitation = await service.issueInvitation({
      expiresAt: new Date("2026-07-30T00:01:00.000Z"),
    });
    currentTime.value = new Date("2026-07-30T00:02:00.000Z");

    await expect(
      service.activateInvitation({
        code: invitation.code,
        email: "expired@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_invitation" });
    await expect(
      service.activateInvitation({
        code: "not-an-issued-code",
        email: "unknown@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_invitation" });
  });

  it("creates the user with the role assigned to the invitation", async () => {
    const repository = new MemoryInviteAuthRepository();
    const service = createService(repository, { value: new Date("2026-07-30T00:00:00.000Z") });
    const invitation = await service.issueInvitation({ role: "operator" });

    await expect(
      service.activateInvitation({
        code: invitation.code,
        email: "operator@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toMatchObject({ ok: true, value: { user: { role: "operator" } } });
  });

  it("allows exactly one concurrent claim for an invitation", async () => {
    const repository = new MemoryInviteAuthRepository();
    const service = createService(repository, { value: new Date("2026-07-30T00:00:00.000Z") });
    const invitation = await service.issueInvitation();

    const activations = await Promise.all([
      service.activateInvitation({
        code: invitation.code,
        email: "first@example.test",
        password: TEST_PASSWORD,
      }),
      service.activateInvitation({
        code: invitation.code,
        email: "second@example.test",
        password: TEST_PASSWORD,
      }),
    ]);

    expect(activations.filter((activation) => activation.ok)).toHaveLength(1);
    expect(activations.filter((activation) => !activation.ok)).toEqual([
      { ok: false, error: "invalid_invitation" },
    ]);
  });

  it("returns email_taken without consuming a second valid invitation", async () => {
    const repository = new MemoryInviteAuthRepository();
    const service = createService(repository, { value: new Date("2026-07-30T00:00:00.000Z") });
    const firstInvitation = await service.issueInvitation();
    const secondInvitation = await service.issueInvitation();

    await expect(
      service.activateInvitation({
        code: firstInvitation.code,
        email: "duplicate@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      service.activateInvitation({
        code: secondInvitation.code,
        email: "duplicate@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: "email_taken" });
    await expect(
      service.activateInvitation({
        code: secondInvitation.code,
        email: "different@example.test",
        password: TEST_PASSWORD,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("allows only one concurrent account creation for the same email", async () => {
    const repository = new MemoryInviteAuthRepository();
    const service = createService(repository, { value: new Date("2026-07-30T00:00:00.000Z") });
    const firstInvitation = await service.issueInvitation();
    const secondInvitation = await service.issueInvitation();

    const activations = await Promise.all([
      service.activateInvitation({
        code: firstInvitation.code,
        email: "concurrent@example.test",
        password: TEST_PASSWORD,
      }),
      service.activateInvitation({
        code: secondInvitation.code,
        email: "concurrent@example.test",
        password: TEST_PASSWORD,
      }),
    ]);

    expect(activations.filter((activation) => activation.ok)).toHaveLength(1);
    expect(activations.filter((activation) => !activation.ok)).toEqual([
      { ok: false, error: "email_taken" },
    ]);
  });

  it("returns stable input errors before accepting an activation", async () => {
    const repository = new MemoryInviteAuthRepository();
    const service = createService(repository, { value: new Date("2026-07-30T00:00:00.000Z") });
    const invitation = await service.issueInvitation();

    await expect(
      service.activateInvitation({
        code: invitation.code,
        email: "not-an-email",
        password: TEST_PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_email" });
    await expect(
      service.activateInvitation({
        code: invitation.code,
        email: "trainee@example.test",
        password: "too-short",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_password" });
  });

  it("uses generic login errors and expires or revokes sessions", async () => {
    const repository = new MemoryInviteAuthRepository();
    const currentTime = { value: new Date("2026-07-30T00:00:00.000Z") };
    const service = createService(repository, currentTime);
    const invitation = await service.issueInvitation();
    const activation = await service.activateInvitation({
      code: invitation.code,
      email: "trainee@example.test",
      password: TEST_PASSWORD,
    });
    if (!activation.ok) {
      throw new Error("Expected invitation activation to succeed");
    }

    await expect(
      service.login({ email: "missing@example.test", password: TEST_PASSWORD }),
    ).resolves.toEqual({ ok: false, error: "invalid_credentials" });
    await expect(
      service.login({ email: "trainee@example.test", password: "wrong password" }),
    ).resolves.toEqual({ ok: false, error: "invalid_credentials" });

    const login = await service.login({
      email: "TRAINEE@example.test",
      password: TEST_PASSWORD,
    });
    if (!login.ok) {
      throw new Error("Expected login to succeed");
    }
    expect(login.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await service.getAuthenticatedUser(login.value.token)).toEqual(login.value.user);

    await service.logout(login.value.token);
    await expect(service.getAuthenticatedUser(login.value.token)).resolves.toBeUndefined();

    const freshLogin = await service.login({
      email: "trainee@example.test",
      password: TEST_PASSWORD,
    });
    if (!freshLogin.ok) {
      throw new Error("Expected second login to succeed");
    }
    currentTime.value = new Date("2026-07-30T08:00:01.000Z");
    await expect(service.getAuthenticatedUser(freshLogin.value.token)).resolves.toBeUndefined();
  });
});
