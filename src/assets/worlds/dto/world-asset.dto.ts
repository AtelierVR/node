import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
    CreateUploadAssetDto,
    UpdateUploadAssetDto,
} from '@/assets/upload/dto/upload.dto';

/**
 * Body of `PUT /api/worlds` — register a new world asset.
 *
 * Extends the generic upload-asset body with the world-specific `capacity`
 * option (stored in the asset `metadata`, no dedicated column required).
 */
export class CreateWorldAssetDto extends CreateUploadAssetDto {
    @ApiPropertyOptional({
        example: 32,
        description:
            'Maximum number of concurrent players (0–65535). Defaults to 32 when omitted.',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity?: number;
}

/**
 * Body of `PATCH /api/worlds/:id` — update a world asset.
 *
 * Extends the generic upload-asset body with the world-specific `capacity`
 * option. Omit it to leave the capacity untouched.
 */
export class UpdateWorldAssetDto extends UpdateUploadAssetDto {
    @ApiPropertyOptional({
        example: 64,
        description: 'Maximum number of concurrent players (0–65535).',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity?: number;
}
