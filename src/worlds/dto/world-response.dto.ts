import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiAliasDto } from '../../api/dto/shared.dto';

export class ApiWorldDto {
    @ApiProperty({ description: 'Internal numeric world ID', example: 1 })
    id!: number;

    @ApiPropertyOptional({ type: 'string', description: 'Short unique name [a-z0-9-_.]{3,8}, or null if not set', example: 'myworld', nullable: true })
    name!: string | null;

    @ApiProperty({ description: 'World display name', example: 'My World' })
    title!: string;

    @ApiPropertyOptional({ type: 'string', description: 'World description, or null', example: 'A beautiful virtual space', nullable: true })
    description!: string | null;

    @ApiPropertyOptional({ type: 'string', description: 'URL to world thumbnail, or null', example: null, nullable: true })
    thumbnail!: string | null;

    @ApiProperty({ description: 'World tags', type: [String], example: [] })
    tags!: string[];

    @ApiProperty({ description: 'Maximum concurrent players', example: 32 })
    capacity!: number;

    @ApiProperty({ description: 'Recommended asset version to download. -1 = none available.', example: 1 })
    release!: number;

    @ApiProperty({ description: 'Server hostname this world belongs to', example: 'my-server.com' })
    server!: string;

    @ApiProperty({ description: 'Owner NoxIdentifier', example: '1@my-server.com' })
    owner!: string;

    @ApiProperty({ description: 'NoxIdentifiers of contributors', type: [String], example: [] })
    contributors!: string[];

    @ApiProperty({ description: 'Aliases (NoxIdentifier extras)', type: () => [ApiAliasDto] })
    alias!: ApiAliasDto[];
}

export class ApiWorldAssetDto {
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

    @ApiProperty({ description: 'Applied mod identifiers', type: [String], example: [] })
    mods!: string[];

    @ApiProperty({ description: 'Supported feature flags', type: [String], example: [] })
    features!: string[];

    @ApiPropertyOptional({ type: 'string', description: 'NoxIdentifier of the user who uploaded this asset, or null', example: null, nullable: true })
    uploader!: string | null;
}
