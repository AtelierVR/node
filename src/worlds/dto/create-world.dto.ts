import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNoxIdentifier, IsNoxName } from '../../common/validation';

export class CreateWorldDto {
    @ApiPropertyOptional({ description: 'Custom numeric world ID. If omitted, one is auto-assigned.', example: 42 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    id?: number;

    @ApiPropertyOptional({ description: 'Short unique name (snake_case, 3-8 chars). Left null if omitted.', example: 'my_world' })
    @IsOptional()
    @IsNoxName()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ description: 'World display name (defaults to "<display>\'s World" if omitted)', example: 'My World' })
    @MaxLength(64)
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', description: 'World description, or null', example: 'A beautiful virtual space', nullable: true })
    @MaxLength(4096)
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
    @ArrayMaxSize(50)
    @IsNoxIdentifier({ each: true })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];
}

