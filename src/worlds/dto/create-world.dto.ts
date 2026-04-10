import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorldDto {
    @ApiPropertyOptional({ description: 'Short unique name [a-z0-9-_.]{3,8}. Left null if omitted.', example: 'myworld' })
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9\-_.]{3,8}$/, { message: 'name must be 3-8 characters: lowercase letters, digits, hyphens, underscores, or dots' })
    name?: string;

    @ApiPropertyOptional({ description: 'World display name (defaults to "<display>\'s World" if omitted)', example: 'My World' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', description: 'World description, or null', example: 'A beautiful virtual space', nullable: true })
    @IsOptional()
    @IsString()
    description?: string | null;

    @ApiPropertyOptional({ example: 32, description: 'Maximum concurrent players (0–65535), defaults to 32 if omitted' })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity?: number;

    @ApiPropertyOptional({ type: [String], example: [], description: 'NoxIdentifier list of contributors' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];
}

