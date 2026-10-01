import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsHttpUrl } from '../../common/validation';

export class CreateAvatarAssetDto {
    @ApiProperty({ example: 1, description: 'Asset version number (semver integer)' })
    @IsInt()
    @Min(0)
    @Type(() => Number)
    version!: number;

    @ApiProperty({ example: 'unity', description: 'Game engine identifier (e.g. unity, godot)' })
    @MaxLength(32)
    @Matches(/^[a-z0-9_-]+$/i, { message: 'engine must be alphanumeric' })
    @IsString()
    @IsNotEmpty()
    engine!: string;

    @ApiProperty({ example: 'windows', description: 'Target platform (e.g. windows, android, linux)' })
    @MaxLength(32)
    @Matches(/^[a-z0-9_-]+$/i, { message: 'platform must be alphanumeric' })
    @IsString()
    @IsNotEmpty()
    platform!: string;

    @ApiPropertyOptional({ example: 'https://example.com/avatar.zip', description: 'External URL — mutually exclusive with file upload' })
    @IsOptional()
    @IsHttpUrl()
    url?: string;
}

