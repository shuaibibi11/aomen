import { describe, expect, it } from "vitest";
import { PostgresInviteAuthRepository } from "./postgres-invite-auth-repository.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeSqlClient {
  readonly queries: RecordedQuery[] = [];
  released = false;
  failUserInsert = false;

  async query(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> {
    this.queries.push({ text, values });
    if (text.startsWith("SELECT code_hash")) {
      return {
        rows: [
          {
            code_hash: "invitation-hash",
            role: "trainee",
            expires_at: new Date("2026-08-01T00:00:00.000Z"),
            used_at: null,
            used_by_user_id: null,
          },
        ],
      };
    }
    if (text.startsWith("INSERT INTO training_users") && this.failUserInsert) {
      throw Object.assign(new Error("unique violation"), { code: "23505" });
    }
    return { rows: [], rowCount: text.startsWith("UPDATE training_invitations") ? 1 : 0 };
  }

  release(): void {
    this.released = true;
  }
}

class FakeSqlPool {
  readonly directQueries: RecordedQuery[] = [];
  readonly transactionClient = new FakeSqlClient();

  async query(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> {
    this.directQueries.push({ text, values });
    if (text.startsWith("SELECT id, email, role, created_at, password_hash")) {
      return {
        rows: [
          {
            id: "user-id",
            email: "trainee@example.test",
            role: "trainee",
            created_at: new Date("2026-07-30T00:00:00.000Z"),
            password_hash: "stored-password-hash",
          },
        ],
      };
    }
    if (text.startsWith("SELECT s.token_hash")) {
      return {
        rows: [
          {
            session_token_hash: "stored-session-hash",
            session_user_id: "user-id",
            session_created_at: new Date("2026-07-30T00:00:00.000Z"),
            session_expires_at: new Date("2026-07-30T08:00:00.000Z"),
            session_revoked_at: null,
            user_id: "user-id",
            user_email: "trainee@example.test",
            user_role: "trainee",
            user_created_at: new Date("2026-07-30T00:00:00.000Z"),
          },
        ],
      };
    }
    return { rows: [], rowCount: 1 };
  }

  async connect(): Promise<FakeSqlClient> {
    return this.transactionClient;
  }
}

function listAllQueries(pool: FakeSqlPool): RecordedQuery[] {
  return [...pool.directQueries, ...pool.transactionClient.queries];
}

describe("PostgresInviteAuthRepository", () => {
  it("maps query results and sends all authentication data as SQL parameters", async () => {
    const pool = new FakeSqlPool();
    const repository = new PostgresInviteAuthRepository(pool);
    const expiration = new Date("2026-08-01T00:00:00.000Z");
    const createdAt = new Date("2026-07-30T00:00:00.000Z");
    const rawSecrets = ["invitation-hash", "stored-password-hash", "stored-session-hash"];

    await repository.createInvitation({
      codeHash: "invitation-hash",
      role: "trainee",
      expiresAt: expiration,
    });
    await expect(repository.findUserByEmail("trainee@example.test")).resolves.toMatchObject({
      email: "trainee@example.test",
      passwordHash: "stored-password-hash",
    });
    await repository.createSession({
      tokenHash: "stored-session-hash",
      userId: "user-id",
      createdAt,
      expiresAt: expiration,
    });
    await expect(repository.findSessionWithUserByTokenHash("stored-session-hash")).resolves.toMatchObject({
      tokenHash: "stored-session-hash",
      user: { email: "trainee@example.test" },
    });
    await repository.revokeSession("stored-session-hash", createdAt);

    const claimResult = await repository.claimInvitationAndCreateUser({
      codeHash: "invitation-hash",
      userId: "new-user-id",
      email: "trainee@example.test",
      passwordHash: "stored-password-hash",
      createdAt,
      claimedAt: createdAt,
    });

    expect(claimResult).toEqual({
      status: "created",
      user: {
        id: "new-user-id",
        email: "trainee@example.test",
        role: "trainee",
        createdAt,
      },
    });
    expect(pool.transactionClient.queries.map((query) => query.text.split("\n")[0])).toEqual([
      "BEGIN",
      "SELECT code_hash, role, expires_at, used_at, used_by_user_id",
      "INSERT INTO training_users (id, email, role, password_hash, created_at)",
      "UPDATE training_invitations",
      "COMMIT",
    ]);
    expect(pool.transactionClient.released).toBe(true);

    const allQueries = listAllQueries(pool);
    const allSqlText = allQueries.map((query) => query.text).join("\n");
    for (const rawSecret of rawSecrets) {
      expect(allSqlText).not.toContain(rawSecret);
      expect(allQueries.some((query) => query.values.includes(rawSecret))).toBe(true);
    }
    expect(allQueries.filter((query) => query.values.length > 0).every((query) => /\$1/.test(query.text))).toBe(true);
  });

  it("rolls back an invitation claim when a duplicate email prevents user creation", async () => {
    const pool = new FakeSqlPool();
    pool.transactionClient.failUserInsert = true;
    const repository = new PostgresInviteAuthRepository(pool);

    await expect(
      repository.claimInvitationAndCreateUser({
        codeHash: "invitation-hash",
        userId: "new-user-id",
        email: "trainee@example.test",
        passwordHash: "stored-password-hash",
        createdAt: new Date("2026-07-30T00:00:00.000Z"),
        claimedAt: new Date("2026-07-30T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ status: "email_taken" });

    expect(pool.transactionClient.queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE"),
      expect.stringContaining("INSERT INTO training_users"),
      "ROLLBACK",
    ]);
    expect(pool.transactionClient.released).toBe(true);
  });
});
