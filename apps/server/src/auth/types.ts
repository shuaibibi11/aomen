export type TrainingUserRole = "trainee" | "operator";

/** Public user identity. Credential data is deliberately excluded. */
export interface TrainingUser {
  readonly id: string;
  readonly email: string;
  readonly role: TrainingUserRole;
  readonly createdAt: Date;
}

/** Returned only by invitation issuance; its raw code is never queryable. */
export interface IssuedInvitation {
  readonly code: string;
  readonly expiresAt: Date;
}

/** Returned only after authentication succeeds; its raw token is never queryable. */
export interface AuthSession {
  readonly token: string;
  readonly user: TrainingUser;
  readonly expiresAt: Date;
}

/** Repository-only user record. Do not return this across a service boundary. */
export interface StoredTrainingUser extends TrainingUser {
  readonly passwordHash: string;
}

export interface StoredInvitation {
  readonly codeHash: string;
  readonly role: TrainingUserRole;
  readonly expiresAt: Date;
  readonly usedAt: Date | undefined;
  readonly usedByUserId: string | undefined;
}

export interface StoredAuthSession {
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | undefined;
  readonly createdAt: Date;
}

export interface StoredSessionWithUser extends StoredAuthSession {
  readonly user: TrainingUser;
}

export interface CreateInvitationRecord {
  readonly codeHash: string;
  readonly role: TrainingUserRole;
  readonly expiresAt: Date;
}

export interface ClaimInvitationAndCreateUserInput {
  readonly codeHash: string;
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly createdAt: Date;
  readonly claimedAt: Date;
}

export type ClaimInvitationAndCreateUserResult =
  | Readonly<{ status: "created"; user: TrainingUser }>
  | Readonly<{ status: "invalid_invitation" }>
  | Readonly<{ status: "email_taken" }>;

export interface CreateSessionRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export type ServiceSuccess<Value> = Readonly<{ ok: true; value: Value }>;
export type ServiceFailure<ErrorCode extends string> = Readonly<{
  ok: false;
  error: ErrorCode;
}>;
export type ServiceResult<Value, ErrorCode extends string> =
  | ServiceSuccess<Value>
  | ServiceFailure<ErrorCode>;
