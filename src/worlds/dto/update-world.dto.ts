import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsHttpUrl, IsNoxIdentifier, IsNoxName, IsNoxTag } from '../../common/validation';
import { Tags } from '../../common/tags';

export class UpdateWorldDto {
    @ApiPropertyOptional({ type: 'string', description: 'Short unique name (snake_case, 3-8 chars), or null to clear', example: 'my_world', nullable: true })
    @IsOptional()
    @IsNoxName()
    @IsString()
    name?: string | null;

    @ApiPropertyOptional({ description: 'New world display name', example: 'My Updated World' })
    @MaxLength(64)
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
    @IsHttpUrl()
    @IsOptional()
    @IsString()
    thumbnail?: string | null;

    @ApiPropertyOptional({ type: [String], description: 'NoxIdentifier list of contributors', example: [] })
    @ArrayMaxSize(50)
    @IsNoxIdentifier({ each: true })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];

    @ApiPropertyOptional({ type: 'number', example: 2, nullable: true, description: 'Set recommended release version (ushort, 0–65535). null = auto (latest).' })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    release?: number | null;

    @ApiPropertyOptional({ type: [String], description: 'User-defined tags (only usr:* tags are accepted)', example: ['usr:pvp'] })
    @ArrayMaxSize(20)
    @IsNoxTag({ each: true, namespaces: [Tags.USER] })
    @IsOptional()
    @IsArray()
    tags?: string[];
}

