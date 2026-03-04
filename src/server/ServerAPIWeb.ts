import e from "express";
import Reileta from "../Main";
import { Request, Response } from "../network/NetExpress";
import { getContact, getPort, getPreferedAddress } from "../utils/Environment";
import { ServerManager } from "./ServerManager";
import { Security } from "../utils/Security";
import Debug from "../utils/Debug";
import { ErrorMessage } from "../utils/Utils";
import { ErrorCodes } from "../utils/Constants";
import User from "../users/User";

export class ServerAPIWeb {
    constructor(private readonly app: Reileta, private readonly manager: ServerManager) {
        this.app.http.express.server.get('/.well-known/nox', (req, res) => this.wellKnownAVR(req as Request, res as Response));
        this.app.http.express.server.get('/api/server', (req, res) => this.getInfo(res as Response));
        this.app.http.express.server.get('/api/server/logs', (req, res) => this.getLogs(req as Request, res as Response));
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
            contact: getContact(),
            port: getPort(),
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
     * Get the server info
     * @param response 
     */
    getInfo(response: Response) {
        const infos = this.manager.getInfos();
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
}