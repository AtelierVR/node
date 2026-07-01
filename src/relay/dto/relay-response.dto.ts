import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// ── Normalized outputs (what the node exposes after mapping) ──────────────────

export interface NormalizedWorldInfo {
    master_id: number;
    server: string;
    version: number;
}

export interface NormalizedLogEntry {
    timestamp: number;
    level: string;
    message: string;
    tag: string | null;
}

export interface NormalizedRelayInstance {
    id: string;       // relay-local slot (from i)
    node_id: number;  // DB/federation id (from n)
    player_count: number;
    flags: number;
    world: NormalizedWorldInfo | string;  // string for backwards compat with old relay
    capacity: number;
    tps: number;                  // configured TPS
    threshold: number;            // configured threshold
    effective_tps: number;        // effective TPS (load balancing)
    effective_threshold: number;  // effective threshold (load balancing)
}

export interface NormalizedRelayClient {
    id: number;
    address: string;
    platform: string;
    engine: string;
    user: string | null;
    connected_at: number;
}

export interface NormalizedRelayPlayer {
    id: number;
    client_id: number;
    display: string;
    flags: number;
    joined_at: number;
    user: string | null;
    custom_tps: number;
    custom_threshold: number;
}

// ── Raw relay response DTOs (abbreviated or full keys from relay binary) ──────

/** One entry from the relay `logs` response. Relay uses abbreviated keys. */
export class RelayLogEntryDto {
    @IsOptional() @IsInt()       a?: number;         // timestamp (abbrev)
    @IsOptional() @IsInt()       timestamp?: number;
    @IsOptional() @IsString()    l?: string;         // level (abbrev)
    @IsOptional() @IsString()    level?: string;
    @IsOptional() @IsString()    m?: string;         // message (abbrev)
    @IsOptional() @IsString()    message?: string;
    @IsOptional() @IsString()    t?: string;         // tag (abbrev)
    @IsOptional() @IsString()    tag?: string;

    normalize(): NormalizedLogEntry {
        return {
            timestamp: this.a ?? this.timestamp ?? 0,
            level:     this.l ?? this.level   ?? 'info',
            message:   this.m ?? this.message ?? '',
            tag:       this.t ?? this.tag     ?? null,
        };
    }
}

/** Response envelope for relay `logs` ack. */
export class RelayLogsResponseDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RelayLogEntryDto)
    logs: RelayLogEntryDto[] = [];
}

/** World info object embedded in instance data. */
export class RelayWorldInfoDto {
    @IsInt()       i?: number;   // master_id (abbrev)
    @IsString()    s?: string;   // server (address)
    @IsInt()       v?: number;   // version

    normalize(): NormalizedWorldInfo {
        return {
            master_id: this.i ?? 0,
            server:    this.s ?? '',
            version:   this.v ?? 0,
        };
    }
}

/** One instance entry from relay `get_instances` ack. */
export class RelayInstanceItemDto {
    @IsOptional() @IsInt()       i?: number;         // internal_id (abbrev, relay-local slot)
    @IsOptional() @IsInt()       internal_id?: number;  // long form of i
    @IsOptional() @IsInt()       n?: number;         // node_id (abbrev, DB/federation id)
    @IsOptional() @IsInt()       node_id?: number;   // long form of n
    @IsOptional() @IsArray()     p?: unknown[];      // players array (abbrev)
    @IsOptional() @IsArray()     players?: unknown[];
    @IsOptional() @IsInt()       f?: number;         // flags (abbrev)
    @IsOptional() @IsInt()       flags?: number;
    @IsOptional() @ValidateNested() @Type(() => RelayWorldInfoDto) w?: RelayWorldInfoDto | string;  // world (abbrev, object or legacy string)
    @IsOptional() @ValidateNested() @Type(() => RelayWorldInfoDto) world?: RelayWorldInfoDto | string;
    @IsOptional() @IsInt()       c?: number;         // capacity (abbrev)
    @IsOptional() @IsInt()       capacity?: number;
    @IsOptional() @IsInt()       t?: number;         // configured TPS (abbrev)
    @IsOptional() @IsInt()       tps?: number;
    @IsOptional() @IsNumber()    th?: number;        // configured threshold (abbrev)
    @IsOptional() @IsNumber()    threshold?: number;
    @IsOptional() @IsInt()       et?: number;        // effective TPS (abbrev)
    @IsOptional() @IsInt()       effective_tps?: number;
    @IsOptional() @IsNumber()    eh?: number;        // effective threshold (abbrev)
    @IsOptional() @IsNumber()    effective_threshold?: number;

    normalize(): NormalizedRelayInstance {
        const players = this.p ?? this.players ?? [];
        const rawWorld = this.w ?? this.world;
        const world: NormalizedWorldInfo | string =
            rawWorld instanceof RelayWorldInfoDto
                ? rawWorld.normalize()
                : typeof rawWorld === 'string'
                    ? rawWorld
                    : '';
        return {
            id:           String(this.i ?? this.internal_id ?? ''),
            node_id:      this.n ?? this.node_id ?? 0,
            player_count: typeof players === 'number' ? players : Array.isArray(players) ? players.length : 0,
            flags:        this.f ?? this.flags   ?? 0,
            world,
            capacity:     this.c ?? this.capacity ?? 0,
            tps:          this.t ?? this.tps ?? 0,
            threshold:    this.th ?? this.threshold ?? 0,
            effective_tps:        this.et ?? this.effective_tps ?? 0,
            effective_threshold:  this.eh ?? this.effective_threshold ?? 0,
        };
    }

    rawPlayers(): unknown[] {
        return this.p ?? this.players ?? [];
    }
}

/** Response envelope for relay `get_instances` ack. */
export class RelayInstancesResponseDto {
    @Min(0)
    @IsInt()
    total: number = 0;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RelayInstanceItemDto)
    instances: RelayInstanceItemDto[] = [];
}

/** One client entry from relay `get_clients` ack. */
export class RelayClientItemDto {
    @IsOptional() @IsInt()       i?: number;         // id (abbrev)
    @IsOptional() @IsInt()       id?: number;
    @IsOptional() @IsString()    a?: string;         // address (abbrev)
    @IsOptional() @IsString()    address?: string;
    @IsOptional() @IsString()    p?: string;         // platform (abbrev)
    @IsOptional() @IsString()    platform?: string;
    @IsOptional() @IsString()    e?: string;         // engine (abbrev)
    @IsOptional() @IsString()    engine?: string;
    @IsOptional() @IsString()    u?: string;         // user (abbrev)
    @IsOptional() @IsString()    user?: string;
    @IsOptional() @IsInt()       t?: number;         // connected_at (abbrev)
    @IsOptional() @IsInt()       connected_at?: number;

    normalize(): NormalizedRelayClient {
        return {
            id:           this.i ?? this.id       ?? 0,
            address:      this.a ?? this.address  ?? '',
            platform:     this.p ?? this.platform ?? '',
            engine:       this.e ?? this.engine   ?? '',
            user:         this.u ?? this.user     ?? null,
            connected_at: this.t ?? this.connected_at ?? 0,
        };
    }
}

/** Response envelope for relay `get_clients` ack. */
export class RelayClientsResponseDto {
    @Min(0)
    @IsInt()
    total: number = 0;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RelayClientItemDto)
    clients: RelayClientItemDto[] = [];
}

/** One player entry embedded in an instance's players list. */
export class RelayPlayerItemDto {
    @IsOptional() @IsInt()       i?: number;         // id (abbrev)
    @IsOptional() @IsInt()       id?: number;
    @IsOptional() @IsInt()       c?: number;         // client_id (abbrev)
    @IsOptional() @IsInt()       client_id?: number;
    @IsOptional() @IsString()    d?: string;         // display (abbrev)
    @IsOptional() @IsString()    display?: string;
    @IsOptional() @IsInt()       f?: number;         // flags (abbrev)
    @IsOptional() @IsInt()       flags?: number;
    @IsOptional() @IsInt()       j?: number;         // joined_at (abbrev)
    @IsOptional() @IsInt()       joined_at?: number;
    @IsOptional() @IsString()    u?: string | null;  // user (abbrev)
    @IsOptional() @IsString()    user?: string | null;
    @IsOptional() @IsInt()       ct?: number;        // custom_tps (abbrev)
    @IsOptional() @IsInt()       custom_tps?: number;
    @IsOptional() @IsNumber()    ch?: number;        // custom_threshold (abbrev)
    @IsOptional() @IsNumber()    custom_threshold?: number;

    normalize(): NormalizedRelayPlayer {
        return {
            id:        this.i ?? this.id        ?? 0,
            client_id: this.c ?? this.client_id ?? 0,
            display:   this.d ?? this.display   ?? '',
            flags:     this.f ?? this.flags     ?? 0,
            joined_at: this.j ?? this.joined_at ?? 0,
            user:      this.u ?? this.user      ?? null,
            custom_tps:        this.ct ?? this.custom_tps ?? 0,
            custom_threshold:  this.ch ?? this.custom_threshold ?? 0,
        };
    }
}
