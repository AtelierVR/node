import Reileta from "../Main";
import PresenceManager from "./PresenceManager";
import NetExpress, { Request, Response } from "../network/NetExpress";
import Express from 'express';
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage } from "../utils/Utils";
import User from "../users/User";
import NetServer from "../server/NetServer";
import UserManager from "../users/UserManager";
import InstanceIdentifier from "../instances/InstanceIdentifier";
import Debug from "../utils/Debug";

export default class PresenceAPIWeb {

    constructor(private readonly app: Reileta, private readonly manager: PresenceManager) {
        this.app.http.express.server.post('/api/presence', Express.json(), NetExpress.validate('presence/server'), (req, res) => this.handlePresenceByServer(req as Request<{ user_id: string }>, res as Response));
        this.app.http.express.server.put('/api/users/@me/presence', Express.json(), NetExpress.validate('presence/user'), (req, res) => this.handlePresenceByUser(req as Request, res as Response));
    }

    async handlePresenceByUser(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (!isResquestPresenceData(request.body))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'type', 'string'));

        let data = request.body;
        switch (data.type) {
            case 'status':
                if (!isResquestPresenceStatusData(data))
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'body', 'ResquestPresenceStatusData'));
                Debug.log("change status by user", user.id, data.status, data.message);
                break;
            case 'location':
                if (!isResquestPresenceLocationData(data))
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'body', 'ResquestPresenceLocationData'));
                const instance = InstanceIdentifier.fromString(data.instance);
                if (instance === null)
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'instance', 'InstanceIdentifier'));
                const world = InstanceIdentifier.fromString(data.world);
                if (world === null)
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world', 'InstanceIdentifier'));

                let result = await this.manager.makePresenceLocation({
                    type: data.type,
                    to: [user],
                    mode: data.mode,
                    instance: data.instance,
                    world: data.world
                }, 'user');

                if (result.length === 0)
                    return response.send(new ErrorMessage(ErrorCodes.InternalError, 'make presence'));
                break;
            default:
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'type', 'string'));
        }

        return response.send({ success: true });
    }

    async handlePresenceByServer(request: Request, response: Response) {
        if (!request.data.isChallenge())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let server = await request.data.getData() as NetServer | null;
        if (!server) return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));

        let data = request.body;
        if (!isResquestPresenceByServerData(data))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'body', 'ResquestPresenceByServerData'));

        let to_users: User[] = await this.app.users.findUsersByIds(data.to);
        if (!to_users.every(user => data.to.includes(user.id)))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, "to", "id[]"));

        switch (data.type) {
            case 'location':
                if (!isResquestPresenceLocationData(data))
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'body', 'ResquestPresenceLocationData'));
                const instance = InstanceIdentifier.fromString(data.instance);
                if (instance === null)
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'instance', 'InstanceIdentifier'));
                const world = InstanceIdentifier.fromString(data.world);
                if (world === null)
                    return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'world', 'InstanceIdentifier'));

                let result = await this.manager.makePresenceLocation({
                    type: data.type,
                    to: to_users,
                    mode: data.mode,
                    instance: data.instance,
                    world: data.world
                }, 'server');

                if (result.length === 0)
                    return response.send(new ErrorMessage(ErrorCodes.InternalError, 'make presence'));
                break;
            default:
                return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'type', 'string'));
        }

        return response.send({ success: true });
    }
}

interface IResquestPresenceData {
    type: string;
}

export interface IResquestPresenceByServerData extends IResquestPresenceData {
    to: number[];
}

function isResquestPresenceByServerData(data: any): data is IResquestPresenceByServerData {
    if (!isResquestPresenceData(data)) return false;
    let next = data as IResquestPresenceData & { [key: string]: any };
    return typeof next.user_id === 'number' && UserManager.isValidId(next.user_id);
}

function isResquestPresenceData(data: any): data is IResquestPresenceData {
    return data && typeof data === 'object' && typeof data.type === 'string';
}

interface IResquestPresenceStatusData extends IResquestPresenceData {
    type: 'status';
    status: 'invisible' | 'join_me_all' | 'join_me_friend' | 'online' | 'idle' | 'dnd';
    message?: string;
}

function isResquestPresenceStatusData(data: any): data is IResquestPresenceStatusData {
    if (!isResquestPresenceData(data)) return false;
    let next = data as IResquestPresenceData & { [key: string]: any };
    return next.type === 'status'
        && typeof next.status === 'string'
        && ['invisible', 'join_me_all', 'join_me_friend', 'online', 'idle', 'dnd'].includes(next.status)
        && (next.message === undefined
            || (typeof next.message === 'string' && next.message.length <= 128)
            || next.message === null
        );
}

export interface IResquestPresenceLocationData extends IResquestPresenceData {
    type: 'location';
    mode: 'join' | 'leave';
    instance: string;
    world: string;
}

function isResquestPresenceLocationData(data: any): data is IResquestPresenceLocationData {
    if (!isResquestPresenceData(data)) return false;
    let next = data as IResquestPresenceData & { [key: string]: any };
    return next.type === 'location'
        && typeof next.mode === 'string'
        && ['join', 'leave'].includes(next.mode)
        && typeof next.instance === 'string'
        && typeof next.world === 'string';
}


export interface IMakePresenceResponse {
    to: string[];
}