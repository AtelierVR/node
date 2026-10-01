import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Expose, Type } from 'class-transformer';

/** relay → node: request_instances */
export class RequestInstancesMessageDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(256)
    @Type(() => Number)
    count?: number;
}

/** relay → node: resolve_user */
export class ResolveUserMessageDto {
    @IsInt()
    @Min(1)
    @Max(2147483647)
    @Type(() => Number)
    user_id!: number;

    @MaxLength(255)
    @IsString()
    server!: string;

    @MaxLength(512)
    @IsString()
    fingerprint!: string;
}

/** Single item in relay_sync_instances payload */
export class SyncInstanceItemDto {
    @IsInt()
    @Min(1)
    @Max(2147483647)
    @Type(() => Number)
    master_id!: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(2147483647)
    @Type(() => Number)
    internal_id?: number;

    @IsOptional()
    @MaxLength(128)
    @IsString()
    password?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(65535)
    @Type(() => Number)
    capacity?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(2147483647)
    @Type(() => Number)
    player_count?: number;

    @IsOptional()
    @MaxLength(256)
    @IsString()
    world?: string;

    @IsOptional()
    @MaxLength(64)
    @IsString()
    flags?: string;

    // Alias for backward compatibility
    get node_id(): number {
        return this.master_id;
    }
}

/** relay → node: relay_sync_instances */
export class SyncInstancesMessageDto {
    @ArrayMaxSize(1000)
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncInstanceItemDto)
    instances!: SyncInstanceItemDto[];
}

/** relay → node: log */
export class RelayLogMessageDto {
    /** Unix timestamp */
    @IsInt()
    @Min(0)
    a!: number;

    /** Level string (e.g. "info", "warn", "error") */
    @MaxLength(16)
    @IsString()
    l!: string;

    /** Message */
    @MaxLength(8192)
    @IsString()
    m!: string;

    /** Optional tag */
    @IsOptional()
    @MaxLength(64)
    @IsString()
    t?: string;
}

/** relay → node: client_connected */
export class RelayClientEventDto {
    @IsInt()
    @Min(0)
    id!: number;

    @IsOptional()
    @MaxLength(64)
    @IsString()
    address?: string;

    @IsOptional()
    @MaxLength(32)
    @IsString()
    platform?: string;

    @IsOptional()
    @MaxLength(32)
    @IsString()
    engine?: string;

    @IsOptional()
    @MaxLength(256)
    @IsString()
    user?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    connected_at?: number;
}

/** relay → node: client_authentified */
export class RelayClientAuthentifiedDto {
    @IsInt()
    @Min(0)
    id!: number;

    @MaxLength(256)
    @IsString()
    user!: string;
}

/** relay → node: client_disconnected */
export class RelayClientDisconnectedDto {
    @IsInt()
    @Min(0)
    id!: number;

    @MaxLength(256)
    @IsString()
    reason!: string;

    @MaxLength(64)
    @IsString()
    type!: string;
}

/** relay → node: player_join */
export class RelayPlayerJoinDto {
    @IsInt()
    @Min(0)
    client_id!: number;

    @IsInt()
    @Min(0)
    player_id!: number;

    @MaxLength(128)
    @IsString()
    display!: string;

    @IsInt()
    @Min(0)
    internal_id!: number;

    @IsInt()
    flags!: number;

    @IsInt()
    @Min(0)
    joined_at!: number;
}

/** relay → node: player_leave */
export class RelayPlayerLeaveDto {
    @IsInt()
    @Min(0)
    player_id!: number;

    @IsInt()
    @Min(0)
    internal_id!: number;

    @MaxLength(64)
    @IsString()
    type!: string;

    @MaxLength(256)
    @IsString()
    reason!: string;
}

/** relay → node: instance_settings_changed */
export class RelayInstanceSettingsChangedDto {
    @Expose({ name: 'i' })
    @IsInt()
    internal_id!: number;

    @Expose({ name: 't' })
    @IsInt()
    tps!: number;

    @Expose({ name: 'th' })
    @IsNumber()
    threshold!: number;
}

// ── relay → node: specs (telemetry) ──────────────────────────────────────────

export class RelaySpecCpuDto {
    @IsNumber() @Min(0) @Max(1e9) u!: number;
    @IsNumber() @Min(0) @Max(1e6) c!: number;
}

export class RelaySpecMemoryDto {
    @IsNumber() @Min(0) @Max(1e15) u!: number;
    @IsNumber() @Min(0) @Max(1e15) t!: number;
}

export class RelaySpecNetDto {
    @IsNumber() @Min(0) @Max(1e15) u!: number;
    @IsNumber() @Min(0) @Max(1e15) b!: number;
    @IsOptional() @IsNumber() @Min(0) @Max(1e15) p?: number;
}

/** relay → node: specs */
export class RelaySpecsMessageDto {
    @IsOptional() @ValidateNested() @Type(() => RelaySpecCpuDto) c?: RelaySpecCpuDto;
    @IsOptional() @ValidateNested() @Type(() => RelaySpecMemoryDto) m?: RelaySpecMemoryDto;
    @IsOptional() @ValidateNested() @Type(() => RelaySpecNetDto) u?: RelaySpecNetDto;
    @IsOptional() @ValidateNested() @Type(() => RelaySpecNetDto) d?: RelaySpecNetDto;
    @IsOptional() @IsNumber() @Min(0) @Max(65535) mtu?: number;
}
