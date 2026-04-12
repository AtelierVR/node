import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAvatarDto {
    @ApiPropertyOptional({ description: 'Custom numeric avatar ID. If omitted, one is auto-assigned.', example: 42 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    id?: number;

    @ApiPropertyOptional({ description: 'Short unique name [a-z0-9-_.]{3,8}. Left null if omitted.', example: 'myavatar' })
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9\-_.]{3,8}$/, { message: 'name must be 3-8 characters: lowercase letters, digits, hyphens, underscores, or dots' })
    name?: string;

    @ApiPropertyOptional({ description: 'Avatar display name', example: 'My Cool Avatar' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', example: 'A detailed avatar description', nullable: true })
    @IsOptional()
    @IsString()
    description?: string | null;

    @ApiPropertyOptional({ type: [String], example: [], description: 'NoxIdentifier list of contributors' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];
}

