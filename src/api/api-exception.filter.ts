import { Catch, ArgumentsHost, NotFoundException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiException } from './api-exception';
import { Response, Request } from 'express';
import { BaseExceptionFilter } from '@nestjs/core';
import { ApiErrorCode, ERROR_DEFINITIONS } from './api-error.factory';


@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
    private readonly logger = new Logger(ApiExceptionFilter.name);
    
    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();

        const request = ctx.getRequest();
        const response: Response = ctx.getResponse();

        if (!request.path.startsWith('/api')) {
            const status = exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;
            const message = exception instanceof Error ? exception.message : String(exception);
            this.logger.error(`${status} - ${message}`, exception instanceof Error ? exception.stack : undefined);
            response.status(status).send(`${status} - ${message}`);
            return;
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

        return new ApiException(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            null,
            exception instanceof Error
                ? exception.message
                : String(exception)
        );
    }
}