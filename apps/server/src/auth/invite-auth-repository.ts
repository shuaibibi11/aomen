import type {
  ClaimInvitationAndCreateUserInput,
  ClaimInvitationAndCreateUserResult,
  CreateInvitationRecord,
  CreateSessionRecord,
  StoredSessionWithUser,
  StoredTrainingUser,
} from "./types.js";

/**
 * Persistence boundary for invitation authentication. Every method is async so
 * callers are independent from the memory and PostgreSQL implementations.
 */
export interface InviteAuthRepository {
  createInvitation(invitation: CreateInvitationRecord): Promise<void>;
  claimInvitationAndCreateUser(
    input: ClaimInvitationAndCreateUserInput,
  ): Promise<ClaimInvitationAndCreateUserResult>;
  findUserByEmail(email: string): Promise<StoredTrainingUser | undefined>;
  createSession(session: CreateSessionRecord): Promise<void>;
  findSessionWithUserByTokenHash(tokenHash: string): Promise<StoredSessionWithUser | undefined>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
}
