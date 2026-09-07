import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../identity/transport/session.guard.js';
import { ENV } from '../../../../config/env.token.js';
import type { Env } from '../../../../config/env.js';
import { MetricsService } from '../application/metrics.service.js';

/**
 * `GET /health/metrics` — the operational and product snapshot (NFR-OBS-003/004).
 *
 * UNDER `/health` BECAUSE THAT IS WHERE A MONITOR ALREADY LOOKS. The same
 * uptime checker that polls `/health/ready` polls this; giving it a second
 * base path would be a second thing to configure for no gain.
 *
 * NOT BEHIND AN ADMIN SESSION. §15.5 names the technical owner as the
 * responder, OD-020 means that person does not exist, and an uptime checker
 * cannot hold a session in any case. So the gate is a long shared token, and
 * the route is OFF until one is configured — an operational surface that
 * defaults to public when somebody forgets an environment variable would leak
 * queue depths, user counts and database size to anyone who guessed the path.
 *
 * WHY AN UNCONFIGURED ROUTE 404s RATHER THAN 503s. Without a token there is
 * nothing here to talk to, and a 503 would confirm the path exists and invite
 * a retry. The same reasoning as everywhere else in this codebase: a refusal
 * should not be a discovery mechanism.
 *
 * EXCLUDED FROM THE OPENAPI DOCUMENT. This is not part of the client contract —
 * no Android or admin build calls it — and publishing it would advertise an
 * operational endpoint to every reader of the spec.
 */
@ApiExcludeController()
@Controller('health')
@Public()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('metrics')
  async snapshot(@Headers('authorization') authorization?: string) {
    const configured = this.env.METRICS_TOKEN;

    if (configured === undefined) {
      throw new NotFoundException({
        code: 'RESOURCE_UNAVAILABLE',
        message: 'This content is no longer available.',
      });
    }

    if (!presentedMatches(authorization, configured)) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
      });
    }

    return this.metrics.snapshot();
  }
}

/**
 * Compare in constant time.
 *
 * A shared secret with no rate limit and no lockout behind it is exactly the
 * case where a byte-by-byte `===` is worth avoiding: an attacker who can time
 * the response can recover the token one character at a time. The length is
 * compared first and separately, which does leak the length — that is
 * acceptable and unavoidable, and a length is not a secret.
 */
function presentedMatches(authorization: string | undefined, expected: string): boolean {
  if (authorization === undefined) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const presented = match?.[1];
  if (presented === undefined) return false;

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
