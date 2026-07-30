import type { InviteAuthRepository } from "../auth/invite-auth-repository.js";
import type {
  ClaimInvitationAndCreateUserInput,
  ClaimInvitationAndCreateUserResult,
  CreateInvitationRecord,
  CreateSessionRecord,
  StoredSessionWithUser,
  StoredTrainingUser,
  TrainingUser,
  TrainingUserRole,
} from "../auth/types.js";
import type { SqlConnectionPool } from "./sql-executor.js";

interface InvitationRow extends Record<string, unknown> {
  readonly code_hash: string;
  readonly role: TrainingUserRole;
  readonly expires_at: Date;
  readonly used_at: Date | null;
  readonly used_by_user_id: string | null;
}

interface UserRow extends Record<string, unknown> {
  readonly id: string;
  readonly email: string;
  readonly role: TrainingUserRole;
  readonly created_at: Date;
  readonly password_hash: string;
}

interface SessionWithUserRow extends Record<string, unknown> {
  readonly session_token_hash: string;
  readonly session_user_id: string;
  readonly session_created_at: Date;
  readonly session_expires_at: Date;
  readonly session_revoked_at: Date | null;
  readonly user_id: string;
  readonly user_email: string;
  readonly user_role: TrainingUserRole;
  readonly user_created_at: Date;
}

function mapTrainingUser(row: Pick<UserRow, "id" | "email" | "role" | "created_at">): TrainingUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: new Date(row.created_at.getTime()),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * PostgreSQL repository. The claim method locks an invitation and creates the
 * associated user inside a single explicit transaction.
 */
export class PostgresInviteAuthRepository implements InviteAuthRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async createInvitation(invitation: CreateInvitationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO training_invitations (code_hash, role, expires_at)
VALUES ($1, $2, $3)`,
      [invitation.codeHash, invitation.role, invitation.expiresAt],
    );
  }

  async claimInvitationAndCreateUser(
    input: ClaimInvitationAndCreateUserInput,
  ): Promise<ClaimInvitationAndCreateUserResult> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const invitationResult = await client.query<InvitationRow>(
        `SELECT code_hash, role, expires_at, used_at, used_by_user_id
FROM training_invitations
WHERE code_hash = $1
FOR UPDATE`,
        [input.codeHash],
      );
      const invitation = invitationResult.rows[0];
      if (
        invitation === undefined ||
        invitation.used_at !== null ||
        invitation.expires_at.getTime() <= input.claimedAt.getTime()
      ) {
        await client.query("COMMIT");
        transactionStarted = false;
        return { status: "invalid_invitation" };
      }

      await client.query(
        `INSERT INTO training_users (id, email, role, password_hash, created_at)
VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.email, invitation.role, input.passwordHash, input.createdAt],
      );
      const claimResult = await client.query(
        `UPDATE training_invitations
SET used_at = $3, used_by_user_id = $2
WHERE code_hash = $1 AND used_at IS NULL`,
        [input.codeHash, input.userId, input.claimedAt],
      );
      if (claimResult.rowCount !== 1) {
        throw new Error("Invitation claim lost its row lock");
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return {
        status: "created",
        user: {
          id: input.userId,
          email: input.email,
          role: invitation.role,
          createdAt: new Date(input.createdAt.getTime()),
        },
      };
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }
      if (isUniqueViolation(error)) {
        return { status: "email_taken" };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email: string): Promise<StoredTrainingUser | undefined> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, email, role, created_at, password_hash
FROM training_users
WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { ...mapTrainingUser(row), passwordHash: row.password_hash };
  }

  async createSession(session: CreateSessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
VALUES ($1, $2, $3, $4)`,
      [session.tokenHash, session.userId, session.createdAt, session.expiresAt],
    );
  }

  async findSessionWithUserByTokenHash(
    tokenHash: string,
  ): Promise<StoredSessionWithUser | undefined> {
    const result = await this.pool.query<SessionWithUserRow>(
      `SELECT s.token_hash AS session_token_hash,
       s.user_id AS session_user_id,
       s.created_at AS session_created_at,
       s.expires_at AS session_expires_at,
       s.revoked_at AS session_revoked_at,
       u.id AS user_id,
       u.email AS user_email,
       u.role AS user_role,
       u.created_at AS user_created_at
FROM auth_sessions AS s
INNER JOIN training_users AS u ON u.id = s.user_id
WHERE s.token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }

    return {
      tokenHash: row.session_token_hash,
      userId: row.session_user_id,
      createdAt: new Date(row.session_created_at.getTime()),
      expiresAt: new Date(row.session_expires_at.getTime()),
      revokedAt:
        row.session_revoked_at === null
          ? undefined
          : new Date(row.session_revoked_at.getTime()),
      user: {
        id: row.user_id,
        email: row.user_email,
        role: row.user_role,
        createdAt: new Date(row.user_created_at.getTime()),
      },
    };
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
SET revoked_at = $2
WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, revokedAt],
    );
  }
}
