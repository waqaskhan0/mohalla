import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { StructuredLogger } from './structured.logger.js';

/**
 * Logs one line per completed request: method, route, status, duration.
 *
 * The URL is logged WITHOUT its query string. Query strings are where
 * identifiers and tokens end up, and Stage 4's privacy rules forbid personal
 * data in URLs - so logging the raw URL would defeat that rule at the logging
 * layer even when the application respected it everywhere else.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    if (context.getType() !== 'http') return next.handle();

    const started = process.hrtime.bigint();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const method = req.method;
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];

    /**
     * LOGGED WHEN THE RESPONSE IS ACTUALLY WRITTEN, not when the handler
     * settles (QA-008).
     *
     * This used to log from an rxjs `tap`, reading `res.statusCode` in both the
     * next and the error path. On the error path that is too early: the
     * exception filter has not run yet, so the status is still Express's
     * default 200 and EVERY failed request was recorded as a success. Measured
     * across the board — a 401 from the session guard, a 400 from a validation
     * pipe and a 503 from a thrown exception were all logged as `status: 200`.
     *
     * That is worse than having no access log. Error-rate alerting built on
     * these lines would never fire, and a brute-force run against `/login`
     * would appear as a wall of 200s.
     *
     * `finish` fires after the status line and headers are on the wire, so it
     * reads what the client really received. `close` covers the case where the
     * client disconnected before that, which would otherwise log nothing at
     * all; `logged` keeps the pair from producing two lines for one request.
     */
    let logged = false;
    const record = (): void => {
      if (logged) return;
      logged = true;
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.logger.log(
        JSON.stringify({
          event: 'http_request',
          method,
          path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        }),
        'http',
      );
    };

    res.on('finish', record);
    res.on('close', record);

    return next.handle();
  }
}
