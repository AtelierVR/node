import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
    @ApiProperty({ description: 'Client session identifier', example: 'cli-abc123' })
    id!: string;

    @ApiProperty({ description: 'Client IP address', example: '192.168.1.1' })
    address!: string;

    @ApiProperty({ description: 'Client platform', example: 'windows' })
    platform!: string;

    @ApiProperty({ description: 'Client engine', example: 'unity' })
    engine!: string;

    @ApiPropertyOptional({ type: 'string', description: 'NoxIdentifier of the authenticated user, or null if anonymous', example: null, nullable: true })
    user!: string | null;
}

export class RelayPlayerApiDto {
    @ApiProperty({ description: 'Player session identifier', example: 'ply-abc123' })
    id!: string;

    @ApiProperty({ description: 'Client session identifier for this player', example: 'cli-abc123' })
    client_id!: string;

    @ApiProperty({ description: 'Player display name', example: 'John Doe' })
    display!: string;

    @ApiProperty({ description: 'Bitmask of player flags', example: 0 })
    flags!: number;

    @ApiPropertyOptional({ type: 'string', description: 'NoxIdentifier of the linked user account, or null', example: null, nullable: true })
    user!: string | null;
}

// ── Relay HTTP response DTOs ──────────────────────────────────────────────────

export class ApiRelaySpecsDto {
    @ApiPropertyOptional({ type: 'number', description: 'CPU usage percentage, or null', example: 0.12, nullable: true })
    cpu!: number | null;

    @ApiPropertyOptional({ type: 'number', description: 'Memory usage in MB, or null', example: 256, nullable: true })
    mem!: number | null;

    @ApiPropertyOptional({ type: 'number', description: 'System uptime in seconds, or null', example: 3600, nullable: true })
    uptime!: number | null;

    @ApiPropertyOptional({ type: 'number', description: 'Disk usage in MB, or null', example: 1024, nullable: true })
    disk!: number | null;
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
    response_ms!: number | null;

    @ApiPropertyOptional({ type: () => ApiRelaySpecsDto, description: 'Host machine specs, or null', nullable: true })
    specs!: ApiRelaySpecsDto | null;
}

export class ApiRelayDto {
    @ApiProperty({ description: 'Internal numeric relay ID', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Whether the relay process is currently connected', example: true })
    connected!: boolean;

    @ApiProperty({ description: 'ISO 8601 registration timestamp', example: '2024-01-01T00:00:00.000Z' })
    created_at!: string;

    @ApiPropertyOptional({ type: () => ApiRelayStatusDto, description: 'Live status data, or null when disconnected', nullable: true })
    status!: ApiRelayStatusDto | null;
}
