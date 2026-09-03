import type {
  AdminIdentityRepository,
  AdminRecord,
  AdminSessionRecord,
} from '../repositories/admin-identity.repository.port.js';

/**
 * In-memory administrator store for service tests.
 *
 * Mirrors the real one where it matters: `email` is `citext`, so lookup here is
 * case-insensitive too. A fake that were case-SENSITIVE would let a test pass
 * while production behaved differently, which is worse than no fake at all.
 */
export class InMemoryAdminIdentityRepository implements AdminIdentityRepository {
  now: () => Date = () => new Date();

  readonly admins = new Map<string, AdminRecord>();
  readonly sessions: AdminSessionRecord[] = [];
  private readonly tokenHashes = new Map<string, string>();

  async findAdminByEmail(email: string): Promise<AdminRecord | null> {
    const wanted = email.toLowerCase();
    for (const a of this.admins.values()) {
      if (a.email.toLowerCase() === wanted) return a;
    }
    return null;
  }

  async findAdminById(id: string): Promise<AdminRecord | null> {
    return this.admins.get(id) ?? null;
  }

  async createAdminSession(input: {
    id: string;
    adminId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  }): Promise<void> {
    this.sessions.push({
      id: input.id,
      adminId: input.adminId,
      createdAt: this.now(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
    this.tokenHashes.set(input.tokenHash.toString('hex'), input.id);
  }

  async findLiveAdminSessionByTokenHash(tokenHash: Buffer): Promise<AdminSessionRecord | null> {
    const id = this.tokenHashes.get(tokenHash.toString('hex'));
    if (id === undefined) return null;
    const s = this.sessions.find((x) => x.id === id);
    if (s === undefined || s.revokedAt !== null) return null;
    return s.expiresAt.getTime() > this.now().getTime() ? s : null;
  }

  async revokeAdminSessions(sessionIds: readonly string[]): Promise<void> {
    for (let i = 0; i < this.sessions.length; i += 1) {
      const s = this.sessions[i];
      if (s !== undefined && sessionIds.includes(s.id) && s.revokedAt === null) {
        this.sessions[i] = { ...s, revokedAt: this.now() };
      }
    }
  }

  async listLiveAdminSessions(adminId: string): Promise<AdminSessionRecord[]> {
    const now = this.now().getTime();
    return this.sessions.filter(
      (s) => s.adminId === adminId && s.revokedAt === null && s.expiresAt.getTime() > now,
    );
  }
}
