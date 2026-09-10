import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../apps/api/dist/app.module.js';
import { createApiDocument } from '../../apps/api/dist/openapi.js';

// Uses the production module graph without listening or running database work.
const app = await NestFactory.create(AppModule, { logger: false });
try {
  const document = createApiDocument(app);
  const path =
    process.env.OPENAPI_OUT ?? 'docs/architecture/contracts/openapi-stage6-generated.json';
  const serialized = JSON.stringify(document, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== serialized) {
      throw new Error(
        'Generated OpenAPI drift: run npm run contract:generate and review the change',
      );
    }
  } else {
    writeFileSync(path, serialized);
  }
  console.log(
    `OpenAPI: ${Object.keys(document.paths).length} paths, ${Object.keys(document.components.schemas).length} request schemas`,
  );
} finally {
  await app.close();
}
