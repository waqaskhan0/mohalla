import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import type { StructuredLogger } from './common/logging/structured.logger.js';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';

/**
 * Everything that turns a bare `AppModule` into the real application.
 *
 * EXTRACTED FROM `main.ts` BECAUSE IT WAS UNTESTABLE THERE, and that turned out
 * to matter. The error envelope, the global exception filter, `trust proxy`,
 * helmet and CORS are all part of the API's security posture, but they were
 * applied imperatively inside `bootstrap()`. Anything booting `AppModule`
 * directly — a smoke test, an e2e test — got a subtly DIFFERENT application:
 * same routes, no error envelope, no proxy handling.
 *
 * The auth smoke test found this by asserting on `error.code` and receiving
 * `undefined`. The app was right; the test was running a stripped-down variant
 * of it. A test that exercises a configuration the deployment never uses proves
 * very little, so the composition now has ONE definition that both callers use.
 *
 * Everything here is behaviour a client can observe. Anything that belongs to
 * the process rather than the app — reading configuration, opening a port,
 * writing the OpenAPI file, shutdown hooks — stays in `main.ts`.
 */
export function configureApp(
  app: NestExpressApplication,
  env: Env,
  logger: StructuredLogger,
): void {
  // Socket.IO transport. NestJS does NOT apply the IoAdapter merely because
  // @nestjs/platform-socket.io is installed - it must be set explicitly, or the
  // gateway silently never mounts and both the namespace and the default
  // /socket.io path return 404. The foundation ping proved this by failing
  // until the adapter was set.
  app.useWebSocketAdapter(new IoAdapter(app));

  // ---- client address resolution (SEC-007) ------------------------------
  // Express derives `req.ip` from X-Forwarded-For ONLY when `trust proxy` is
  // set, and the per-source login lockout depends on `req.ip` being the real
  // client. Configured rather than assumed, because both errors are real and
  // opposite: too low turns the whole internet into one client, so 50 failures
  // lock out everybody; too high makes the address a client-controlled header
  // and the per-source limit stops existing.
  //
  // A hop COUNT, not `true` - `true` trusts the whole chain, so the
  // client-supplied left-most entry can win.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  if (env.TRUST_PROXY_HOPS === 0 && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    // Loud, because the failure is otherwise silent: rate limits appear to work
    // while counting every request against one address.
    logger.warn(
      JSON.stringify({
        event: 'trust_proxy_not_configured',
        detail:
          'TRUST_PROXY_HOPS is 0. If a reverse proxy fronts this process, per-source rate ' +
          'limits will count all traffic as one client.',
      }),
      'bootstrap',
    );
  }

  // ---- security headers -------------------------------------------------
  // The API serves JSON to an Android client and to the admin console; it
  // renders no HTML of its own, so a restrictive default CSP costs nothing and
  // removes a class of mistake if an error page ever does render markup.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
        },
      },
      // Sent only over HTTPS by the platform; harmless locally.
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // ---- CORS -------------------------------------------------------------
  // Explicit allow-list, never `*`. Empty list = no cross-origin browser
  // access, which is the correct default: the Android client is not a browser,
  // and the admin console is served from its own origin.
  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
    maxAge: 600,
  });

  // ---- cross-cutting ----------------------------------------------------
  // The filter is what produces the single error envelope every client parses.
  // Without it a 401 is Nest's default body and `error.code` does not exist -
  // which is precisely the divergence that motivated this file.
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.useGlobalInterceptors(new RequestLoggingInterceptor(logger));

  // Per-argument zod validation is applied at each handler with
  // `ZodValidationPipe` rather than as a global pipe, because a global pipe
  // needs one schema for every route and there is no such schema.
}
