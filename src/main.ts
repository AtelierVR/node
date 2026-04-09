import { NestFactory } from '@nestjs/core';
import './utils/logger';
import { NestLogger } from './utils/logger';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { AppConfigService } from './config/config.service';
import { ApiExceptionFilter } from './api/api-exception.filter';
import { ExternalServersService } from './external/external-servers.service';

async function bootstrap() {
  let logger = new NestLogger();
  const app = await NestFactory.create(AppModule, { logger: logger, rawBody: true });

  // Parse cookies for authentication middleware and controllers
  app.use(cookieParser());

  // All routes live under /api — except ActivityPub well-known and nodeinfo endpoints
  // which must be served at the root level per the protocols' specs.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '.well-known/webfinger', method: RequestMethod.GET },
      { path: '.well-known/nodeinfo', method: RequestMethod.GET },
      { path: '.well-known/host-meta', method: RequestMethod.GET },
      { path: '.well-known/nox', method: RequestMethod.GET },
      { path: 'nodeinfo/2.1', method: RequestMethod.GET },
    ],
  });

  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = app.get(AppConfigService);

  const port = await config.get<number>('http.port');
  const host = await config.get<string>('http.host');

  let corsEnabled = await config.get<boolean>('cors.enabled');
  let corsOrigins = (await config.get<string>('cors.origins'))
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) ?? '';
  let corsCredentials = await config.get<boolean>('cors.credentials');

  if (corsEnabled)
    app.enableCors({
      origin: corsOrigins
        ? corsOrigins
        : true,
      credentials: corsCredentials
    });

  await app.listen(port, host, () => {
    logger.log(`Server is running on http://${host}:${port}`, 'Bootstrap');
    if (corsEnabled)
      logger.log(`CORS enabled for origins: ${corsOrigins} — credentials: ${corsCredentials}`, 'Bootstrap');

  });


  // Verify own well-known endpoint is reachable after the server is up
  app.get(ExternalServersService).checkSelfWellKnown();
}
bootstrap();
