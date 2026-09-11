import 'reflect-metadata';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './common/validation/zod-validation.pipe.js';
import { createApiDocument } from './openapi.js';

const schema = z
  .object({
    title: z.string().min(1),
    mode: z.enum(['ONLINE', 'PHYSICAL']),
    note: z.string().nullable().optional(),
  })
  .strict();
class ContractController {
  submit(body: unknown) {
    return body;
  }
}
Controller('contract')(ContractController);
Post()(
  ContractController.prototype,
  'submit',
  Object.getOwnPropertyDescriptor(ContractController.prototype, 'submit')!,
);
Body(new ZodValidationPipe(schema))(ContractController.prototype, 'submit', 0);
class ContractModule {}
Module({ controllers: [ContractController] })(ContractModule);

describe('generated OpenAPI from runtime validation', () => {
  // TWENTY SECONDS, NOT THE GLOBAL FIVE.
  //
  // This test boots a Nest application and generates an OpenAPI document, and
  // that is genuinely variable work: measured at 4.3 s run alone and 9.4 s
  // under a full parallel suite on the same machine, which made it a flake
  // sitting right on the default boundary. Raising the budget for one test that
  // starts a framework changes nothing it asserts; the alternative was a red
  // verify that meant nothing.
  it(
    'publishes required fields, enums, nullability and strict object shape from the actual route pipe',
    { timeout: 20_000 },
    async () => {
      const app = await NestFactory.create(ContractModule, { logger: false });
      try {
        const document = createApiDocument(app);
        expect(document.paths['/contract']?.post?.requestBody).toEqual({
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ContractController_submitRequest' },
            },
          },
        });
        expect(document.components?.schemas?.ContractController_submitRequest).toMatchObject({
          type: 'object',
          required: ['title', 'mode'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1 },
            mode: { enum: ['ONLINE', 'PHYSICAL'] },
            note: { nullable: true },
          },
        });
      } finally {
        await app.close();
      }
    },
  );
});
