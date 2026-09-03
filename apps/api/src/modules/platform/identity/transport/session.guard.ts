import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IdentityErrorCode } from '@mohalla/contracts';
import { SessionService, type AuthenticatedPrincipal } from '../application/session.service.js';

/**
 * Where the resolved principal is parked for the request's lifetime.
 *
 * A Symbol rather than a string key, which has a useful side effect: symbol
 * properties are skipped by `JSON.stringify`, so a handler that carelessly
 * serialises the request object cannot spill the principal into a response or
 * a log line.
 */
const PRINCIPAL = Symbol('mohalla.principal');

type AuthedRequest = Request & { [PRINCIPAL]?: AuthenticatedPrincipal };

/**
 * Read the principal the guard attached, if any.
 *
 * Exported so the decorator and the tests share ONE accessor instead of each
 * knowing where the guard hides it.
 */
export function principalOf(req: unknown): AuthenticatedPrincipal | undefined {
  return (req as AuthedRequest | undefined)?.[PRINCIPAL];
}

/**
 * Marks a route as reachable without a session.
 *
 * OPT-OUT, NOT OPT-IN, and that choice is the point. If routes had to ask to be
 * guarded, the failure mode of forgetting would be an OPEN endpoint — and the
 * newest, least-reviewed controller is the most likely to forget. This way
 * forgetting fails closed: the route simply stops working, loudly, in the first
 * test that calls it.
 */
export const PUBLIC_ROUTE = 'mohalla.publicRoute';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

/**
 * Requires a capability beyond merely being signed in.
 *
 * `WRITE` is refused for a suspended account (BR-034) and for one pending
 * deletion, so a controller does not have to remember the rule — check 2 of
 * the three authorization checks (SEC-009) lives here, once.
 */
export const REQUIRED_CAPABILITY = 'mohalla.requiredCapability';
export const RequiresWrite = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_CAPABILITY, 'WRITE');

/** Injects the resolved principal into a handler parameter. */
export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const principal = principalOf(ctx.switchToHttp().getRequest());
    if (principal === undefined) {
      // Reaching here means a handler asked for a principal on a route the
      // guard let through unauthenticated - a wiring mistake, not a user error.
      throw new UnauthorizedException({
        code: IdentityErrorCode.AUTHENTICATION_REQUIRED,
        message: 'Authentication required.',
      });
    }
    return principal;
  },
);

/**
 * Checks 1 and 2 of the three authorization checks (SEC-009).
 *
 *   1 · Authentication — a valid, unrevoked session in the correct store.
 *   2 · Capability     — does this account STATE permit the action?
 *
 * Check 3, object-level access, is not here on purpose: it needs the object,
 * which only the handler has loaded. It lives in a shared visibility guard so
 * IDOR is one reviewed implementation rather than a per-controller `if`
 * (SEC-011).
 *
 * The token is read from `Authorization: Bearer` only. Accepting it from a
 * query string as well would mean session tokens in access logs, browser
 * history and referrer headers.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);

    // A public route still resolves a token when one is present, so a handler
    // can personalise a public response - but never requires one.
    if (isPublic === true) {
      if (token !== null) {
        const result = await this.sessions.resolve(token);
        if (result.status === 'AUTHENTICATED') req[PRINCIPAL] = result.principal;
      }
      return true;
    }

    if (token === null) throw unauthenticated();

    const result = await this.sessions.resolve(token);
    if (result.status !== 'AUTHENTICATED') throw unauthenticated();

    req[PRINCIPAL] = result.principal;

    const required = this.reflector.getAllAndOverride<string>(REQUIRED_CAPABILITY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (required === 'WRITE' && result.principal.capability !== 'FULL') {
      if (result.principal.capability === 'READ_ONLY') {
        // A suspension is disclosed WITH its end date: the person is entitled
        // to know why they cannot post and when that ends (BR-034).
        throw new ForbiddenException({
          code: IdentityErrorCode.ACCOUNT_SUSPENDED,
          message: 'Account is limited.',
          details:
            result.principal.suspendedUntil === null
              ? undefined
              : [
                  {
                    path: 'suspendedUntil',
                    message: result.principal.suspendedUntil.toISOString(),
                  },
                ],
        });
      }
      throw new ForbiddenException({
        code: IdentityErrorCode.PERMISSION_DENIED,
        message: 'You do not have permission to do that.',
      });
    }

    return true;
  }
}

function unauthenticated(): UnauthorizedException {
  // One message for missing, malformed, unknown, expired and revoked. Which of
  // those it was is not information the caller is owed.
  return new UnauthorizedException({
    code: IdentityErrorCode.AUTHENTICATION_REQUIRED,
    message: 'Authentication required.',
  });
}

/**
 * Extract a bearer token.
 *
 * Case-insensitive on the scheme because RFC 7235 says the scheme is
 * case-insensitive and real clients do vary. Everything after the single space
 * is the token, untrimmed beyond that - a token is opaque, and "helpfully"
 * stripping characters would make a wrong token look like a right one.
 */
function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;

  const match = /^Bearer (.+)$/i.exec(header.trim());
  const token = match?.[1];
  return token === undefined || token.length === 0 ? null : token;
}
