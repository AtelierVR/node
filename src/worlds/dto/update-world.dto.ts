import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWorldDto {
    @ApiPropertyOptional({ type: 'string', description: 'Short unique name [a-z0-9-_.]{3,8}, or null to clear', example: 'myworld2', nullable: true })
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9\-_.]{3,8}$/, { message: 'name must be 3-8 characters: lowercase letters, digits, hyphens, underscores, or dots' })
    name?: string | null;

    @ApiPropertyOptional({ description: 'New world display name', example: 'My Updated World' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', description: 'Updated description, or null to clear', example: 'Updated description', nullable: true })
    @MaxLength(4096)
    @IsOptional()
    @IsString()
    description?: string | null;

    @ApiPropertyOptional({ description: 'Maximum concurrent players (0–65535)', example: 64 })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity?: number;

    @ApiPropertyOptional({ type: 'string', description: 'Thumbnail URL, or null to clear', example: null, nullable: true })
    @Matches(/^https?:\/\/[a-zA-Z0-9_.-]+(:[0-9]{1,5})?(\/.*)?$/, { message: 'Invalid URL' })
    @IsOptional()
    @IsString()
    thumbnail?: string | null;

    @ApiPropertyOptional({ type: [String], description: 'NoxIdentifier list of contributors', example: [] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];

    @ApiPropertyOptional({ type: 'number', example: 2, nullable: true, description: 'Set recommended release version. null = auto (latest).' })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Type(() => Number)
    release?: number | null;

    @ApiPropertyOptional({ type: [String], description: 'User-defined tags (only usr:* tags are accepted)', example: ['usr:pvp'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];
}

