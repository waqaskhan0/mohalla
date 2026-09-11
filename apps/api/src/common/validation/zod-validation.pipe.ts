import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { FoundationErrorCode } from '@mohalla/contracts';
import { validate } from '@mohalla/validation';
import { z } from 'zod';

/**
 * Validates a handler argument against a zod schema.
 *
 * Zod rather than class-validator because the project already validates
 * environment variables and shared primitives with zod, and the same schema can
 * be reused by the worker and by scripts - neither of which runs inside NestJS,
 * and neither of which can use decorator-based validation at all.
 *
 * Rejections are returned as VALIDATION_FAILED with field paths, never with the
 * received values.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  /** Derived from the validator used on the route, not a parallel DTO. */
  inputSchema() {
    return z.toJSONSchema(this.schema, { target: 'openapi-3.0', io: 'input' });
  }

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = validate(this.schema, value);
    if (result.ok) return result.value;

    throw new BadRequestException({
      code: FoundationErrorCode.VALIDATION_FAILED,
      message: 'Request validation failed.',
      details: result.issues,
    });
  }
}
