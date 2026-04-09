import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** relay → node: request_instances */
export class RequestInstancesMessageDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(10)
    @Type(() => Number)
    count?: number;
}

/** relay → node: resolve_user */
export class ResolveUserMessageDto {
    @IsInt()
    @Type(() => Number)
    user_id!: number;
}

/** Single item in relay_sync_instances payload */
export class SyncInstanceItemDto {
    @IsInt()
    @Type(() => Number)
    node_id!: number;
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

/** relay → node: client_connected / client_disconnected */
export class RelayClientEventDto {
    @IsString()
    id!: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    user?: string;
}

/** relay → node: player_join */
export class RelayPlayerJoinDto {
    @IsString()
    client_id!: string;

    @IsString()
    player_id!: string;

    @IsString()
    instance_id!: string;

    @IsString()
    display!: string;

    @IsOptional()
    @IsString()
    user?: string;
}

/** relay → node: player_leave */
export class RelayPlayerLeaveDto {
    @IsString()
    client_id!: string;

    @IsString()
    player_id!: string;

    @IsString()
    instance_id!: string;

    @IsOptional()
    @IsString()
    user?: string;
}
