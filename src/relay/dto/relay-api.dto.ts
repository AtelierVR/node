import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiRelay } from '../relay.types';

export class RelayLogEntryApiDto {
    @ApiProperty({ description: 'Unix timestamp in milliseconds', example: 1680000000000 })
    timestamp!: number;

    @ApiProperty({ description: 'Log level', example: 'info' })
    level!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Log tag (module name)', example: null, nullable: true })
    tag!: string | null;

    @ApiProperty({ description: 'Log message', example: 'Relay started' })
    message!: string;
}

export class RelayLogListApiDto {
    @ApiProperty({ type: () => [RelayLogEntryApiDto], description: 'Log entries' })
    items!: RelayLogEntryApiDto[];
}

export class RelayInstanceApiDto {
    @ApiProperty({ description: 'Relay-scoped instance identifier', example: 'inst-abc123' })
    id!: string;

    @ApiProperty({ description: 'Internal numeric instance ID', example: 1 })
    internal_id!: number;

    @ApiProperty({ description: 'Number of players currently in the instance', example: 3 })
    player_count!: number;

    @ApiProperty({ description: 'Bitmask of instance flags', example: 0 })
    flags!: number;

    @ApiProperty({ description: 'NoxIdentifier of the world running in this instance', example: '1@my-server.com' })
    world!: string;

    @ApiProperty({ description: 'Maximum player capacity', example: 16 })
    capacity!: number;
}

export class RelayClientApiDto {
    @ApiProperty({ description: 'Client session identifier', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Client IP address', example: '192.168.1.1' })
    address!: string;

    @ApiProperty({ description: 'Client platform', example: 'windows' })
    platform!: string;

    @ApiProperty({ description: 'Client engine', example: 'unity' })
    engine!: string;

    @ApiPropertyOptional({ type: 'string', description: 'NoxIdentifier of the authenticated user, or null if anonymous', example: null, nullable: true })
    user!: string | null;

    @ApiProperty({ description: 'Unix millisecond timestamp when the client connected', example: 1746057600000 })
    connected_at!: number;
}

export class RelayPlayerApiDto {
    @ApiProperty({ description: 'Player session identifier', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Client session identifier for this player', example: 1 })
    client_id!: number;

    @ApiProperty({ description: 'Player display name', example: 'John Doe' })
    display!: string;

    @ApiProperty({ description: 'Bitmask of player flags', example: 0 })
    flags!: number;

    @ApiProperty({ description: 'Unix millisecond timestamp when the player joined', example: 1746057600000 })
    joined_at!: number;
}

// ── Runner info ───────────────────────────────────────────────────────────────

export class ApiRunnerInfoDto {
    @ApiPropertyOptional({ type: 'string', description: 'Short provider-specific ID (e.g. Docker container short ID), or null', example: 'a1b2c3d4e5f6', nullable: true })
    provider_id!: string | null;

    @ApiProperty({ description: 'Lifecycle status', example: 'running', enum: ['running', 'stopped', 'dead', 'unknown'] })
    status!: string;

    @ApiPropertyOptional({ type: 'number', description: 'ISO 8601 start time, or null', example: 1704067200000, nullable: true })
    started_at!: number | null;

    @ApiProperty({ description: 'Provider-specific metadata (image, name, …)', type: 'object', additionalProperties: { type: 'string' }, example: { image: 'nox-relay:latest', name: 'relay_1_a1b2' } })
    meta!: Record<string, string>;
}

// ── Relay HTTP response DTOs ──────────────────────────────────────────────────

export class ApiRelaySpecsProcessorDto {
    @ApiProperty({ description: 'CPU usage as a percentage (0-1)', example: 0.12 })
    used!: number;

    @ApiProperty({ description: 'Number of CPU cores', example: 4 })
    cores!: number;
}

export class ApiRelaySpecsMemoryDto {
    @ApiProperty({ description: 'Memory usage in megabytes', example: 256 })
    used!: number;

    @ApiProperty({ description: 'Total memory in megabytes', example: 4096 })
    total!: number;
}

export class ApiRelaySpecsUploadDto {
    @ApiProperty({ description: 'Upload speed in megabytes per second', example: 10 })
    used!: number;

    @ApiProperty({ description: 'Total upload bandwidth in megabytes per second', example: 100 })
    bandwidth!: number;

    @ApiProperty({ description: 'Upload packets per second', example: 1000 })
    packets!: number;
}

export class ApiRelaySpecsDownloadDto {
    @ApiProperty({ description: 'Download speed in megabytes per second', example: 20 })
    used!: number;

    @ApiProperty({ description: 'Total download bandwidth in megabytes per second', example: 100 })
    bandwidth!: number;

    @ApiProperty({ description: 'Download packets per second', example: 1200 })
    packets!: number;
}

export class ApiRelaySpecsDto {
    @ApiPropertyOptional({ type: () => ApiRelaySpecsProcessorDto, description: 'CPU usage percentage, or null', example: 0.12, nullable: true })
    processor!: ApiRelaySpecsProcessorDto;

    @ApiPropertyOptional({ type: () => ApiRelaySpecsMemoryDto, description: 'Memory usage in MB, or null', example: 256, nullable: true })
    memory!: ApiRelaySpecsMemoryDto;

    @ApiPropertyOptional({ type: () => ApiRelaySpecsUploadDto, description: 'Upload speed in MB/s, or null', example: 10, nullable: true })
    upload!: ApiRelaySpecsUploadDto;

    @ApiPropertyOptional({ type: () => ApiRelaySpecsDownloadDto, description: 'Download speed in MB/s, or null', example: 20, nullable: true })
    download!: ApiRelaySpecsDownloadDto;
}


export class ApiRelayStatusDto {
    @ApiProperty({ description: 'Number of active instances', example: 2 })
    instances!: number;

    @ApiProperty({ description: 'Maximum number of instances', example: 32 })
    max_instances!: number;

    @ApiProperty({ description: 'Number of connected clients', example: 10 })
    clients!: number;

    @ApiProperty({ description: 'Relay game engine', example: 'unity' })
    engine!: string;

    @ApiProperty({ description: 'Relay software version', example: '1.0.0' })
    version!: string;

    @ApiProperty({ description: 'Protocol version number', example: 1 })
    protocol!: number;

    @ApiProperty({ description: 'Relay process uptime in seconds', example: 3600 })
    uptime!: number;

    @ApiPropertyOptional({ type: 'number', description: 'Last ping response time in milliseconds, or null', example: 42, nullable: true })
    ping!: number | null;

    @ApiPropertyOptional({ type: () => ApiRelaySpecsDto, description: 'Host machine specs, or null', nullable: true })
    specs!: ApiRelaySpecsDto | null;
}

export class RelayAssignedInstanceDto {
    @ApiProperty({ description: 'Internal numeric instance ID (database)', example: 1 })
    id!: number;

    @ApiPropertyOptional({ description: 'Relay-internal slot (0–254), null when relay is offline', example: 0, nullable: true })
    internal_id!: number | null;

    @ApiProperty({ description: 'Slug name of the instance', example: 'my-room' })
    name!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Display title, or null', example: 'Chill Hangout', nullable: true })
    title!: string | null;

    @ApiProperty({ description: 'NoxIdentifier of the world', example: '1@my-server.com' })
    world!: string;

    @ApiProperty({ description: 'NoxIdentifier of the owner', example: '1@my-server.com' })
    owner!: string;

    @ApiProperty({ description: 'Maximum player count', example: 16 })
    capacity!: number;

    @ApiProperty({ description: 'Creation timestamp in milliseconds since epoch', example: 1704067200000 })
    created_at!: number;
}

export class ApiRelayInstancesSummaryDto {
    @ApiProperty({ description: 'Number of active instances', example: 2 })
    count!: number;

    @ApiProperty({ description: 'Maximum number of instances', example: 32 })
    maximum!: number;
}

export class ApiRelayDto {
    @ApiProperty({ description: 'Internal numeric relay ID', example: 1 })
    id!: number;

    @ApiPropertyOptional({ type: 'string', description: 'Human-readable label, or null', example: 'EU-West #1', nullable: true })
    label!: string | null;

    @ApiProperty({ description: 'Runner provider type', example: 'docker', enum: ['docker', 'external', 'kubernetes', 'proxmox'] })
    provider!: string;

    @ApiPropertyOptional({ type: 'string', description: 'Provider-specific resource ID (e.g. container ID), or null', example: 'a1b2c3d4e5f6', nullable: true })
    provider_id!: string | null;

    @ApiProperty({ description: 'Maximum number of instances this relay can host', example: 3 })
    max_link!: number;

    @ApiProperty({ description: 'Relay tags used for instance assignment rules', type: [String], example: ['eu', 'fast'] })
    tags!: string[];

    @ApiProperty({ description: 'Whether the relay process is currently connected', example: true })
    connected!: boolean;

    @ApiPropertyOptional({ type: () => ApiRunnerInfoDto, description: 'Runner-level status (container/VM state), or null', nullable: true })
    runner!: ApiRunnerInfoDto | null;

    @ApiProperty({ description: 'ISO 8601 registration timestamp', example: '2024-01-01T00:00:00.000Z' })
    created_at!: string;

    @ApiPropertyOptional({ type: () => ApiRelayStatusDto, description: 'Live status data, or null when disconnected', nullable: true })
    status!: ApiRelayStatusDto | null;
}
