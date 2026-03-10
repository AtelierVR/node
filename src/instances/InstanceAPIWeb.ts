import Reileta from "../Main";
import NetExpress, { Request, Response } from "../network/NetExpress";
import { AddressList } from "../relay/runtime/RuntimeManager";
import NetUser from "../users/NetUser";
import User from "../users/User";
import UserIdentifier from "../users/UserIdentifier";
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage, stringify } from "../utils/Utils";
import WorldIdentifier from "../worlds/WorldIdentifier";
import Instance from "./Instance";
import InstanceManager from "./InstanceManager";
import Express from 'express';

export default class InstanceAPIWeb {
    constructor(private readonly app: Reileta, private readonly manager: InstanceManager) {
        this.app.http.express.server.get('/api/instances', (req, res) => this.searchHandler(req as Request, res as Response));
        this.app.http.express.server.get('/api/instances/:search', (req, res) => this.handleInstance(req as Request<{ search: string }>, res as Response));
        this.app.http.express.server.put('/api/instances', Express.json(), NetExpress.validate<IMakeInstance>('instances/create'), (req, res) => this.handleMakeInstance(req as Request, res as Response));
    }

    async searchHandler(request: Request, response: Response) {
        var { query, limit, offset, world, owner } = request.query;
        if (!limit || typeof limit !== 'string') limit = '10';
        if (!offset || typeof offset !== 'string') offset = '0';
        if (!/^\d+$/.test(limit)) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'limit', 'integer [0-100]'));
        if (!/^\d+$/.test(offset)) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'offset', 'integer [0-...]'));
        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);
        if (ilimit > 100) ilimit = 100;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;
        let querys: string | undefined = typeof query === 'string' && query.length > 0 ? query : undefined;
        let worlds: WorldIdentifier | undefined = undefined;
        if (typeof world === 'string')
            worlds = WorldIdentifier.fromString(world) || undefined;
        let owners: UserIdentifier | undefined = undefined;
        if (typeof owner === 'string')
            owners = UserIdentifier.fromString(owner) || undefined;
        var result = await this.manager.searchInstances({
            query: querys,
            world: worlds,
            owner: owners
        }, ilimit, ioffset);
        let instances: IRInstance[] = [];
        let http = this.app.server.getInfos().gateways.http;
        for (let instance of result.instances) {
            var relay = await instance.getRelay();
            let addr = await relay?.getAddress() || null;
            let hasInstance = relay ? await relay.hasInstance(instance.id) : false;

            // Get instance details if it exists on the relay
            let relayInstanceData = null;
            if (hasInstance && relay) {
                const instancesResult = await relay.getInstances(1, 0);
                if (!(instancesResult instanceof Error)) {
                    relayInstanceData = instancesResult.instances.find(i => i.id === instance.id.toString());
                }
            }

            instances.push({
                id: instance.id,
                title: instance.title || null,
                description: instance.description || null,
                thumbnail: instance.getThumbnail(http)?.href || null,
                name: instance.name,
                server: this.app.server.getInfos().address,
                capacity: instance.capacity,
                owner: instance.ownerIdentifier.toString(this.app.server.getInfos().address),
                tags: instance.getTags(),
                alias: await instance.alias(),
                world: instance.worldIdentifier.toString(this.app.server.getInfos().address),
                connection: addr && hasInstance && relay ? {
                    method: 'relay',
                    data: Buffer.from(stringify<IRConnectionDataRelay>({
                        a: Object.entries(addr).map(e => `${e[0]}://${e[1]}`),
                        i: instance.id,
                        p: (await relay.getStatus() instanceof Error ? 0 : (await relay.getStatus() as any).p)
                    })).toString('base64')
                } : null,
                client_count: relayInstanceData?.players.length || 0,
                players: relayInstanceData?.players
                    .filter(p => !(p.flags & 0x01) && !(p.flags & 0x02)) // filter out is_bot and hide_in_list flags
                    .map(p => ({
                        user: null, // TODO: resolve user from client_id if needed
                        display: p.display
                    })) || []
            });
        }
        return response.send({
            total: result.total,
            query: query,
            world: worlds?.toString(this.app.server.getInfos().address),
            owner: owners?.toString(this.app.server.getInfos().address),
            limit: ilimit,
            offset: ioffset,
            instances: instances
        });
    }

    async handleInstance(request: Request<{ search: string }>, response: Response) {
        let instance: Instance | null = null;

        if (request.params.search.startsWith("#")) {
            request.params.search = request.params.search.slice(1);
            if (InstanceManager.isValidName(request.params.search))
                instance = await this.manager.findInstanceByName(request.params.search);
        } else {
            var id = parseInt(request.params.search);
            if (InstanceManager.isValidId(id))
                instance = await this.manager.findInstanceById(id);
        }

        if (!instance)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Instance'));

        var relay = await instance.getRelay();
        let addr = await relay?.getAddress() || null;
        let hasInstance = relay ? await relay.hasInstance(instance.id) : false;
        let http = this.app.server.getInfos().gateways.http;

        // Get instance details if it exists on the relay
        let relayInstanceData = null;
        if (hasInstance && relay) {
            const instancesResult = await relay.getInstances(1, 0);
            if (!(instancesResult instanceof Error)) {
                relayInstanceData = instancesResult.instances.find(i => i.id === instance.id.toString());
            }
        }

        return response.send<IRInstance>({
            id: instance.id,
            title: instance.title || null,
            description: instance.description || null,
            thumbnail: instance.getThumbnail(http)?.href || null,
            name: instance.name,
            server: this.app.server.getInfos().address,
            owner: instance.ownerIdentifier.toString(this.app.server.getInfos().address),
            capacity: instance.capacity,
            tags: instance.getTags(),
            alias: await instance.alias(),
            world: instance.worldIdentifier.toString(this.app.server.getInfos().address),
            connection: addr && hasInstance && relay ? {
                method: 'relay',
                data: Buffer.from(stringify<IRConnectionDataRelay>({
                    a: Object.entries(addr).map(e => `${e[0]}://${e[1]}`),
                    i: instance.id,
                    p: (await relay.getStatus() instanceof Error ? 0 : (await relay.getStatus() as any).p)
                })).toString('base64')
            } : null,
            client_count: relayInstanceData?.players.length || 0,
            players: relayInstanceData?.players
                .filter(p => !(p.flags & 0x01) && !(p.flags & 0x02)) // filter out is_bot and hide_in_list flags
                .map(p => ({
                    user: null, // TODO: resolve user from client_id if needed
                    display: p.display
                })) || []
        });
    }

    async handleMakeInstance(request: Request, response: Response) {
        let user: User | NetUser | null = null;
        if (request.data.isBearer()) {
            user = await request.data.getData() as User | null;
        } else return new ErrorMessage(ErrorCodes.NotFound);
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        var instance = request.body as IMakeInstance;

        const worldref = WorldIdentifier.fromString(instance.world);
        if (!worldref) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world', 'string'));

        let whitelist: { active: boolean, users: UserIdentifier[] } = {
            active: instance.use_whitelist,
            users: (instance.whitelist || []).map((u: string) => UserIdentifier.fromString(u)).filter((u: UserIdentifier) => u !== null) as UserIdentifier[]
        };

        var current = await user.toIdentifier();
        if (!whitelist.users.find(u => u.equals(current)))
            whitelist.users.push(current);

        var result = await this.manager.createInstance({
            name: instance.name || this.manager.generateName(),
            title: instance.title || null,
            description: instance.description || null,
            world: worldref,
            capacity: instance.capacity,
            thumbnail: instance.thumbnail ? new URL(instance.thumbnail) : null,
            owner: user,
            whitelist,
            tags: [
                instance.expose ? `sys:public` : `sys:private`,
            ],
            password: {
                active: instance.use_password,
                value: instance.password
            }
        });

        if (!(result instanceof Instance))
            return response.send(new ErrorMessage(ErrorCodes.InternalError, 'create instance'));
        let http = this.app.server.getInfos().gateways.http;

        return response.send<IRInstance>({
            id: result.id,
            title: result.title || null,
            description: result.description || null,
            thumbnail: result.getThumbnail(http)?.href || null,
            name: result.name,
            server: this.app.server.getInfos().address,
            capacity: result.capacity,
            owner: result.ownerIdentifier.toString(this.app.server.getInfos().address),
            tags: result.getTags(),
            alias: await result.alias(),
            world: result.worldIdentifier.toString(this.app.server.getInfos().address),
            connection: null,
            client_count: 0,
            players: []
        });
    }
}

export interface IRInstance {
    id: number;
    server: string;
    name: string;

    title: string | null;
    description: string | null;
    thumbnail: string | null;

    capacity: number;
    owner: string;
    tags: string[];
    world: string;
    alias: {
        key: string;
        value: string;
    }[]

    connection: IRConnection | null;
    client_count: number;
    players: IRInstancePlayer[];
}

export interface IRConnection {
    method: string;
    data: string; // base64 of JSON object
}

export interface IRConnectionDataRelay {
    a: string[]; // address list
    i: number; // instance id
    p: number; // protocol version
}

export interface IRInstancePlayer {
    user: string | null;
    display: string;
}

export interface IMakeInstance {
    name?: string;
    title?: string;
    description?: string;
    thumbnail?: string;
    expose: string;

    world: string;
    capacity: number;

    use_password: boolean;
    password?: string;
    use_whitelist: boolean;
    whitelist?: string[];
}