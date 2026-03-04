import Main from "../Main";
import NetExpress, { Request, Response } from "../network/NetExpress";
import User from "../users/User";
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage } from "../utils/Utils";
import Relay from "./Relay";
import Express from "express";

export default class RelayAPIWeb {
    constructor(private readonly app: Main) {
        this.app.http.express.server.get('/api/relays', (req, res) => this.getRelays(req as Request, res as Response));
        this.app.http.express.server.get('/api/relays/:id', (req, res) => this.getRelay(req as unknown as Request<{ id: string }>, res as Response));
        this.app.http.express.server.get('/api/relays/:id/logs', (req, res) => this.getRelayLogs(req as unknown as Request<{ id: string }>, res as Response));
        this.app.http.express.server.get('/api/relays/:id/instances', (req, res) => this.getRelayInstances(req as unknown as Request<{ id: string }>, res as Response));
        this.app.http.express.server.get('/api/relays/:id/clients', (req, res) => this.getRelayClients(req as unknown as Request<{ id: string }>, res as Response));
        this.app.http.express.server.get('/api/relays/:id/instances/:iid/players', (req, res) => this.getInstancePlayers(req as unknown as Request<{ id: string, iid: string }>, res as Response));
        this.app.http.express.server.put('/api/relays/:id/logs', Express.json(), (req, res) => this.sendCommand(req as unknown as Request<{ id: string }>, res as Response));
        this.app.http.express.server.post('/api/relays/:id/stop', (req, res) => this.stopRelay(req as unknown as Request<{ id: string }>, res as Response));
        this.app.http.express.server.post('/api/relays/:id/restart', (req, res) => this.restartRelay(req as unknown as Request<{ id: string }>, res as Response));
    }

    private async getRelay(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));

        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));

        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));

        const relay = new Relay(relayData, this.app);
        return response.send<RRelay>(await relay.toJSON());
    }

    private async getRelayLogs(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));

        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));

        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));

        const relay = new Relay(relayData, this.app);
        
        const since = request.query.since ? parseInt(request.query.since as string) : undefined;
        const limit = request.query.limit ? parseInt(request.query.limit as string) : 100;

        const logs = await relay.getLogs(since, limit);
        if (logs instanceof Error)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, logs.message));

        return response.send<RRelayLog[]>(logs.map(l => ({
            timestamp: l.timestamp,
            level: l.level,
            message: l.message,
            tag: l.tag
        })));
    }

    private async getRelays(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));

        let relays = await Promise.all((await this.app.database.relay.findMany({}))
            .map(r => new Relay(r, this.app))
            .map(r => r.toJSON()));

        return response.send<RRelay[]>(relays);
    }

    private async getRelayInstances(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));
        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));
        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));
        const relay = new Relay(relayData, this.app);
        const limit = request.query.limit ? parseInt(request.query.limit as string) : 100;
        const offset = request.query.offset ? parseInt(request.query.offset as string) : 0;
        const result = await relay.getInstances(limit, offset);
        if (result instanceof Error)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, result.message));
        return response.send<RRelayInstancesResult>({
            total: result.total,
            limit,
            offset,
            instances: result.instances.map(i => ({
                id: i.id,
                internal_id: i.internal_id,
                player_count: i.players.length,
                flags: i.flags,
                world: i.world,
                capacity: i.capacity
            }))
        });
    }

    private async getRelayClients(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));
        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));
        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));
        const relay = new Relay(relayData, this.app);
        const limit = request.query.limit ? parseInt(request.query.limit as string) : 100;
        const offset = request.query.offset ? parseInt(request.query.offset as string) : 0;
        const result = await relay.getClients(limit, offset);
        if (result instanceof Error)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, result.message));
        return response.send<RRelayClientsResult>({ ...result, limit, offset });
    }

    private async getInstancePlayers(request: Request<{ id: string, iid: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));
        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));
        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));
        const relay = new Relay(relayData, this.app);
        const iid = request.params.iid;
        const result = await relay.getInstances(1000, 0);
        if (result instanceof Error)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, result.message));
        const instance = result.instances.find(i => i.id === iid);
        if (!instance)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Instance not found"));
        return response.send<RRelayPlayersResult>({
            total: instance.players.length,
            limit: instance.players.length,
            offset: 0,
            players: instance.players
        });
    }

    private async stopRelay(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));

        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));

        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));

        const relay = new Relay(relayData, this.app);
        const success = await relay.stop();
        
        if (!success)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "Failed to stop relay"));

        return response.send({ success: true });
    }

    private async restartRelay(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));

        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));

        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));

        const relay = new Relay(relayData, this.app);
        const success = await relay.restart();
        
        if (!success)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "Failed to restart relay"));

        return response.send({ success: true });
    }

    private async sendCommand(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        if (!user.isAdmin())
            return response.send(new ErrorMessage(ErrorCodes.UnAuthorized));

        const id = parseInt(request.params.id);
        if (isNaN(id))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Invalid relay ID"));

        const body = request.body as { content?: string };
        if (!body || !body.content || !body.content.trim())
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, "Missing content"));

        const relayData = await this.app.database.relay.findUnique({ where: { id } });
        if (!relayData)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, "Relay not found"));

        const relay = new Relay(relayData, this.app);
        
        const result = await relay.sendCommand(body.content);
        if (result instanceof Error)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, result.message));

        return response.send({ success: result });
    }

}

export interface RRelay {
    id: number;
    runtime: string;
    running: boolean;
    status: RRelayStatus | string;
    address: { 
        [protocol: string]: string 
    };
}

export interface RRelayLog {
    timestamp: number;
    level: string;
    message: string;
    tag?: string;
}

export interface RRelayStatus {
    instances: number;
    max_instances: number;
    clients: number;
    engine: string;
    version: string;
    protocol: number;
    uptime: number;
    response: number;
    specs: {
        cpu: number;
        memory: [number, number];
        upload: [number, number];
        download: [number, number];
        storage: [number, number];
    };
}

export interface RRelayInstanceSummary {
    id: string;
    internal_id: number;
    player_count: number;
    flags: number;
    world: string;
    capacity: number;
}

export interface RRelayInstancesResult {
    total: number;
    limit: number;
    offset: number;
    instances: RRelayInstanceSummary[];
}

export interface RRelayClientDetail {
    id: string;
    address: string;
    platform: string;
    engine: string;
    user: string | null;
}

export interface RRelayClientsResult {
    total: number;
    limit: number;
    offset: number;
    clients: RRelayClientDetail[];
}

export interface RRelayPlayerDetail {
    id: string;
    client_id: string;
    display: string;
    flags: number;
}

export interface RRelayPlayersResult {
    total: number;
    limit: number;
    offset: number;
    players: RRelayPlayerDetail[];
}