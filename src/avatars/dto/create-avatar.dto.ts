import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNoxIdentifier, IsNoxName } from '../../common/validation';

export class CreateAvatarDto {
    @ApiPropertyOptional({ description: 'Custom numeric avatar ID. If omitted, one is auto-assigned.', example: 42 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    id?: number;

    @ApiPropertyOptional({ description: 'Short unique name (snake_case, 3-8 chars). Left null if omitted.', example: 'my_avatar' })
    @IsOptional()
    @IsNoxName()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ description: 'Avatar display name', example: 'My Cool Avatar' })
    @MaxLength(64)
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    title?: string;

    @ApiPropertyOptional({ type: 'string', example: 'A detailed avatar description', nullable: true })
    @MaxLength(4096)
    @IsOptional()
    @IsString()
    description?: string | null;

    @ApiPropertyOptional({ type: [String], example: [], description: 'NoxIdentifier list of contributors' })
    @ArrayMaxSize(50)
    @IsNoxIdentifier({ each: true })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    contributors?: string[];
}

