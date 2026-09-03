import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { hashSessionToken, isSessionLive, slidExpiry } from '../domain/session-token.js';
import { authOutcomeFor, type UserState } from '../domain/user-state.js';
import type { Clock } from '../ports/clock.port.js';
import type { IdentityRepository } from '../repositories/identity.repository.port.js';

/**
 * Who is making this request, and what may they do.
 *
 * Deliberately carries no phone number, no date of birth and no email. This
 * object is passed to every product module, and `06-backend-modules.md`
 * forbids a raw identifier leaving the identity module (PRIV-002/003). If a
 * feature later needs the number, it must ask identity explicitly rather than
 * find it already in hand.
 */
export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  state: UserState;
  /** FULL may write; READ_ONLY and RESTORE_ONLY may not (BR-034, SET-FR-005). */
  capability: 'FULL' | 'READ_ONLY' | 'RESTORE_ONLY';
  suspendedUntil: Date | null;
}

export type ResolveSessionResult =
  { status: 'AUTHENTICATED'; principal: AuthenticatedPrincipal } | { status: 'UNAUTHENTICATED' };

/**
 * Session resolution and revocation (ADR-008 · BR-007/035 · SEC-005 · EDGE-010).
 *
 * THIS IS THE HOT PATH. Every authenticated request in the platform passes
 * through `resolve`, and it is also the control that makes revocation real:
 * because authority lives in a row rather than in a signed token, a ban,
 * suspension or logout takes effect on the VERY NEXT REQUEST (EDGE-010)
 * without a deny-list.
 *
 * The account's state is re-read on every request, not trusted from login.
 * A session issued while the account was ACTIVE must stop permitting writes
 * the moment that account is suspended — otherwise a moderator's suspension
 * would not bite until the user happened to log in again, which is exactly
 * when they would not.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: IdentityRepository,
    private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Resolve a bearer token to a principal.
   *
   * Every failure is the same `UNAUTHENTICATED`: a malformed token, an unknown
   * one, an expired one, a revoked one, and a token whose account has since
   * been banned. The caller has presented a credential and it did not work;
   * which of those it was is not information they are owed.
   */
  async resolve(token: string): Promise<ResolveSessionResult> {
    if (typeof token !== 'string' || token.length === 0) {
      return { status: 'UNAUTHENTICATED' };
    }

    try {
      const now = this.clock.now();
      const session = await this.repo.findLiveSessionByTokenHash(hashSessionToken(token));

      // Re-checked here even though the query filters: the query and this
      // predicate must agree, and the domain rule is the authority.
      if (session === null || !isSessionLive(session, now)) {
        return { status: 'UNAUTHENTICATED' };
      }

      const user = await this.repo.findUserById(session.userId);
      if (user === null) return { status: 'UNAUTHENTICATED' };

      // State is read fresh on every request. This is what makes a suspension
      // or ban effective immediately rather than at next login.
      const outcome = authOutcomeFor(user.state, user.suspendedUntil);
      if (outcome.kind === 'DENY_NEUTRAL' || outcome.kind === 'VERIFY_REQUIRED') {
        // The account may no longer be used. Retire the session so the next
        // request does not have to reach the user row to find that out.
        await this.db.withTransaction((client) =>
          this.repo.revokeSessions(
            [session.id],
            user.state === 'BANNED' ? 'BANNED' : 'ADMIN',
            client,
          ),
        );
        this.log('session_rejected_state', { state: user.state });
        return { status: 'UNAUTHENTICATED' };
      }

      // Slide the idle window (AUTH-API-008). Skipped when the gain is under a
      // minute, or a feed-heavy screen would issue an UPDATE per scroll.
      const slid = slidExpiry(session, now);
      if (slid !== null) await this.repo.touchSession(session.id, slid);

      return {
        status: 'AUTHENTICATED',
        principal: {
          userId: user.id,
          sessionId: session.id,
          state: user.state,
          capability:
            outcome.kind === 'ALLOW'
              ? 'FULL'
              : outcome.kind === 'READ_ONLY'
                ? 'READ_ONLY'
                : 'RESTORE_ONLY',
          suspendedUntil: outcome.kind === 'READ_ONLY' ? outcome.until : null,
        },
      };
    } catch (e) {
      // Fail CLOSED. An infrastructure fault must deny, never admit.
      this.logger.error(
        JSON.stringify({ event: 'session_resolve_failed' }),
        e instanceof Error ? e.stack : String(e),
        'identity',
      );
      return { status: 'UNAUTHENTICATED' };
    }
  }

  /** Sign out this device only. Other devices keep their sessions. */
  async logout(sessionId: string): Promise<void> {
    await this.db.withTransaction((client) =>
      this.repo.revokeSessions([sessionId], 'LOGOUT', client),
    );
    this.log('logout');
  }

  /**
   * Sign out everywhere, optionally sparing the device asking.
   *
   * Used by "log out all other devices", and by the password-change and
   * password-reset flows (BR-007, SET-FR-002, AUTH-FR-007) — a person who
   * changes their password because they fear someone else has it must
   * actually eject that someone.
   */
  async revokeAllForUser(
    userId: string,
    reason: 'PASSWORD_CHANGE' | 'PASSWORD_RESET' | 'LOGOUT' | 'SUSPENDED' | 'BANNED' | 'DELETED',
    options: { exceptSessionId?: string } = {},
  ): Promise<number> {
    return this.db.withTransaction(async (client) => {
      const live = await this.repo.listLiveSessions(userId, client);
      const ids = live.map((s) => s.id).filter((id) => id !== options.exceptSessionId);

      if (ids.length > 0) await this.repo.revokeSessions(ids, reason, client);
      this.log('sessions_revoked', { reason, count: ids.length });
      return ids.length;
    });
  }

  private log(event: string, extra: Record<string, unknown> = {}): void {
    // No token, no token hash, no identifier.
    this.logger.log(JSON.stringify({ event, ...extra }), 'identity');
  }
}
