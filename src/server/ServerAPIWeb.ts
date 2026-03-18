import Reileta from "../Main";
import { Request, Response } from "../network/NetExpress";
import Env, { CONFIG_DEFINITIONS } from "../utils/Environment";
import { ServerManager } from "./ServerManager";
import Debug from "../utils/Debug";
import { ErrorMessage } from "../utils/Utils";
import { ErrorCodes } from "../utils/Constants";
import User from "../users/User";

export class ServerAPIWeb {
    constructor(private readonly app: Reileta, private readonly manager: ServerManager) {
        this.app.http.express.server.get('/.well-known/nox', (req, res) => this.wellKnownAVR(req as Request, res as Response));
        this.app.http.express.server.get('/api/server', (req, res) => this.getInfo(res as Response));
        this.app.http.express.server.get('/api/server/logs', (req, res) => this.getLogs(req as Request, res as Response));
        this.app.http.express.server.get('/api/server/configs', (req, res) => this.getConfigs(req as Request, res as Response));
        this.app.http.express.server.patch('/api/server/configs', (req, res) => this.patchConfigs(req as Request, res as Response));
    }

    /**
     * Well known AVR
     * @param request 
     * @param response 
     */
    wellKnownAVR(request: Request, response: Response) {
        const infos = this.manager.getInfos();
        const status = this.manager.getStatus();
        response.oldsend({
            address: infos.address,
            contact: Env.sync('CONTACT'),
            port: Env.sync('NODE_PORT'),
            endpoints: {
                wellknown: new URL(`/.well-known/nox`, this.app.server.getInfos().gateways.http).href,
                server: new URL(`/api/server`, this.app.server.getInfos().gateways.http).href,
            },
            versions: {
                server: infos.version,
                node: process.versions.node,
            },
            status: this.manager.getStatus().code,
            security: status.code === "security" && status.security ? {
                message: status.security.message,
                features_disabled: status.security.features_disabled
            } : null,
            error_message: status.code === "error" && status.error ? status.error.message : null,
            maintenance: status.maintenance ? {
                message: status.maintenance.message,
                start_at: status.maintenance.start_date?.getTime() || null,
                end_at: status.maintenance.end_date?.getTime() || null
            } : null
        });
    }

    /**
     * Get the server info with live statistics
     * @param response 
     */
    async getInfo(response: Response) {
        const infos = this.manager.getInfos();

        // Collect DB stats in parallel
        const [totalUsers, totalWorlds, totalAvatars, totalInstances, activeUsers] = await Promise.all([
            this.app.database.user.count(),
            this.app.database.world.count(),
            this.app.database.avatar.count(),
            this.app.database.instance.count(),
            this.app.database.user.count({
                where: { sessions: { some: { expires: { gt: new Date() } } } }
            }),
        ]);

        // Count users connected via WebSocket
        let connectedUsers = 0;
        for (const socket of this.app.http.socket.sockets) {
            if (socket.data.isBearer()) connectedUsers++;
        }

        // Collect live relay stats
        let liveInstances = 0;
        let liveClients = 0;
        let livePlayerCount = 0;
        try {
            const relayRecords = await this.app.database.relay.findMany({});
            const Relay = (await import('../relay/Relay')).default;
            await Promise.all(relayRecords.map(async (r) => {
                const relay = new Relay(r, this.app);
                const status = await relay.getStatus();
                if (status instanceof Error) return;
                liveInstances += status.i ?? 0;
                liveClients   += status.c ?? 0;
            }));
            // Count players from relay instances
            for (const r of relayRecords) {
                const relay = new Relay(r, this.app);
                const inst = await relay.getInstances(1000, 0);
                if (inst instanceof Error) continue;
                for (const instance of inst.instances)
                    livePlayerCount += instance.players.length;
            }
        } catch (_) { /* relay not available */ }

        response.send<IRServer>({
            id: infos.id,
            title: infos.title,
            description: infos.description,
            address: infos.address,
            gateways: {
                http: infos.gateways.http.origin,
                ws: infos.gateways.ws.href,
                web: infos.gateways.web.origin
            },
            features: infos.features,
            version: infos.version,
            ready_at: infos.ready_at.getTime(),
            icon: infos.icon.href,
            certificate: infos.certificate,
            statistics: {
                users: totalUsers,
                active_users: activeUsers,
                connected_users: connectedUsers,
                worlds: totalWorlds,
                avatars: totalAvatars,
                instances: totalInstances,
                live_instances: liveInstances,
                live_clients: liveClients,
                live_players: livePlayerCount,
            },
        });
    }

    /**
     * Get server logs (admin only)
     * @param request 
     * @param response 
     */
    async getLogs(request: Request, response: Response) {
        // Check if user is logged in
        if (!request.data.isBearer()) 
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        // Get user and verify admin role
        const user = await request.data.getData() as User | null;
        if (!user || !user.isAdmin()) 
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'admin access required'));

        // Get limit from query params (default 500, max 1000)
        const limit = Math.min(parseInt(request.query.limit as string) || 500, 1000);
        
        // Get after timestamp from query params (optional)
        const after = request.query.after ? parseInt(request.query.after as string) : undefined;

        // Get logs
        const logs = Debug.getLogs(limit, after).map(log => ({
            timestamp: log.timestamp.getTime(),
            level: log.level,
            message: log.message,
        }));

        response.send<LogsResponse>({
            logs,
            total: logs.length,
        });
    }

    /**
     * Get server configs (admin only)
     * @param request 
     * @param response 
     */
    async getConfigs(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user || !user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'admin access required'));

        const overrides = await Env.listOverrides();
        const overrideMap = new Map(overrides.map(o => [o.key, o.value]));

        const configs: IRConfigEntry[] = CONFIG_DEFINITIONS.map(def => {
            const envRaw = (process.env as Record<string, string | undefined>)[def.key];
            const isForced = envRaw !== undefined && envRaw.startsWith('!');
            const envValue = isForced ? envRaw!.slice(1) : (envRaw || null);
            const dbValue = overrideMap.get(def.key) ?? null;
            const defaultValue = typeof def.default === 'function' ? def.default() : def.default;

            return {
                key: def.key,
                label: def.label,
                description: ('description' in def ? (def as any).description : null) ?? null,
                default: defaultValue,
                environment: envValue,
                override: dbValue,
                forced: isForced,
                risky: ('risky' in def ? (def as any).risky : false) ?? false,
            };
        });

        response.send<ConfigsResponse>(configs);
    }

    /**
     * Patch server configs (admin only)
     * Body: { key: string, value: string | null }[]
     * @param request 
     * @param response 
     */
    async patchConfigs(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user || !user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized, 'admin access required'));

        const body = request.body;
        if (!Array.isArray(body))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, 'body must be an array'));

        const validKeys = new Set(CONFIG_DEFINITIONS.map(d => d.key));
        const results: { key: string; ok: boolean; error?: string }[] = [];

        for (const item of body as { key: string; value: string | null }[]) {
            if (typeof item.key !== 'string' || !validKeys.has(item.key as any)) {
                results.push({ key: item.key ?? '?', ok: false, error: 'unknown key' });
                continue;
            }
            if (item.value !== null && typeof item.value !== 'string') {
                results.push({ key: item.key, ok: false, error: 'value must be a string or null' });
                continue;
            }
            try {
                await Env.set(item.key as any, item.value);
                results.push({ key: item.key, ok: true });
            } catch (e: any) {
                results.push({ key: item.key, ok: false, error: e?.message ?? 'internal error' });
            }
        }

        response.send<PatchConfigsResponse>({ results });
    }
}

export interface LogsResponse {
    logs: {
        timestamp: number;
        level: 'log' | 'error' | 'warning' | 'debug';
        message: string;
    }[];
    total: number;
}

export interface IRWellKnown {
    address: string;
    contact: string;
    port: number;
    endpoints: {
        wellknown: string;
        server: string;
    };
    versions: {
        server: string;
        node: string;
    };
    status: string;
    security: {
        message: string;
        features_disabled: string[];
    } | null;
    error_message: string | null;
    maintenance: {
        message: string;
        start_at: number | null;
        end_at: number | null;
    } | null;
}

export interface IRServerStatistics {
    users: number;
    active_users: number;
    connected_users: number;
    worlds: number;
    avatars: number;
    instances: number;
    live_instances: number;
    live_clients: number;
    live_players: number;
}

export interface IRServer {
    id: string;
    title: string;
    description: string;
    address: string;
    gateways: {
        http: string;
        ws: string;
        web: string;
    };
    features: string[];
    version: string;
    ready_at: number;
    icon: string;
    certificate: string;
    statistics: IRServerStatistics;
}

export interface IRConfigEntry {
    key: string;
    label: string;
    description: string | null;
    default: string;
    environment: string | null;
    override: string | null;
    forced: boolean;
    risky: boolean;
}

export type ConfigsResponse = IRConfigEntry[];

export interface PatchConfigsResponse {
    results: { key: string; ok: boolean; error?: string }[];
}