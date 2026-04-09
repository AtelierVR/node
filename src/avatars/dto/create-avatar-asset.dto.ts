import { IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAvatarAssetDto {
    @ApiProperty({ example: 1, description: 'Asset version number (semver integer)' })
    @IsInt()
    @Min(0)
    @Type(() => Number)
    version!: number;

    @ApiProperty({ example: 'unity', description: 'Game engine identifier (e.g. unity, godot)' })
    @IsString()
    @IsNotEmpty()
    engine!: string;

    @ApiProperty({ example: 'windows', description: 'Target platform (e.g. windows, android, linux)' })
    @IsString()
    @IsNotEmpty()
    platform!: string;

    @ApiPropertyOptional({ example: 'https://example.com/avatar.zip', description: 'External URL — mutually exclusive with file upload' })
    @IsOptional()
    @IsUrl()
    url?: string;
}

