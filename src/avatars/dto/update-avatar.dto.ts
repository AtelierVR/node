import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAvatarDto {
    @ApiPropertyOptional({ type: 'string', description: 'Short unique name [a-z0-9-_.]{3,8}, or null to clear', example: 'my-avatar', nullable: true })
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9\-_.]{3,8}$/, { message: 'name must be 3-8 characters: lowercase letters, digits, hyphens, underscores, or dots' })
    name?: string | null;

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

    @ApiPropertyOptional({ type: [String], description: 'NoxIdentifier list of contributors', example: [] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];
}

