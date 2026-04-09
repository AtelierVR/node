import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAvatarDto {
    @ApiPropertyOptional({ description: 'New avatar display name', example: 'My Cool Avatar' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Updated description, or null to clear', example: 'Updated description', nullable: true })
    @IsOptional()
    @IsString()
    description?: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null to clear', example: null, nullable: true })
    @IsOptional()
    @IsString()
    thumbnail?: string | null;

    @ApiPropertyOptional({ type: 'number', example: 2, nullable: true, description: 'Set recommended release version. null = auto (latest).' })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Type(() => Number)
    release?: number | null;
}

