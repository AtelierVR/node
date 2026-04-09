import type { Request } from 'express';
import type { ApiError, ApiErrorResponse } from './api.types';
import { HttpStatus } from '@nestjs/common';

// ── Error codes ───────────────────────────────────────────────────────────────

export enum ApiErrorCode {
    // 4xx — client errors
    BAD_REQUEST = 'BAD_REQUEST',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    NOT_FOUND = 'NOT_FOUND',
    METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
    CONFLICT = 'CONFLICT',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    RATE_LIMITED = 'RATE_LIMITED',
    VERIFICATION_REQUIRED = 'VERIFICATION_REQUIRED',
    // 5xx — server errors
    NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
    INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    EXTERNAL_SERVER_ERROR = 'EXTERNAL_SERVER_ERROR',
}

// ── Error definitions ─────────────────────────────────────────────────────────

type MessageFn = (...args: string[]) => string;

interface ErrorDef {
    status: HttpStatus | -1; // -1 for custom status (e.g. network errors)
    /** Static string OR template function receiving ...messageArgs */
    message: string | MessageFn;
}

export const ERROR_DEFINITIONS: Record<ApiErrorCode, ErrorDef> = {
    [ApiErrorCode.BAD_REQUEST]: {
        status: HttpStatus.BAD_REQUEST,
        message: (detail = 'Malformed or invalid request') => detail,
    },
    [ApiErrorCode.UNAUTHORIZED]: {
        status: HttpStatus.UNAUTHORIZED,
        message: 'Authentication is required to access this resource',
    },
    [ApiErrorCode.FORBIDDEN]: {
        status: HttpStatus.FORBIDDEN,
        message: (action = 'access this resource') => `You do not have permission to ${action}`,
    },
    [ApiErrorCode.NOT_FOUND]: {
        status: HttpStatus.NOT_FOUND,
        message: (resource = 'Resource') => `${resource} not found`,
    },
    [ApiErrorCode.METHOD_NOT_ALLOWED]: {
        status: HttpStatus.METHOD_NOT_ALLOWED,
        message: (method = '?', path = '?') => `${method} is not allowed on ${path}`,
    },
    [ApiErrorCode.CONFLICT]: {
        status: HttpStatus.CONFLICT,
        message: (resource = 'Resource') => `${resource} already exists`,
    },
    [ApiErrorCode.VALIDATION_ERROR]: {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: (detail = 'One or more fields are invalid') => detail,
    },
    [ApiErrorCode.RATE_LIMITED]: {
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests — please slow down',
    },
    [ApiErrorCode.NOT_IMPLEMENTED]: {
        status: HttpStatus.NOT_IMPLEMENTED,
        message: (obj = '?') => `${obj} is not implemented`,
    },
    [ApiErrorCode.INTERNAL_SERVER_ERROR]: {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
    },
    [ApiErrorCode.SERVICE_UNAVAILABLE]: {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: (service = 'The service') => `${service} is temporarily unavailable`,
    },
    [ApiErrorCode.VERIFICATION_REQUIRED]: {
        status: HttpStatus.FORBIDDEN,
        message: 'Verification is required to access this resource',
    },
    [ApiErrorCode.EXTERNAL_SERVER_ERROR]: {
        status: -1,
        message: (message) => message || 'An error occurred while communicating with an external server',
    },
};

// ── Factory ───────────────────────────────────────────────────────────────────

export class ApiErrorFactory {
    /**
     * Build a full ApiErrorResponse envelope.
     *
     * @param code      - Predefined error code
     * @param req       - Express request (provides `time` and `request` fields)
     * @param data      - Optional response data (defaults to null)
     * @param messageArgs - Positional arguments forwarded to the message template
     *
     * @example
     * ApiErrorFactory.create(ApiErrorCode.NOT_FOUND, req, null, 'User')
     * // → { data: null, error: { code: 'NOT_FOUND', message: 'User not found', status: 404 }, ... }
     *
     * @example
     * ApiErrorFactory.create(ApiErrorCode.NOT_IMPLEMENTED, req, null, req.method, req.path)
     */
    static create<T = null>(
        code: ApiErrorCode,
        req: Request,
        data: T | null = null,
        ...messageArgs: string[]
    ): ApiErrorResponse<T | null> {
        return {
            data,
            error: ApiErrorFactory.buildError(code, ...messageArgs),
            time: Date.now(),
            request: req.path,
        };
    }

    /**
     * Build only the ApiError inner object (useful when wrapping with ApiResponseService).
     *
     * @example
     * this.api.error(ApiErrorFactory.buildError(ApiErrorCode.NOT_FOUND, 'User'), req)
     */
    static buildError(code: ApiErrorCode, ...messageArgs: string[]): ApiError {
        const def = ERROR_DEFINITIONS[code];
        return {
            code,
            message: ApiErrorFactory.formatMessage(code, ...messageArgs),
            status: def.status
        };
    }

    /** 
     * Format the error message by applying the messageArgs to the template, if needed.
     */
    static formatMessage(code: ApiErrorCode, ...messageArgs: string[]): string {
        const def = ERROR_DEFINITIONS[code];
        return typeof def.message === 'function'
            ? def.message(...messageArgs)
            : def.message;
    }

    static getStatus(code: ApiErrorCode): number {
        return ERROR_DEFINITIONS[code].status;
    }
}
