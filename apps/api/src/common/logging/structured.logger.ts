import type { LoggerService, LogLevel } from '@nestjs/common';
import { redact, redactText } from '@mohalla/observability';
import { currentCorrelationId } from '../correlation/correlation.context.js';

const ORDER: Record<string, number> = { debug: 10, log: 20, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logger.
 *
 * One JSON object per line, with the correlation id attached automatically from
 * the async context. JSON rather than pretty text because these lines are read
 * by a log aggregator far more often than by a human, and a human can still
 * pipe them through `jq`. Pretty-printing would make the aggregator's job
 * harder to make the rarer case marginally nicer.
 *
 * It writes to stdout and never to a file. The platform collects stdout; a
 * process writing its own log files on a PaaS instance produces logs that
 * vanish with the container.
 *
 * REDACTION HAPPENS HERE, IN `emit`, AND NOWHERE ELSE (NFR-OBS-001, §15.4:
 * "Redaction runs BEFORE WRITE, not as a filter afterwards").
 *
 * Putting it at the single point of write is the whole guarantee. A caller
 * cannot forget to redact, because no caller does it; a future logging site
 * inherits the rule by existing; and there is exactly one line in the codebase
 * where a sensitive value could reach stdout, which is a line a reviewer can
 * check. The alternative - each call site sanitising its own fields - fails the
 * first time somebody logs an error object they did not construct.
 *
 * The rule itself lives in `@mohalla/observability`, shared with the worker,
 * because two redaction rules that drift are one redaction rule that does not
 * work.
 */
export class StructuredLogger implements LoggerService {
  constructor(
    private readonly service: string,
    private readonly minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info',
  ) {}

  private emit(level: string, message: unknown, context?: unknown, stack?: unknown): void {
    if ((ORDER[level] ?? 20) < (ORDER[this.minLevel] ?? 20)) return;

    // The message is redacted whether it arrived as a string or as an object.
    // Most callers here pass `JSON.stringify({...})`, so the string path is the
    // one that matters: by the time it reaches this method the structure is
    // gone and only the SHAPE rules can still find a phone number in it.
    const redactedMessage =
      typeof message === 'string' ? redactText(message) : JSON.stringify(redact(message));

    const line: Record<string, unknown> = {
      // `time` is set AFTER redaction and never passes through it, so a
      // timestamp can never be mistaken for a date of birth.
      time: new Date().toISOString(),
      level: level === 'log' ? 'info' : level,
      service: this.service,
      message: redactedMessage,
    };

    const correlationId = currentCorrelationId();
    if (correlationId) line.correlationId = correlationId;
    if (typeof context === 'string' && context) line.context = context;
    // A stack trace is where an unanticipated value most often ends up: a
    // number or a token embedded in a thrown message and carried up the frames.
    if (stack) line.stack = redactText(String(stack));

    process.stdout.write(`${JSON.stringify(line)}\n`);
  }

  log(message: unknown, context?: unknown): void {
    this.emit('info', message, context);
  }
  error(message: unknown, stack?: unknown, context?: unknown): void {
    this.emit('error', message, context, stack);
  }
  warn(message: unknown, context?: unknown): void {
    this.emit('warn', message, context);
  }
  debug(message: unknown, context?: unknown): void {
    this.emit('debug', message, context);
  }
  verbose(message: unknown, context?: unknown): void {
    this.emit('debug', message, context);
  }
  setLogLevels?(_levels: LogLevel[]): void {
    // Levels are fixed from LOG_LEVEL at startup so that log volume is a
    // deployment decision rather than something code can quietly change.
  }
}
