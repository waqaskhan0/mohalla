import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IdentityErrorCode } from '@mohalla/contracts';
import { AdminAuthService, type AdminPrincipal } from '../application/admin-auth.service.js';

const ADMIN_PRINCIPAL = Symbol('mohalla.adminPrincipal');

type AdminRequest = Request & { [ADMIN_PRINCIPAL]?: AdminPrincipal };

export function adminPrincipalOf(req: unknown): AdminPrincipal | undefined {
  return (req as AdminRequest | undefined)?.[ADMIN_PRINCIPAL];
}

/**
 * Marks a route as requiring an ADMIN session rather than a user session.
 *
 * Opt-IN, which is the opposite of `@Public()` — and deliberately so. The two
 * decorators fail safe in opposite directions because the mistakes differ: a
 * route that forgets `@Public()` becomes unreachable (loud), while a route that
 * forgot to require an admin would fall through to the ordinary user guard and
 * be reachable BY ANY SIGNED-IN USER (silent, and a privilege escalation).
 *
 * So an admin route must say so, and `SessionGuard` must not accept a user
 * session in its place. `@RequiresAdmin()` also implies `@Public()` for the
 * user guard, since the credential lives in a different store entirely.
 */
export const REQUIRES_ADMIN = 'mohalla.requiresAdmin';
export const RequiresAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_ADMIN, true);

/** Injects the resolved administrator into a handler parameter. */
export const Admin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const principal = adminPrincipalOf(ctx.switchToHttp().getRequest());
    if (principal === undefined) {
      throw new UnauthorizedException({
        code: IdentityErrorCode.AUTHENTICATION_REQUIRED,
        message: 'Authentication required.',
      });
    }
    return principal;
  },
);

/**
 * Administrator authentication (SEC-020 · SEC-024).
 *
 * A SEPARATE guard resolving against a SEPARATE store. A user session token
 * presented here does not resolve, because it was never written to
 * `admin_sessions` — the separation is in the data, not merely in this check.
 *
 * Runs on routes marked `@RequiresAdmin()` and ignores everything else, so it
 * can be registered globally alongside the user guard without either one
 * having to know about the other.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_ADMIN, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required !== true) return true;

    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' ? /^Bearer (.+)$/i.exec(header.trim())?.[1] : undefined;

    if (token === undefined || token.length === 0) throw unauthenticated();

    const result = await this.adminAuth.resolve(token);
    if (result.status !== 'AUTHENTICATED') throw unauthenticated();

    req[ADMIN_PRINCIPAL] = result.principal;
    return true;
  }
}

function unauthenticated(): UnauthorizedException {
  return new UnauthorizedException({
    code: IdentityErrorCode.AUTHENTICATION_REQUIRED,
    message: 'Authentication required.',
  });
}
