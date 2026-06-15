import { NestFactory } from '@nestjs/core';
import './utils/logger';
import { NestLogger } from './utils/logger';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { AppConfigService } from './config/config.service';
import { ApiExceptionFilter } from './api/api-exception.filter';
import { ROOT_ONLY_PATHS } from './api/api.constants';
import { ExternalServersService } from './external/external-servers.service';

async function bootstrap() {
  let logger = new NestLogger();
  const app = await NestFactory.create(AppModule, { logger: logger, rawBody: true });

  // Parse cookies for authentication middleware and controllers
  app.use(cookieParser());

  // CORS must be enabled before app.init() so its middleware is registered
  // ahead of all route handlers in the Express stack.
  const corsEnabled = process.env.CORS_ENABLED !== 'false';
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const corsCredentials = process.env.CORS_CREDENTIALS !== 'false';

  if (corsEnabled)
    app.enableCors({
      origin: corsOrigins.length ? corsOrigins : true,
      credentials: corsCredentials,
    });

  // All routes live under /api by default — except ActivityPub well-known and nodeinfo endpoints
  // which must be served at the root level per the protocols' specs.
  // Customize the prefix via HTTP_PREFIX env var or http.prefix in config.yaml (requires restart).
  // Set HTTP_PREFIX to an empty string to serve all routes at the root.
  const prefix = process.env.HTTP_PREFIX ?? 'api';

  if (prefix)
    app.setGlobalPrefix(prefix, {
      exclude: ROOT_ONLY_PATHS.flatMap(path => [
        {
          path,
          method: RequestMethod.ALL
        },
        {
          path: `/${path}/(.*)`,
          method: RequestMethod.ALL
        },
      ]),
    });

  app.useGlobalFilters(new ApiExceptionFilter(prefix, ROOT_ONLY_PATHS));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // onModuleInit hooks (including PrismaService DB connect + migrate) are triggered
  // by init(), not by NestFactory.create(). Call it explicitly so the database is
  // ready before we read any config values from it.
  logger.log("Initializing application modules...");
  await app.init();

  const config = app.get(AppConfigService);

  logger.log("Starting server...", 'Bootstrap');

  const port = await config.get<number>('http.port');
  const host = await config.get<string>('http.host');

  await app.listen(port, host, () => {
    logger.log(`Server is running on http://${host}:${port}`, 'Bootstrap');
    if (corsEnabled)
      logger.log(`CORS enabled for origins (credentials: ${corsCredentials}):\n${corsOrigins.map((o) => `  - ${o}`).join('\n')}`, 'Bootstrap');
  });


  // Verify own well-known endpoint is reachable after the server is up
  app.get(ExternalServersService).checkSelfWellKnown();
}
bootstrap();
