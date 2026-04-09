import { IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { ApiResponse, ApiError } from '../api.types';

export class ApiErrorDto implements ApiError {
    @IsString()
    @IsNotEmpty()
    code!: string;

    @IsString()
    message!: string;

    @IsInt()
    status!: number;
}

/**
 * Validates the envelope fields of an external API response.
 * `data` is not validated here (its type varies per endpoint).
 */
export class ApiResponseEnvelopeDto implements Pick<ApiResponse<unknown>, 'time' | 'request'> {
    data!: unknown;

    @IsOptional()
    @ValidateNested()
    @Type(() => ApiErrorDto)
    error?: ApiErrorDto;

    @IsInt()
    time!: number;

    @IsString()
    @IsNotEmpty()
    request!: string;
}
