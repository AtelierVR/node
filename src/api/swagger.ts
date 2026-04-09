import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiExtension, ApiProperty, ApiResponse, ApiSecurity, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorDetailsDto } from './dto/error-details.dto';
import { ApiSuccessDto } from './dto/success.dto';

/** `error` field for success responses: always null. */
const errorFieldNull = { type: 'null' as const, example: null, description: 'Always null for successful responses.' };

/** Reusable inline schema for the error envelope body (4xx/5xx). */
const errorEnvelopeSchema = () => ({
    type: 'object' as const,
    required: ['data', 'error', 'time', 'request'],
    properties: {
        data: { type: 'null' as const, example: null, description: 'Always null for error responses.' },
        error: { $ref: getSchemaPath(ApiErrorDetailsDto), description: 'Error details object.' },
        time: { type: 'integer' as const, example: 1680000000000, description: 'Unix timestamp (ms) when the response was generated.' },
        request: { type: 'string' as const, example: '/api/endpoint', description: 'Request path that produced this response.' },
    },
});

/** Documents a 4xx/5xx error response using the standard error envelope. */
export function ApiErrorResponse(
    status:
        | HttpStatus.BAD_REQUEST
        | HttpStatus.UNAUTHORIZED
        | HttpStatus.FORBIDDEN
        | HttpStatus.NOT_FOUND
        | HttpStatus.CONFLICT
        | HttpStatus.UNPROCESSABLE_ENTITY
        | HttpStatus.TOO_MANY_REQUESTS
        | HttpStatus.INTERNAL_SERVER_ERROR
        | HttpStatus.NOT_IMPLEMENTED
        | HttpStatus.SERVICE_UNAVAILABLE,
    description?: string,
) {
    const defaultDescriptions: Record<number, string> = {
        [HttpStatus.BAD_REQUEST]: 'Bad request — invalid parameters or body.',
        [HttpStatus.UNAUTHORIZED]: 'Unauthorized — authentication required.',
        [HttpStatus.FORBIDDEN]: 'Forbidden — insufficient permissions.',
        [HttpStatus.NOT_FOUND]: 'Not found.',
        [HttpStatus.CONFLICT]: 'Conflict — resource already exists.',
        [HttpStatus.UNPROCESSABLE_ENTITY]: 'Validation error — one or more fields are invalid.',
        [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests.',
        [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal server error.',
        [HttpStatus.NOT_IMPLEMENTED]: 'Not implemented.',
        [HttpStatus.SERVICE_UNAVAILABLE]: 'Service unavailable.',
    };
    return applyDecorators(
        ApiExtraModels(ApiErrorDetailsDto),
        ApiResponse({
            status,
            description: description ?? defaultDescriptions[status] ?? String(status),
            schema: errorEnvelopeSchema(),
        }),
    );
}

/**
 * Decorator factory that documents the API response wrapped in the standard
 * `{ data, error, time, request }` envelope emitted by ApiInterceptor.
 */
export function ApiWrappedResponse<T>(dataType: Type<T>, status = HttpStatus.OK) {
    return applyDecorators(
        ApiExtraModels(dataType),
        ApiResponse({
            status,
            schema: {
                type: 'object',
                required: ['data', 'error', 'time', 'request'],
                properties: {
                    data: { $ref: getSchemaPath(dataType), description: 'Response payload.' },
                    error: errorFieldNull,
                    time: { type: 'integer', example: 1680000000000, description: 'Unix timestamp (ms) when the response was generated.' },
                    request: { type: 'string', example: '/api/endpoint', description: 'Request path that produced this response.' },
                },
            },
        }),
    );
}

/**
 * Factory that creates a named paginated-list DTO: `{ total, limit, offset, items }`.
 * The generated class is named `<ItemType>ListDto` so Scalar renders it as a named model.
 */
export function ApiItemsDto<T>(itemType: Type<T>) {
    class ApiItemsDtoClass {
        @ApiProperty({ type: 'integer', example: 100, description: 'Total number of matching records.' })
        total!: number;

        @ApiProperty({ type: 'integer', example: 10, description: 'Page size limit.', required: false })
        limit?: number;

        @ApiProperty({ type: 'integer', example: 0, description: 'Page offset.', required: false })
        offset?: number;

        @ApiProperty({ type: () => [itemType], description: 'List of items.' })
        items!: T[];
    }
    Object.defineProperty(ApiItemsDtoClass, 'name', { value: `${itemType.name}ListDto` });
    return ApiItemsDtoClass;
}

/** Documents a paginated list response wrapped in the standard envelope. */
export function ApiWrappedArrayResponse<T>(dataType: Type<T>, status = HttpStatus.OK) {
    const listDto = ApiItemsDto(dataType) as Type<any>;
    return applyDecorators(
        ApiExtraModels(dataType),
        ApiWrappedResponse(listDto, status),
    );
}

/** Documents a simple `{ success: boolean }` response wrapped in the envelope. */
export function ApiWrappedSuccessResponse(status = HttpStatus.OK) {
    return ApiWrappedResponse(ApiSuccessDto, status);
}

/**
 * Use for routes protected by `OptionalAuthUserGuard`.
 * Adds `ApiBearerAuth()` and marks the operation so the OpenAPI post-processor
 * inserts an empty `{}` security alternative (auth is not required).
 */
export function ApiOptionalBearerAuth() {
    return applyDecorators(
        ApiBearerAuth(),
        ApiExtension('x-auth-optional', true),
    );
}

/**
 * Use for routes protected by `OptionalServerGuard` / `OptionalServerAsUserGuard`.
 * Adds `ApiSecurity('nox-challenge')` and marks the operation as optional.
 */
export function ApiOptionalChallenge() {
    return applyDecorators(
        ApiSecurity('nox-challenge'),
        ApiExtension('x-auth-optional', true),
    );
}
