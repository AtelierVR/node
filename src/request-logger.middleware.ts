import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { NestLogger } from './utils/logger';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;

    // Start timer
    const start = Date.now();

    // Log incoming request
    this.logger.log(`${method} ${originalUrl} from ${ip}`);

    // Log response when finished
    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - start;
      this.logger.log(`${method} ${originalUrl} ${statusCode} - ${duration}ms`);
    });

    next();
  }
}

// Functional middleware for direct use with app.use()
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Use the same logger pattern as other services in the codebase
  const logger = new NestLogger();

  const { method, originalUrl, ip } = req;

  // Start timer
  const start = Date.now();

  // Log incoming request with method, originalUrl (which includes query string), and IP
  const logMessage = `${method} ${originalUrl} from ${ip || req.connection.remoteAddress}`;
  logger.debug(logMessage, 'HTTP');

  // Log response when finished
  res.on('finish', () => {
    const { statusCode } = res;
    const duration = Date.now() - start;
    logger.debug(
      `${method} ${originalUrl} ${statusCode} - ${duration}ms`,
      'HTTP',
    );
  });

  next();
}
