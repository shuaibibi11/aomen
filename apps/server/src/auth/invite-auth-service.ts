import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { canonicalizeTrainingEmail, isValidTrainingEmail } from "./email.js";
import type { InviteAuthRepository } from "./invite-auth-repository.js";
import {
  MAXIMUM_TRAINING_PASSWORD_LENGTH,
  ScryptPasswordHasher,
  type PasswordHasher,
  validateTrainingPassword,
} from "./password-hasher.js";
import type {
  AuthSession,
  IssuedInvitation,
  ServiceResult,
  TrainingUser,
  TrainingUserRole,
} from "./types.js";

const DEFAULT_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;
const INVITATION_CODE_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;
const USER_ID_BYTES = 16;

export interface InviteAuthServiceOptions {
  readonly repository: InviteAuthRepository;
  readonly clock?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
  readonly passwordHasher?: PasswordHasher;
}

export interface IssueInvitationOptions {
  readonly expiresAt?: Date;
  readonly role?: TrainingUserRole;
}

export interface ActivateInvitationInput {
  readonly code: string;
  readonly email: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export type ActivateInvitationResult = ServiceResult<
  AuthSession,
  "invalid_invitation" | "email_taken" | "invalid_email" | "invalid_password"
>;
export type LoginResult = ServiceResult<AuthSession, "invalid_credentials">;

function hashSecret(rawSecret: string): string {
  return createHash("sha256").update(rawSecret).digest("base64url");
}

function addMilliseconds(time: Date, milliseconds: number): Date {
  return new Date(time.getTime() + milliseconds);
}

function toPublicUser(user: TrainingUser): TrainingUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/**
 * Domain service for invitations and sessions. It returns explicit business
 * results and never exposes stored password, invitation, or session hashes.
 */
export class InviteAuthService {
  private readonly clock: () => Date;
  private readonly passwordHasher: PasswordHasher;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(private readonly options: InviteAuthServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.passwordHasher = options.passwordHasher ?? new ScryptPasswordHasher();
  }

  async issueInvitation(options: IssueInvitationOptions = {}): Promise<IssuedInvitation> {
    const now = this.clock();
    const expiresAt = options.expiresAt === undefined
      ? addMilliseconds(now, DEFAULT_INVITATION_LIFETIME_MS)
      : new Date(options.expiresAt.getTime());
    const rawInvitationCode = this.randomBytes(INVITATION_CODE_BYTES).toString("base64url");

    await this.options.repository.createInvitation({
      codeHash: hashSecret(rawInvitationCode),
      role: options.role ?? "trainee",
      expiresAt,
    });

    return { code: rawInvitationCode, expiresAt };
  }

  async activateInvitation(input: ActivateInvitationInput): Promise<ActivateInvitationResult> {
    const email = canonicalizeTrainingEmail(input.email);
    if (!isValidTrainingEmail(email)) {
      return { ok: false, error: "invalid_email" };
    }

    const passwordValidation = validateTrainingPassword(input.password);
    if (!passwordValidation.ok) {
      return passwordValidation;
    }

    const now = this.clock();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const invitationClaim = await this.options.repository.claimInvitationAndCreateUser({
      codeHash: hashSecret(input.code),
      userId: this.createIdentifier(),
      email,
      passwordHash,
      createdAt: now,
      claimedAt: now,
    });

    if (invitationClaim.status === "invalid_invitation") {
      return { ok: false, error: "invalid_invitation" };
    }
    if (invitationClaim.status === "email_taken") {
      return { ok: false, error: "email_taken" };
    }

    return { ok: true, value: await this.createSession(invitationClaim.user, now) };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    if (input.password.length > MAXIMUM_TRAINING_PASSWORD_LENGTH) {
      return { ok: false, error: "invalid_credentials" };
    }

    const email = canonicalizeTrainingEmail(input.email);
    if (!isValidTrainingEmail(email)) {
      await this.passwordHasher.verifyUnknownPassword(input.password);
      return { ok: false, error: "invalid_credentials" };
    }

    const storedUser = await this.options.repository.findUserByEmail(email);
    if (storedUser === undefined) {
      await this.passwordHasher.verifyUnknownPassword(input.password);
      return { ok: false, error: "invalid_credentials" };
    }

    const passwordMatches = await this.passwordHasher.verify(input.password, storedUser.passwordHash);
    if (!passwordMatches) {
      return { ok: false, error: "invalid_credentials" };
    }

    return { ok: true, value: await this.createSession(toPublicUser(storedUser), this.clock()) };
  }

  async getAuthenticatedUser(token: string): Promise<TrainingUser | undefined> {
    const storedSession = await this.options.repository.findSessionWithUserByTokenHash(hashSecret(token));
    if (
      storedSession === undefined ||
      storedSession.revokedAt !== undefined ||
      storedSession.expiresAt.getTime() <= this.clock().getTime()
    ) {
      return undefined;
    }

    return storedSession.user;
  }

  async logout(token: string): Promise<void> {
    await this.options.repository.revokeSession(hashSecret(token), this.clock());
  }

  private createIdentifier(): string {
    return this.randomBytes(USER_ID_BYTES).toString("base64url");
  }

  private async createSession(user: TrainingUser, createdAt: Date): Promise<AuthSession> {
    const rawSessionToken = this.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const expiresAt = addMilliseconds(createdAt, DEFAULT_SESSION_LIFETIME_MS);
    await this.options.repository.createSession({
      tokenHash: hashSecret(rawSessionToken),
      userId: user.id,
      createdAt,
      expiresAt,
    });

    return { token: rawSessionToken, user, expiresAt };
  }
}
