import RelationManager from "./RelationManager";
import NetExpress, { Request, Response } from "../network/NetExpress";
import Reileta from "../Main";
import { ErrorMessage } from "../utils/Utils";
import { ErrorCodes } from "../utils/Constants";
import User from "../users/User";
import UserIdentifier from "../users/UserIdentifier";
import NetServer from "../server/NetServer";
import NetUser from "../users/NetUser";
import { UserRelationType } from "@prisma/client";
import UserManager from "../users/UserManager";
import Express from "express";
import Debug from "../utils/Debug";

export default class RelationAPIWeb {
    constructor(private readonly app: Reileta, private readonly manager: RelationManager) {
        this.app.http.express.server.get('/api/relations/@me/following', (req: any, res) => this.handleMyFollowing(req as Request<{ search: string }>, res as Response));
        this.app.http.express.server.get('/api/relations/@me/followers', (req: any, res) => this.handleMyFollowers(req as Request<{ search: string }>, res as Response));
        this.app.http.express.server.get('/api/relations/:id/following', (req: any, res) => this.handleFollowing(req as Request<{ search: string }>, res as Response));
        this.app.http.express.server.get('/api/relations/:id/followers', (req: any, res) => this.handleFollowers(req as Request<{ search: string }>, res as Response));

        this.app.http.express.server.post('/api/relations/:id/follow', (req, res) => this.handleFollow(req as Request<{ id: string }>, res as Response));
        this.app.http.express.server.post('/api/relations/:id/unfollow', (req, res) => this.handleUnfollow(req as Request<{ id: string }>, res as Response));
        this.app.http.express.server.post('/api/relations/:id/request', Express.json(), NetExpress.validate('relations/request'), (req, res) => this.handleRequest(req as Request<{ id: string }>, res as Response));

        this.app.http.express.server.post('/api/relations', Express.json(), NetExpress.validate('relations/update'), (req, res) => this.handleRelation(req as Request, res as Response));
    }

    async handleRequest(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const initiator = await request.data.getData() as User | null;
        if (!initiator) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const { type } = request.body as IRequestRelationRequest;
        if (!type || !['accept', 'reject'].includes(type))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));

        let iden = UserIdentifier.fromString(request.params.id);
        let target: NetUser | User | null = null;

        if (iden.isLocal()) {
            if (iden.isUsername())
                target = await this.app.users.findUserByUsername(iden.identifierAsUsername());
            else target = await this.app.users.findUserById(iden.identifierAsId());
        } else {
            let server = await this.app.netServers.findOrInitServer(iden.server as string);
            if (!(server instanceof NetServer))
                return response.send(new ErrorMessage(ErrorCodes.ServerNotFound, server.message));
            target = await this.app.netUsers.findOrFetch(iden.identifier, server);
        }

        if (!target)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (target instanceof User && target.id === initiator.id)
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));

        let relation = target instanceof User
            ? await this.manager.requestLocalRequest(initiator, target, type === 'accept') // user follow target
            : await this.manager.requestNetRequest(initiator, target, type === 'accept'); // user follow netTarget

        if (relation === false && type === 'reject')
            return response.send({
                type: 'rejected',
                success: true
            });
        else if (relation && type === 'accept')
            return response.send({
                type: 'accepted',
                success: true
            });

        return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));
    }

    async handleRelation(request: Request, response: Response) {
        let { type, initiator, target } = request.body as IMakeRelationRequest;

        if (!type || typeof type !== 'string' || !['follow', 'unfollow'].includes(type))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));

        if (!UserManager.isValidId(initiator) || !UserManager.isValidId(target))
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));

        if (!request.data.isChallenge())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        let server = await request.data.getData() as NetServer | null;
        if (!server) return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));

        let userTarget = await this.app.users.findUserById(target);
        if (!userTarget) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        let userInit = await this.app.netUsers.findOrFetch(initiator, server);
        if (!userInit) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let relation = await this.manager.getRelation(userInit, userTarget);

        if (!relation && type === 'follow') {
            let rel = await this.manager.requestFollowedByNet(userInit, userTarget);
            if (rel === false)
                return response.send<IMakeRelationResponse>({
                    type: 'follow_rejected',
                    note: 'you cannot follow this user',
                    retryAfter: 0
                });
            else if (rel instanceof Error)
                return response.send<IMakeRelationResponse>({
                    type: 'error',
                    note: rel.message,
                    retryAfter: 0
                });
            else if (rel.type === UserRelationType.FOLLOW)
                return response.send<IMakeRelationResponse>({
                    type: 'follow_accepted'
                });
            else if (rel.type === UserRelationType.REQUEST)
                return response.send<IMakeRelationResponse>({
                    type: 'follow_pending',
                    retryAfter: 5 * 60 * 1000 // 5 minutes
                });
            return response.send<IMakeRelationResponse>({
                type: 'error',
                retryAfter: 0
            });
        }

        if (relation && type === 'follow')
            return response.send<IMakeRelationResponse>({
                type: 'error',
                note: 'you are already following this user',
                retryAfter: 0
            });

        // handle unfollow
        if (!relation && type === 'unfollow')
            return response.send<IMakeRelationResponse>({
                type: 'error',
                note: 'you cannot unfollow someone you do not follow',
                retryAfter: 0
            });

        if (relation && type === 'unfollow') {
            if (!await relation.delete())
                return response.send<IMakeRelationResponse>({
                    type: 'error',
                    note: 'internal error',
                    retryAfter: 0
                });
            return response.send<IMakeRelationResponse>({
                type: 'unfollow_accepted'
            });
        }

        return response.send<IMakeRelationResponse>({
            type: 'error',
            note: 'not a valid request',
            retryAfter: 0
        });
    }

    async handleFollowing(request: Request<{ search: string }>, response: Response) {
        var { limit, offset } = request.query;

        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '100';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';

        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);

        if (ilimit > 1000) ilimit = 1000;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        let iden = UserIdentifier.fromString(request.params.search);
        if (!iden.isLocal())
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        let user: User | null = null;
        if (iden.isUsername())
            user = await this.app.users.findUserByUsername(iden.identifierAsUsername());
        else user = await this.app.users.findUserById(iden.identifierAsId());
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let following = await this.manager.getFollowing(user, ilimit, ioffset);
        let address = this.app.server.getInfos().address;

        return response.send({
            total: following.total,
            limit: ilimit,
            offset: ioffset,
            following: following.following.map(f => f.targetRef.toString(address))
        });
    }

    async handleMyFollowing(request: Request<{ search: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        var { limit, offset } = request.query;

        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '100';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';

        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);

        if (ilimit > 1000) ilimit = 1000;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        let following = await this.manager.getFollowing(user, ilimit, ioffset);
        let address = this.app.server.getInfos().address;

        return response.send({
            total: following.total,
            limit: ilimit,
            offset: ioffset,
            following: following.following.map(f => ({
                user: f.targetRef.toString(address),
                at: f.created_at.getTime()
            }))
        });
    }

    async handleMyFollowers(request: Request<{ search: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        var { limit, offset } = request.query;

        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '100';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';

        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);

        if (ilimit > 1000) ilimit = 1000;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        let followers = await this.manager.getFollowers(user, ilimit, ioffset);

        let address = this.app.server.getInfos().address;
        return response.send({
            total: followers.total,
            limit: ilimit,
            offset: ioffset,
            followers: followers.followers.map(f => ({
                user: f.initiatorRef.toString(address),
                at: f.created_at.getTime()
            }))
        });
    }

    async handleFollowers(request: Request<{ search: string }>, response: Response) {
        var { limit, offset } = request.query;

        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '100';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';

        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);

        if (ilimit > 1000) ilimit = 1000;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        let iden = UserIdentifier.fromString(request.params.search);
        if (!iden.isLocal())
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        let user: User | null = null;
        if (iden.isUsername())
            user = await this.app.users.findUserByUsername(iden.identifierAsUsername());
        else user = await this.app.users.findUserById(iden.identifierAsId());
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let followers = await this.manager.getFollowers(user, ilimit, ioffset);

        let address = this.app.server.getInfos().address;
        return response.send({
            total: followers.total,
            limit: ilimit,
            offset: ioffset,
            followers: followers.followers.map(f => f.initiatorRef.toString(address))
        });
    }

    async handleFollow(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const initiator = await request.data.getData() as User | null;
        if (!initiator) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        let iden = UserIdentifier.fromString(request.params.id);
        let target: NetUser | User | null = null;

        if (iden.isLocal()) {
            if (iden.isUsername())
                target = await this.app.users.findUserByUsername(iden.identifierAsUsername());
            else target = await this.app.users.findUserById(iden.identifierAsId());
        } else {
            let server = await this.app.netServers.findOrInitServer(iden.server as string);
            if (server instanceof Error) {
                Debug.error(`Failed to find or init server for ${iden.server}:`, server);
                return response.send(new ErrorMessage(ErrorCodes.ServerNotFound, server.message));
            }
            target = await this.app.netUsers.findOrFetch(iden.identifier, server);
        }

        if (!target)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (target instanceof User && target.id === initiator.id)
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));

        let currentRelation = await this.manager.getRelation(initiator, target);
        if (currentRelation)
            return response.send(new ErrorMessage(ErrorCodes.AlreadyExists));

        let relation = target instanceof User
            ? await this.manager.requestLocalFollow(initiator, target) // user follow target
            : await this.manager.requestNetFollow(initiator, target); // user follow netTarget

        if (relation === false)
            return response.send(new ErrorMessage(ErrorCodes.Rejected));
        else if (relation instanceof Error) {
            Debug.error(`Failed to request follow:`, relation);
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "create relation"));
        }

        let address = this.app.server.getInfos().address;
        return response.send<IRelation>({
            id: relation.id,
            type: relation.type.toString(),
            initiator: relation.initiatorRef.toString(address),
            target: relation.targetRef.toString(address),
            created_at: relation.created_at.getTime(),
            updated_at: relation.updated_at.getTime()
        });
    }

    async handleUnfollow(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const initiator = await request.data.getData() as User | null;
        if (!initiator) return response.send(new ErrorMessage(ErrorCodes.UserNotFound));


        let iden = UserIdentifier.fromString(request.params.id);
        let target: NetUser | User | null = null;

        if (iden.isLocal()) {
            if (iden.isUsername())
                target = await this.app.users.findUserByUsername(iden.identifierAsUsername());
            else target = await this.app.users.findUserById(iden.identifierAsId());
        } else {
            let server = await this.app.netServers.findOrInitServer(iden.server as string);
            if (server instanceof Error) {
                Debug.error(`Failed to find or init server for ${iden.server}:`, server);
                return response.send(new ErrorMessage(ErrorCodes.ServerNotFound, server.message));
            }
            target = await this.app.netUsers.findOrFetch(iden.identifier, server);
        }

        if (!target)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        if (target instanceof User && target.id === initiator.id)
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest));

        let unFollowed = target instanceof User
            ? await this.manager.requestLocalUnfollow(initiator, target) // user unfollow target
            : await this.manager.requestNetUnfollow(initiator, target); // user unfollow netTarget

        if (unFollowed === null)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'relation'));

        if (!unFollowed)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "delete relation"));

        return response.send({
            success: true
        });
    }
}

export interface IMakeRelationRequest {
    type: 'follow' | 'unfollow' | 'follow_accept' | 'follow_refuse';
    initiator: number;
    target: number;
}

export interface IMakeRelationResponse {
    type: 'follow_accepted' | 'follow_rejected' | 'follow_pending' | 'unfollow_accepted' | 'error' | 'ok';
    retryAfter?: number;
    note?: string;
}

export interface IRelation {
    id: string;
    type: string;
    initiator: string;
    target: string;
    created_at: number;
    updated_at: number;
}

export interface IMyRelation {

}

interface IRequestRelationRequest {
    type: 'accept' | 'reject';
}