import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiAliasDto } from '../../api/dto/shared.dto';

export class ApiAvatarDto {
    @ApiProperty({ description: 'Internal numeric avatar ID', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Avatar display name', example: 'My Cool Avatar' })
    title!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Avatar description, or null', example: 'A great avatar', nullable: true })
    description!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'URL to avatar thumbnail, or null', example: 'https://cdn.my-server.com/thumb.png', nullable: true })
    thumbnail!: string | null;

    @ApiProperty({ description: 'Avatar tags', type: [String], example: [] })
    tags!: string[];

    @ApiProperty({ description: 'Recommended asset version to download. -1 = none available.', example: 1 })
    release!: number;

    @ApiProperty({ description: 'Server hostname this avatar belongs to', example: 'my-server.com' })
    server!: string;

    @ApiProperty({ description: 'Owner NoxIdentifier', example: '1@my-server.com' })
    owner!: string;

    @ApiProperty({ description: 'Aliases (NoxIdentifier extras)', type: () => [ApiAliasDto] })
    alias!: ApiAliasDto[];
}

export class ApiAvatarAssetDto {
    @ApiProperty({ description: 'Internal numeric asset ID', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Asset version number (semver integer)', example: 1 })
    version!: number;

    @ApiProperty({ description: 'Game engine identifier (e.g. unity, godot)', example: 'unity' })
    engine!: string;

    @ApiProperty({ description: 'Target platform (e.g. windows, android, linux)', example: 'windows' })
    platform!: string;

    @ApiProperty({ description: 'Whether no file has been uploaded for this slot yet', example: false })
    is_empty!: boolean;

    @ApiPropertyOptional({ type: 'string', description: 'External or CDN URL of the asset file, or null', example: null, nullable: true })
    url!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'SHA-256 hash of the file, or null', example: null, nullable: true })
    hash!: string | null;

    @ApiPropertyOptional({ type: 'number', description: 'File size in bytes, or null', example: null, nullable: true })
    size!: number | null;

    @ApiProperty({ description: 'Supported feature flags', type: [String], example: [] })
    features!: string[];
}
