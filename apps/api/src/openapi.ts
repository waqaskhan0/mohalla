import type { INestApplication } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { ZodValidationPipe } from './common/validation/zod-validation.pipe.js';

/** Attach the actual body validators to the existing generated route contract. */
export function createApiDocument(app: INestApplication, version = '0.0.0'): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Mohalla API')
      .setDescription(
        'Current backend routes. Request schemas derive from runtime Zod validators. ' +
          'Cross-field rules remain enforced by the API; client response serialization is verified against runtime specimens.',
      )
      .setVersion(version)
      .build(),
  );
  const modules = app.get(ModulesContainer);
  const schemas: Record<string, SchemaObject> = {};
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller?.prototype) continue;
      for (const method of Object.getOwnPropertyNames(controller.prototype)) {
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
          Record<string, { pipes?: unknown[] }> | undefined;
        for (const [parameter, metadata] of Object.entries(args ?? {})) {
          if (!parameter.startsWith('3:')) continue;
          const pipe = metadata.pipes?.find((p) => p instanceof ZodValidationPipe);
          if (!(pipe instanceof ZodValidationPipe)) continue;
          const operationId = `${controller.name}_${method}`;
          const schemaName = `${operationId}Request`;
          const schema = pipe.inputSchema() as SchemaObject;
          for (const path of Object.values(document.paths)) {
            for (const operation of Object.values(path ?? {})) {
              if (
                typeof operation !== 'object' ||
                operation === null ||
                !('operationId' in operation) ||
                operation.operationId !== operationId
              )
                continue;
              schemas[schemaName] = schema;
              operation.requestBody = {
                required: true,
                content: {
                  'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } },
                },
              };
            }
          }
        }
      }
    }
  }
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ...schemas,
    },
  };
  return document;
}
