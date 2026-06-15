import { Catch, ArgumentsHost, NotFoundException, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiException } from './api-exception';
import { Response, Request } from 'express';
import { BaseExceptionFilter } from '@nestjs/core';
import { ApiErrorCode, ERROR_DEFINITIONS } from './api-error.factory';
import { ROOT_ONLY_PATHS } from './api.constants';
import * as fs from 'node:fs';
import * as path from 'node:path';


@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
    private readonly logger = new Logger(ApiExceptionFilter.name);
    private readonly globalPrefix: string;
    private readonly excludedPaths: string[];

    constructor(globalPrefix: string = 'api', excludedPaths: string[] = ROOT_ONLY_PATHS) {
        super();
        this.globalPrefix = globalPrefix;
        this.excludedPaths = excludedPaths;
    }

    private isApiRoute(requestPath: string): boolean {
        // Root-only paths (well-known, nodeinfo, ap) are never API routes
        if (this.excludedPaths.some(p => requestPath === `/${p}` || requestPath.startsWith(`/${p}/`))) return false;
        // No prefix → every other route is an API route
        if (!this.globalPrefix) return true;
        return requestPath.startsWith(`/${this.globalPrefix}`);
    }

    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();

        const request = ctx.getRequest();
        const response: Response = ctx.getResponse();

        if (!this.isApiRoute(request.path)) {
            const status = exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;
            const message = exception instanceof Error ? exception.message : String(exception);
            this.logger.error(`${status} - ${message}`, exception instanceof Error ? exception.stack : undefined);
            response.status(status).send(`${status} - ${message}`);
            return;
        }

        // Fallback: serve static files from public/ for unmatched GET routes
        if (exception instanceof NotFoundException && request.method === 'GET') {
            const prefixStrip = this.globalPrefix ? new RegExp(`^\\/${this.globalPrefix}\\/?`) : /^\//;
            const relativePath = request.path.replace(prefixStrip, '');
            const staticFile = path.join(process.cwd(), 'public', relativePath);
            try {
                const stat = fs.statSync(staticFile);
                if (stat.isFile()) 
                    return response.sendFile(staticFile);
            } catch {
                // file not found — fall through to standard error response
            }
        }

        const api = this.toApiException(exception, request);
        let def = ERROR_DEFINITIONS[api.code]
            || ERROR_DEFINITIONS[ApiErrorCode.INTERNAL_SERVER_ERROR];

        this.logger.error(`${def.status} - ${api.message} [${api.code}]`, exception.stack);
        response.status(def.status).json({
            data: exception instanceof ApiException ? api.data : null,
            error: {
                code: api.code,
                message: api.message,
                status: def.status,
            },
            request: request.originalUrl,
            time: Date.now()
        });
    }

    private toApiException(exception: HttpException, request: Request): ApiException {
        if (exception instanceof ApiException)
            return exception;
        else if (exception instanceof NotFoundException)
            return new ApiException(ApiErrorCode.NOT_IMPLEMENTED, null, `${request.method} ${request.path}`);
        else if (exception instanceof BadRequestException) {
            const res = exception.getResponse();
            const message = typeof res === 'object' && res !== null && 'message' in res
                ? (Array.isArray((res as any).message) ? (res as any).message.join(', ') : String((res as any).message))
                : exception.message;
            return new ApiException(ApiErrorCode.BAD_REQUEST, null, message);
        }

        return new ApiException(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            null,
            exception instanceof Error
                ? exception.message
                : String(exception)
        );
    }
}