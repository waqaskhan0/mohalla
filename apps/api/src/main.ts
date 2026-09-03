import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { loadEnv } from './config/env.js';
import { StructuredLogger } from './common/logging/structured.logger.js';

/**
 * API entry point.
 *
 * Owns only what belongs to the PROCESS: reading configuration, creating the
 * app, publishing the OpenAPI document, binding the port and shutdown hooks.
 * How the application itself behaves lives in `configureApp`, so that a test
 * can boot an identical one.
 */
async function bootstrap(): Promise<void> {
  // Validate configuration before the framework starts, so a misconfigured
  // process fails immediately and visibly rather than under load.
  const env = loadEnv();
  const logger = new StructuredLogger('api', env.LOG_LEVEL);

  // Typed as the Express application because `trust proxy` below is an Express
  // setting. The untyped `create` returns the platform-agnostic interface, on
  // which `set` does not exist.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bufferLogs: false,
  });

  // Transport, proxy handling, security headers, CORS, the error envelope and
  // request logging. Extracted so a smoke or e2e test boots the SAME
  // application this does - see configure-app.ts for why that matters.
  configureApp(app, env, logger);

  // ---- OpenAPI ----------------------------------------------------------
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Mohalla API — foundation')
      .setDescription(
        'Shehersaaz Community Platform. STAGE 5 FOUNDATION — health endpoints only. ' +
          'The approved product contract is docs/architecture/contracts/openapi-v1.yaml.',
      )
      .setVersion(env.APP_VERSION)
      .build(),
  );

  // Interactive docs in development only. In staging and production the spec is
  // still generated (and written to disk when asked) but not served, because an
  // always-on schema browser is free reconnaissance.
  if (env.NODE_ENV === 'development') {
    SwaggerModule.setup('docs', app, doc);
  }

  if (process.env.OPENAPI_OUT) {
    writeFileSync(process.env.OPENAPI_OUT, JSON.stringify(doc, null, 2), 'utf8');
    logger.log(`OpenAPI written to ${process.env.OPENAPI_OUT}`, 'bootstrap');
  }

  // ---- lifecycle --------------------------------------------------------
  // Required by the rolling-restart deployment strategy (Stage 4 section 14):
  // without it, every deploy drops in-flight requests.
  app.enableShutdownHooks();

  await app.listen(env.PORT);

  logger.log(
    JSON.stringify({
      event: 'startup',
      port: env.PORT,
      environment: env.NODE_ENV,
      version: env.APP_VERSION,
      commit: env.GIT_COMMIT,
      socketPath: env.SOCKET_IO_PATH,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      epics: ['EPIC-02 authentication and sessions'],
    }),
    'bootstrap',
  );
}

void bootstrap();
