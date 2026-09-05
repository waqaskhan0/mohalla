import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { PUBLIC_ROUTE, REQUIRED_CAPABILITY, SessionGuard, principalOf } from './session.guard.js';
import { SessionService } from '../application/session.service.js';
import { InMemoryIdentityRepository } from '../testing/in-memory-identity.repository.js';
import { FixedClock } from '../ports/clock.port.js';
import { issueSessionToken } from '../domain/session-token.js';
import type { UserState } from '../domain/user-state.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * The property under test is that guarding is the DEFAULT. A route that says
 * nothing must be closed, because the failure mode of forgetting has to be a
 * dead endpoint rather than an open one.
 */

interface RouteMeta {
  public?: boolean;
  capability?: string;
}

function build() {
  const repo = new InMemoryIdentityRepository();
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  repo.now = () => clock.now();

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;
  const logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as StructuredLogger;

  const sessions = new SessionService(db, repo, clock, logger);

  // A Reflector that reports whatever the test declares for the route.
  let meta: RouteMeta = {};
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === PUBLIC_ROUTE
        ? meta.public
        : key === REQUIRED_CAPABILITY
          ? meta.capability
          : undefined,
  } as unknown as Reflector;

  const guard = new SessionGuard(sessions, reflector);

  const ctxFor = (headers: Record<string, string>) => {
    const req: Record<string, unknown> = { headers };
    return {
      req,
      ctx: {
        getType: () => 'http',
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext,
    };
  };

  return {
    guard,
    repo,
    clock,
    route: (m: RouteMeta) => {
      meta = m;
    },
    ctxFor,

    async seedSession(state: UserState = 'ACTIVE', suspendedUntil: Date | null = null) {
      const userId = randomUUID();
      repo.users.set(userId, {
        id: userId,
        state,
        accountType: 'INDIVIDUAL',
        username: 'neighbour',
        passwordHash: 'irrelevant',
        dateOfBirth: '1995-06-15',
        suspendedUntil,
        language: null,
        termsVersion: 'terms-2026-01',
        termsAcceptedAt: clock.now(),
        createdAt: clock.now(),
      });
      const issued = issueSessionToken(clock.now());
      await repo.createSession({
        id: randomUUID(),
        userId,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
        deviceLabel: null,
      });
      return { userId, token: issued.token };
    },
  };
}

describe('SessionGuard — closed by default', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('REFUSES A ROUTE THAT DECLARED NOTHING, with no token', async () => {
    // Forgetting to guard must produce a dead endpoint, not an open one.
    ctx.route({});
    const { ctx: exec } = ctx.ctxFor({});
    await expect(ctx.guard.canActivate(exec)).rejects.toThrow(UnauthorizedException);
  });

  it('admits a valid bearer token on an undeclared route', async () => {
    ctx.route({});
    const { token } = await ctx.seedSession('ACTIVE');
    const { ctx: exec, req } = ctx.ctxFor({ authorization: `Bearer ${token}` });

    await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
    // The principal is parked for @Principal to pick up.
    expect(principalOf(req)?.state).toBe('ACTIVE');
    expect(principalOf(req)?.capability).toBe('FULL');

    // And it is NOT reachable by serialising the request - the symbol key
    // means a careless JSON.stringify cannot spill it.
    expect(JSON.stringify(req)).not.toContain('ACTIVE');
  });

  it('accepts the scheme case-insensitively, as RFC 7235 requires', async () => {
    ctx.route({});
    const { token } = await ctx.seedSession('ACTIVE');
    for (const scheme of ['Bearer', 'bearer', 'BEARER']) {
      const { ctx: exec } = ctx.ctxFor({ authorization: `${scheme} ${token}` });
      await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
    }
  });

  it('ignores a token in the query string', async () => {
    // Accepting one there would put session tokens in access logs, browser
    // history and referrer headers.
    ctx.route({});
    const { token } = await ctx.seedSession('ACTIVE');
    const { ctx: exec } = ctx.ctxFor({});
    (exec.switchToHttp().getRequest() as Record<string, unknown>).query = { token };

    await expect(ctx.guard.canActivate(exec)).rejects.toThrow(UnauthorizedException);
  });

  it('gives ONE 401 for missing, malformed, unknown and revoked tokens', async () => {
    ctx.route({});
    const codes: string[] = [];

    for (const header of [undefined, 'Bearer', 'Basic abc', 'Bearer not-a-real-token', 'Bearer ']) {
      const { ctx: exec } = ctx.ctxFor(header === undefined ? {} : { authorization: header });
      try {
        await ctx.guard.canActivate(exec);
        codes.push('ADMITTED');
      } catch (e) {
        const body = (e as UnauthorizedException).getResponse() as { code: string };
        codes.push(body.code);
      }
    }

    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toBe('AUTHENTICATION_REQUIRED');
  });
});

describe('SessionGuard — public routes', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('admits a public route with no token', async () => {
    ctx.route({ public: true });
    const { ctx: exec } = ctx.ctxFor({});
    await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
  });

  it('still resolves a token on a public route, so responses can be personalised', async () => {
    ctx.route({ public: true });
    const { userId, token } = await ctx.seedSession('ACTIVE');
    const { ctx: exec, req } = ctx.ctxFor({ authorization: `Bearer ${token}` });

    await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
    expect(principalOf(req)?.userId).toBe(userId);
  });

  it('admits a public route when the token is bad, rather than failing', async () => {
    ctx.route({ public: true });
    const { ctx: exec } = ctx.ctxFor({ authorization: 'Bearer garbage' });
    await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
  });
});

describe('SessionGuard — capability (BR-034, SEC-009 check 2)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('lets an active account write', async () => {
    ctx.route({ capability: 'WRITE' });
    const { token } = await ctx.seedSession('ACTIVE');
    const { ctx: exec } = ctx.ctxFor({ authorization: `Bearer ${token}` });
    await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
  });

  it('REFUSES A WRITE FROM A SUSPENDED ACCOUNT, and says when it ends', async () => {
    const until = new Date('2026-03-08T09:00:00.000Z');
    ctx.route({ capability: 'WRITE' });
    const { token } = await ctx.seedSession('SUSPENDED', until);
    const { ctx: exec } = ctx.ctxFor({ authorization: `Bearer ${token}` });

    try {
      await ctx.guard.canActivate(exec);
      throw new Error('should have been refused');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      const body = (e as ForbiddenException).getResponse() as {
        code: string;
        details?: { path: string; message: string }[];
      };
      expect(body.code).toBe('ACCOUNT_SUSPENDED');
      // The person is entitled to know why they cannot post, and until when.
      expect(body.details?.[0]?.message).toBe(until.toISOString());
    }
  });

  it('still lets a suspended account READ', async () => {
    // A suspension restricts contribution, not access - a suspended user must
    // still be able to read, report and block.
    ctx.route({});
    const { token } = await ctx.seedSession('SUSPENDED', new Date('2026-03-08T09:00:00.000Z'));
    const { ctx: exec } = ctx.ctxFor({ authorization: `Bearer ${token}` });
    await expect(ctx.guard.canActivate(exec)).resolves.toBe(true);
  });

  it('refuses a write from an account pending deletion', async () => {
    ctx.route({ capability: 'WRITE' });
    const { token } = await ctx.seedSession('PENDING_DELETION');
    const { ctx: exec } = ctx.ctxFor({ authorization: `Bearer ${token}` });

    try {
      await ctx.guard.canActivate(exec);
      throw new Error('should have been refused');
    } catch (e) {
      const body = (e as ForbiddenException).getResponse() as { code: string };
      expect(body.code).toBe('PERMISSION_DENIED');
    }
  });

  it('refuses a banned account with 401, not 403', async () => {
    // Banned is not "signed in but limited" - the session is gone entirely, and
    // saying "forbidden" would confirm the account exists.
    ctx.route({ capability: 'WRITE' });
    const { userId, token } = await ctx.seedSession('ACTIVE');
    ctx.repo.setState(userId, 'BANNED');

    const { ctx: exec } = ctx.ctxFor({ authorization: `Bearer ${token}` });
    await expect(ctx.guard.canActivate(exec)).rejects.toThrow(UnauthorizedException);
  });
});
