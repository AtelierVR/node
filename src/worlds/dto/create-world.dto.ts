import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorldDto {
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

