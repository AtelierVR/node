import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
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
    @Type(() => Number)
    user_id!: number;

    @IsString()
    server!: string;

    @IsString()
    fingerprint!: string;
}

/** Single item in relay_sync_instances payload */
export class SyncInstanceItemDto {
    @IsInt()
    @Type(() => Number)
    master_id!: number;

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    internal_id?: number;

    @IsOptional()
    @IsString()
    password?: string;

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    capacity?: number;

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    player_count?: number;

    @IsOptional()
    @IsString()
    world?: string;

    @IsOptional()
    @IsString()
    flags?: string;

    // Alias for backward compatibility
    get node_id(): number {
        return this.master_id;
    }
}

/** relay → node: relay_sync_instances */
export class SyncInstancesMessageDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncInstanceItemDto)
    instances!: SyncInstanceItemDto[];
}

/** relay → node: log */
export class RelayLogMessageDto {
    /** Unix timestamp */
    @IsInt()
    a!: number;

    /** Level string (e.g. "info", "warn", "error") */
    @IsString()
    l!: string;

    /** Message */
    @IsString()
    m!: string;

    /** Optional tag */
    @IsOptional()
    @IsString()
    t?: string;
}

/** relay → node: client_connected */
export class RelayClientEventDto {
    @IsInt()
    id!: number;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    platform?: string;

    @IsOptional()
    @IsString()
    engine?: string;

    @IsOptional()
    @IsString()
    user?: string;

    @IsOptional()
    @IsInt()
    connected_at?: number;
}

/** relay → node: client_authentified */
export class RelayClientAuthentifiedDto {
    @IsInt()
    id!: number;

    @IsString()
    user!: string;
}

/** relay → node: client_disconnected */
export class RelayClientDisconnectedDto {
    @IsInt()
    id!: number;

    @IsString()
    reason!: string;

    @IsString()
    type!: string;
}

/** relay → node: player_join */
export class RelayPlayerJoinDto {
    @IsInt()
    client_id!: number;

    @IsInt()
    player_id!: number;

    @IsString()
    display!: string;

    @IsInt()
    internal_id!: number;

    @IsInt()
    flags!: number;

    @IsInt()
    joined_at!: number;
}

/** relay → node: player_leave */
export class RelayPlayerLeaveDto {
    @IsInt()
    player_id!: number;

    @IsInt()
    internal_id!: number;

    @IsString()
    type!: string;

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
