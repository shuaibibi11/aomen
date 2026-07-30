import type { InviteAuthRepository } from "./invite-auth-repository.js";
import type {
  ClaimInvitationAndCreateUserInput,
  ClaimInvitationAndCreateUserResult,
  CreateInvitationRecord,
  CreateSessionRecord,
  StoredAuthSession,
  StoredInvitation,
  StoredSessionWithUser,
  StoredTrainingUser,
  TrainingUser,
} from "./types.js";

interface MutableInvitation extends StoredInvitation {
  usedAt: Date | undefined;
  usedByUserId: string | undefined;
}

interface MutableSession extends StoredAuthSession {
  revokedAt: Date | undefined;
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function cloneUser(user: TrainingUser): TrainingUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: cloneDate(user.createdAt),
  };
}

function cloneStoredUser(user: StoredTrainingUser): StoredTrainingUser {
  return { ...cloneUser(user), passwordHash: user.passwordHash };
}

/**
 * Test-only asynchronous adapter. Its serialized mutation boundary models the
 * atomic invitation claim required of a durable repository.
 */
export class MemoryInviteAuthRepository implements InviteAuthRepository {
  private readonly invitationsByCodeHash = new Map<string, MutableInvitation>();
  private readonly sessionsByTokenHash = new Map<string, MutableSession>();
  private readonly usersByEmail = new Map<string, StoredTrainingUser>();
  private readonly usersById = new Map<string, StoredTrainingUser>();
  private mutationQueue: Promise<void> = Promise.resolve();

  async createInvitation(invitation: CreateInvitationRecord): Promise<void> {
    await this.runSerializedMutation(() => {
      if (this.invitationsByCodeHash.has(invitation.codeHash)) {
        throw new Error("Duplicate invitation code hash");
      }

      this.invitationsByCodeHash.set(invitation.codeHash, {
        codeHash: invitation.codeHash,
        role: invitation.role,
        expiresAt: cloneDate(invitation.expiresAt),
        usedAt: undefined,
        usedByUserId: undefined,
      });
    });
  }

  async claimInvitationAndCreateUser(
    input: ClaimInvitationAndCreateUserInput,
  ): Promise<ClaimInvitationAndCreateUserResult> {
    return this.runSerializedMutation(() => {
      const invitation = this.invitationsByCodeHash.get(input.codeHash);
      if (
        invitation === undefined ||
        invitation.usedAt !== undefined ||
        invitation.expiresAt.getTime() <= input.claimedAt.getTime()
      ) {
        return { status: "invalid_invitation" };
      }

      if (this.usersByEmail.has(input.email)) {
        return { status: "email_taken" };
      }

      const user: StoredTrainingUser = {
        id: input.userId,
        email: input.email,
        role: invitation.role,
        passwordHash: input.passwordHash,
        createdAt: cloneDate(input.createdAt),
      };
      this.usersByEmail.set(user.email, user);
      this.usersById.set(user.id, user);
      invitation.usedAt = cloneDate(input.claimedAt);
      invitation.usedByUserId = user.id;

      return { status: "created", user: cloneUser(user) };
    });
  }

  async findUserByEmail(email: string): Promise<StoredTrainingUser | undefined> {
    const user = this.usersByEmail.get(email);
    return user === undefined ? undefined : cloneStoredUser(user);
  }

  async createSession(session: CreateSessionRecord): Promise<void> {
    await this.runSerializedMutation(() => {
      if (this.sessionsByTokenHash.has(session.tokenHash)) {
        throw new Error("Duplicate session token hash");
      }

      this.sessionsByTokenHash.set(session.tokenHash, {
        tokenHash: session.tokenHash,
        userId: session.userId,
        createdAt: cloneDate(session.createdAt),
        expiresAt: cloneDate(session.expiresAt),
        revokedAt: undefined,
      });
    });
  }

  async findSessionWithUserByTokenHash(
    tokenHash: string,
  ): Promise<StoredSessionWithUser | undefined> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (session === undefined) {
      return undefined;
    }

    const user = this.usersById.get(session.userId);
    if (user === undefined) {
      return undefined;
    }

    return {
      tokenHash: session.tokenHash,
      userId: session.userId,
      createdAt: cloneDate(session.createdAt),
      expiresAt: cloneDate(session.expiresAt),
      revokedAt: session.revokedAt === undefined ? undefined : cloneDate(session.revokedAt),
      user: cloneUser(user),
    };
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.runSerializedMutation(() => {
      const session = this.sessionsByTokenHash.get(tokenHash);
      if (session !== undefined && session.revokedAt === undefined) {
        session.revokedAt = cloneDate(revokedAt);
      }
    });
  }

  private async runSerializedMutation<Result>(operation: () => Result): Promise<Result> {
    let releaseMutation: (() => void) | undefined;
    const nextMutation = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const previousMutation = this.mutationQueue;
    this.mutationQueue = nextMutation;

    await previousMutation;
    try {
      return operation();
    } finally {
      releaseMutation?.();
    }
  }
}
