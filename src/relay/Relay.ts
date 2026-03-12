import Main from "../Main";
import { Relay as IRelay } from "@prisma/client";
import RuntimeManager, { AddressList } from "./runtime/RuntimeManager";
import { WebSocket } from "../network/NetSocket";
import Environment from "../utils/Environment";
import WorldIdentifier from "../worlds/WorldIdentifier";
import { RRelay } from "./RelayAPIWeb";

export default class Relay implements IRelay {

    private lastSocketConnection: Date | null = null;
    private lastSocketDisconnection: Date | null = null;

    constructor(relay: IRelay, private readonly app: Main) {
        this.id = relay.id;
        this.created_at = relay.created_at;
        this.updated_at = relay.updated_at;
    }

    created_at: Date;
    updated_at: Date;
    id: number;

    async getRuntime(): Promise<RuntimeManager | null> {
        for (const runtime of this.app.relays.runtimes)
            if (await runtime.isHost(this))
                return runtime;
        return null;
    }

    async getAddress(): Promise<AddressList> {
        const status = await this.getStatus();
        if (status instanceof Error || !status.a) return {};
        return Object.fromEntries(
            Object.entries(status.a).map(([proto, addr]) => [
                proto.toLowerCase(),
                addr.replace(/^(0\.0\.0\.0:|::1:|:::)/, Environment.getDockerAddress() + ":")
            ] as [string, string])
        );
    }

    async getSocket(): Promise<WebSocket | null> {
        const sockets = await this.app.http.socket.getSocketsByRelayId(this.id);
        return sockets.length > 0 ? sockets[0] : null;
    }

    async getStatus(): Promise<RelayStatus | Error> {
        const socket = await this.getSocket();
        if (!socket) return new Error("Relay is not connected");
        let t0 = Date.now();
        let status = await socket.sendData<any, RelayStatus>("status", {});
        if (status instanceof Error) return status;
        status.t = Date.now() - t0;
        return status;
    }

    async getLogs(since?: number, limit: number = 100): Promise<RelayLog[] | Error> {
        const socket = await this.getSocket();
        if (!socket) return new Error("Relay is not connected");
        const response = await socket.sendData<{ since?: number, limit: number }, { logs: RelayLog[] }>("logs", { since, limit });
        if (response instanceof Error) return response;
        return response.logs;
    }

    async sendCommand(command: string): Promise<boolean | Error> {
        const socket = await this.getSocket();
        if (!socket) return new Error("Relay is not connected");
        try {
            socket.emitData("command", { content: command });
            return true;
        } catch (error) {
            return new Error("Failed to send command");
        }
    }

    async hasInstance(id: number): Promise<boolean> {
        const socket = await this.getSocket();
        if (!socket) return false;
        const response = await socket.sendData<{ id: number }, { exists: boolean }>("has_instance", { id });
        if (response instanceof Error) return false;
        return response.exists;
    }

    async getClients(limit: number = 100, offset: number = 0): Promise<{ total: number, clients: RelayClient[] } | Error> {
        const socket = await this.getSocket();
        if (!socket) return new Error("Relay is not connected");
        const response = await socket.sendData<{ limit: number, offset: number }, RelayClientResponse>(
            "get_clients",
            { limit, offset }
        );
        if (response instanceof Error) return response;
        return {
            total: response.total,
            clients: response.clients.map(c => ({
                id: c.i,
                address: c.a,
                platform: c.p,
                engine: c.e,
                user: c.u || null
            }))
        };
    }

    async getInstances(limit: number = 100, offset: number = 0): Promise<{ total: number, instances: RelayInstance[] } | Error> {
        const socket = await this.getSocket();
        if (!socket) return new Error("Relay is not connected");
        const response = await socket.sendData<{ limit: number, offset: number }, RelayInstanceResponse>(
            "get_instances",
            { limit, offset }
        );
        if (response instanceof Error) return response;
        return {
            total: response.total,
            instances: response.instances.map(i => ({
                id: i.i,
                internal_id: parseInt(i.n.toString()),
                players: i.p.map(p => ({
                    id: p.i,
                    client_id: p.c,
                    display: p.d,
                    flags: p.f,
                    user: p.u ?? null
                })),
                flags: i.f,
                world: i.w,
                capacity: i.c
            }))
        };
    }

    async isFull(): Promise<boolean> {
        const s = await this.getStatus();
        if (s instanceof Error) return false;
        return s.i >= s.m;
    }

    async isConnected(): Promise<boolean> {
        const socket = await this.getSocket();
        return !!socket;
    }

    updateLastConnection() {
        this.lastSocketConnection = new Date();
    }

    updateLastDisconnection() {
        this.lastSocketDisconnection = new Date();
    }

    /**
     * Vérifie si le relay est déconnecté récemment (moins de X secondes)
     * @param gracePeriodSeconds Période de grâce en secondes (défaut: 60)
     */
    isRecentlyDisconnected(gracePeriodSeconds: number = 60): boolean {
        if (!this.lastSocketDisconnection) return false;
        if (this.lastSocketConnection && this.lastSocketConnection > this.lastSocketDisconnection)
            return false; // Relay is currently connected

        const now = new Date();
        const timeSinceDisconnection = (now.getTime() - this.lastSocketDisconnection.getTime()) / 1000;
        return timeSinceDisconnection < gracePeriodSeconds;
    }

    /**
     * Vérifie si le relay est considéré comme vraiment mort
     */
    async isReallyDead(): Promise<boolean> {
        // Check if relay was just created (startup grace period)
        const now = new Date();
        const timeSinceCreation = (now.getTime() - this.created_at.getTime()) / 1000;
        const STARTUP_GRACE_PERIOD = 60; // 60 seconds for relay to start and connect

        if (timeSinceCreation < STARTUP_GRACE_PERIOD) {
            return false; // Still in startup grace period
        }

        // Check if recently disconnected (grace period)
        if (this.isRecentlyDisconnected(60))
            return false; // Still in grace period after disconnect

        // Check if socket is connected
        const socket = await this.getSocket();
        return !socket;
    }

    async getBadger() {
        return await this.app.relays.getBadgerByRelayId(this.id);
    }

    async delete() {
        return await this.app.relays.deleteRelay(this.id);
    }

    async stop(): Promise<boolean> {
        const runtime = await this.getRuntime();
        if (!runtime) return false;
        return await runtime.stop(this);
    }

    async restart(): Promise<boolean> {
        const runtime = await this.getRuntime();
        if (!runtime) return false;
        return await runtime.restart(this);
    }

    async create(): Promise<boolean> {
        const runtime = await this.getRuntime();
        if (!runtime) return false;
        return await runtime.create(this);
    }

    async toJSON(): Promise<RRelay> {
        let connected = await this.isConnected();
        const status = await this.getStatus();

        if (status instanceof Error)
            return {
                id: this.id,
                runtime: (await this.getRuntime())?.getName() || 'unknown',
                running: connected,
                status: status.message,
                address: await this.getAddress()
            };

        return {
            id: this.id,
            runtime: (await this.getRuntime())?.getName() || 'unknown',
            running: connected,
            status: {
                instances: status.i,
                max_instances: status.m,
                clients: status.c,
                engine: status.e,
                version: status.v,
                protocol: status.p,
                uptime: status.u,
                response: status.t,
                specs: {
                    c: status.s.c,
                    m: status.s.m,
                    u: status.s.u,
                    d: status.s.d,
                }
            },
            address: await this.getAddress()
        };
    }
}

export interface RelayStatus {
    i: number; // instances
    c: number; // clients
    m: number; // max instances
    e: string; // engine identifier
    v: string; // version
    p: number; // protocol
    u: number; // uptime in seconds
    t: number; // response time in ms
    s: RelaySpecs; // specs
    a: Record<string, string>; // connection addresses: proto -> "host:port"
}

export interface RelayLog {
    timestamp: number;
    level: string;
    message: string;
    tag?: string;
}

export interface RelaySpecs {
    c: {
        u: number;
        c: number;
    };
    m: {
        u: number;
        t: number;
    };
    u: {
        u: number;
        b: number;
    };
    d: {
        u: number;
        b: number;
    };
}

// Response types from Rust relay
interface RelayClientResponse {
    total: number;
    clients: {
        i: string;  // client ID
        a: string;  // address
        p: string;  // platform
        e: string;  // engine
        u?: string; // user identifier (optional)
    }[];
}

interface RelayInstanceResponse {
    total: number;
    instances: {
        i: string;  // instance node ID
        n: number;  // internal ID
        p: {        // players
            i: string; // player ID
            c: string; // client ID
            d: string; // display name
            f: number; // flags
            u?: string;// user identifier (e.g. "1@hactazia.fr")
        }[];
        f: number;  // flags
        w: string;  // world
        c: number;  // capacity
    }[];
}

// Domain types for API consumers
export interface RelayClient {
    id: string;
    address: string;
    platform: string;
    engine: string;
    user: string | null;
}

export interface RelayInstance {
    id: string;
    internal_id: number;
    players: {
        id: string;
        client_id: string;
        display: string;
        flags: number;
        user: string | null;
    }[];
    flags: number;
    world: string;
    capacity: number;
}
