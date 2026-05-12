import {
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUrl,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { NoxLocalizedString, NoxWellKnown } from '../fediverse.types';

export class NoxGatewayDto {
    @ApiProperty({ description: 'HTTP/HTTPS base URL', example: 'https://example.com' })
    @IsString()
    @IsNotEmpty()
    web!: string;

    @ApiProperty({ description: 'WebSocket URL', example: 'wss://example.com/api/ws' })
    @IsString()
    @IsNotEmpty()
    ws!: string;

    @ApiProperty({ description: 'Public REST API base URL', example: 'https://example.com/api/' })
    @IsString()
    @IsNotEmpty()
    api!: string;
}

export class NoxSoftwareDto {
    @ApiProperty({ description: 'Software name', example: 'nox' })
    @IsString()
    @IsNotEmpty()
    name!: string;

    @ApiProperty({ description: 'Software version string', example: '1.0.0' })
    @IsString()
    @IsNotEmpty()
    version!: string;
}

export class NoxEndpointsDto {
    @ApiProperty({ description: 'URL of this well-known document', example: 'https://example.com/.well-known/nox' })
    @IsString()
    @IsNotEmpty()
    wellknown!: string;

    @ApiProperty({ description: 'WebFinger template URL with {uri} placeholder', example: 'https://example.com/.well-known/webfinger?resource={uri}' })
    @IsString()
    @IsNotEmpty()
    webfinger!: string;

    @ApiProperty({ description: 'NodeInfo links document URL', example: 'https://example.com/.well-known/nodeinfo' })
    @IsString()
    @IsNotEmpty()
    nodeinfo!: string;

    @ApiProperty({ description: 'URL of the server\'s Configuration', example: 'https://example.com/api/configs' })
    @IsString()
    @IsNotEmpty()
    configs!: string;

    [key: string]: string;
}

export class NoxVersionsDto {
    @ApiProperty({ description: 'Node.js runtime version', example: '20.0.0' })
    @IsString()
    @IsNotEmpty()
    node!: string;

    @ApiProperty({ description: 'Terms of service document version', example: '1.0' })
    @IsString()
    @IsNotEmpty()
    terms!: string;

    @ApiProperty({ description: 'Privacy policy document version', example: '1.0' })
    @IsString()
    @IsNotEmpty()
    privacy!: string;

    @ApiProperty({ description: 'Rules document version', example: '1.0' })
    @IsString()
    @IsNotEmpty()
    rules!: string;
}

export class NoxMetadataDto {    @ApiProperty({
        description: 'Instance display name. Either a plain string or a locale\u2192string map.',
        oneOf: [
            { type: 'string', example: 'My Nox Server' },
            { type: 'object', additionalProperties: { type: 'string' }, example: { en: 'My Nox Server', fr: 'Mon Serveur Nox' } },
        ],
    })
    @IsOptional()
    title!: NoxLocalizedString;

    @ApiPropertyOptional({
        description: 'Instance description, or null. Either a plain string or a locale\u2192string map.',
        nullable: true,
        oneOf: [
            { type: 'string', example: 'A social VR platform.' },
            { type: 'object', additionalProperties: { type: 'string' }, example: { en: 'A social VR platform.', fr: 'Une plateforme VR sociale.' } },
        ],
    })
    @IsOptional()
    description!: NoxLocalizedString | null;

    @ApiPropertyOptional({
        description: 'Instance icon. Either a single URL string, a theme-keyed map (e.g. { default: "url", dark: "url" }), or null.',
        nullable: true,
        oneOf: [
            { type: 'string', example: 'https://example.com/icon.png' },
            { type: 'object', additionalProperties: { type: 'string' }, example: { default: 'https://example.com/icon.png', dark: 'https://example.com/icon.dark.png' } },
        ],
    })
    @IsOptional()
    icon!: string | Record<string, string> | null;

    @ApiPropertyOptional({ type: 'string', description: 'Contact info (email or URL), or null', example: null, nullable: true })
    @IsOptional()
    @IsString()
    contact!: string | null;

    @ApiPropertyOptional({
        type: 'object',
        additionalProperties: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        description: 'Social links map. Keys are platform names (e.g. github, mastodon, discord, twitter, youtube); values are URL or array of URLs.',
        example: { github: 'https://github.com/org', mastodon: ['https://mastodon.social/@me'] },
    })
    @IsOptional()
    socials!: Record<string, string | string[]>;
}

/** Class-validator DTO for the /.well-known/nox response from external servers. */
export class NoxWellKnownDto implements NoxWellKnown {
    @ApiProperty({ description: 'Unique node identifier within a cluster', example: 'node-abc123' })
    @IsString()
    @IsNotEmpty()
    id!: string;

    @ApiProperty({ description: 'Software info', type: () => NoxSoftwareDto })
    @ValidateNested()
    @Type(() => NoxSoftwareDto)
    software!: NoxSoftwareDto;

    @ApiProperty({ description: 'Operational status', enum: ['online', 'maintenance', 'degraded'], example: 'online' })
    @IsIn(['online', 'maintenance', 'degraded'])
    status!: 'online' | 'maintenance' | 'degraded';

    @ApiProperty({ description: 'Unix timestamp (ms) when this node started', example: 1700000000000 })
    @IsInt()
    @Min(0)
    started!: number;

    @ApiProperty({ description: 'Ed25519 public key (base64 SPKI DER)', example: 'MCowBQYDK2VwAyEA…' })
    @IsString()
    @IsNotEmpty()
    public!: string;

    @ApiProperty({ description: 'Public domain address', example: 'example.com' })
    @IsString()
    @IsNotEmpty()
    address!: string;

    @ApiProperty({ description: 'Listening port', example: 443 })
    @IsInt()
    @Min(1)
    @Max(65535)
    port!: number;

    @ApiProperty({ description: 'Gateway URLs', type: () => NoxGatewayDto })
    @ValidateNested()
    @Type(() => NoxGatewayDto)
    gateway!: NoxGatewayDto;

    @ApiProperty({ description: 'Protocol endpoint URLs', type: () => NoxEndpointsDto })
    @ValidateNested()
    @Type(() => NoxEndpointsDto)
    endpoints!: NoxEndpointsDto;

    @ApiProperty({ description: 'Runtime versions', type: () => NoxVersionsDto })
    @ValidateNested()
    @Type(() => NoxVersionsDto)
    versions!: NoxVersionsDto;

    @ApiProperty({ description: 'Instance metadata', type: () => NoxMetadataDto })
    @ValidateNested()
    @Type(() => NoxMetadataDto)
    metadata!: NoxMetadataDto;

    @ApiProperty({ description: 'Supported feature flags', type: [String], example: [] })
    @IsArray()
    @IsString({ each: true })
    features!: string[];

    @ApiProperty({ description: 'Supported capability flags', type: [String], example: [] })
    @IsArray()
    @IsString({ each: true })
    capabilities!: string[];

    @ApiPropertyOptional({ type: 'string', description: 'Maintenance message displayed to users, or null', example: null, nullable: true })
    @IsOptional()
    @IsString()
    maintenance!: string | null;
}
