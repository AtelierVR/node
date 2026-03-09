import { $Enums, UserRelation as IUserRelation, UserRelationType } from "@prisma/client";
import Reileta from "../Main";
import User from "../users/User";
import RelationAPIWeb, { IMakeRelationRequest, IMakeRelationResponse } from "./RelationAPIWeb";
import UserIdentifier from "../users/UserIdentifier";
import UserRelation from "./Relation";
import NetUser from "../users/NetUser";
import { request } from "undici";
import Debug from "../utils/Debug";

export default class RelationManager {

    api_web: RelationAPIWeb;

    constructor(private readonly app: Reileta) {
        this.api_web = new RelationAPIWeb(this.app, this);
    }

    async getFollowers(user: User, limit: number, offset: number) {
        let followers: IUserRelation[] = [];
        let total: number = 0;
        try {
            let query = {
                target_ref: new UserIdentifier(user.id).toString(),
                type: $Enums.UserRelationType.FOLLOW
            };
            followers = await this.app.database.userRelation.findMany({
                where: query,
                orderBy: { created_at: 'desc' },
                skip: offset,
                take: limit
            });
            total = await this.app.database.userRelation.count({ where: query });
        } catch { }
        return { followers: followers.map(follower => new UserRelation(follower, this.app)), total };
    }

    async getFollowing(user: User, limit: number, offset: number) {
        let following: IUserRelation[] = [];
        let total: number = 0;
        try {
            let query = {
                initiator_ref: new UserIdentifier(user.id).toString(),
                type: $Enums.UserRelationType.FOLLOW
            };
            following = await this.app.database.userRelation.findMany({
                where: query,
                orderBy: { created_at: 'desc' },
                skip: offset,
                take: limit
            });
            total = await this.app.database.userRelation.count({ where: query });
        } catch { }
        return {
            following: following.map(follower => new UserRelation(follower, this.app)),
            total
        };
    }

    async getFollowersCount(user: User): Promise<number> {
        try {
            let query = {
                target_ref: new UserIdentifier(user.id).toString(),
                type: $Enums.UserRelationType.FOLLOW
            };
            return await this.app.database.userRelation.count({ where: query });
        } catch {
            return 0;
        }
    }

    async getFollowingCount(user: User): Promise<number> {
        try {
            let query = {
                initiator_ref: new UserIdentifier(user.id).toString(),
                type: $Enums.UserRelationType.FOLLOW
            };
            return await this.app.database.userRelation.count({ where: query });
        } catch {
            return 0;
        }
    }

    async getRelation(user: User | NetUser, target: User | NetUser) {
        let relation: IUserRelation | null = null;
        try {
            relation = await this.app.database.userRelation.findFirst({
                where: {
                    initiator_ref: new UserIdentifier(user.id).toString(),
                    target_ref: new UserIdentifier(target.id).toString()
                }
            });
        } catch { }
        return relation ? new UserRelation(relation, this.app) : null;
    }

    async requestLocalRequest(user: User, target: User, accept: boolean): Promise<UserRelation | null | false> {
        // user accept/reject follow request from target
        let a = await this.getRelation(target, user);

        if (!a || a.type !== UserRelationType.REQUEST)
            return null;

        if (accept) {
            a.type = UserRelationType.FOLLOW;
            await a.update();
            return a;
        }

        await a.delete();
        return false;
    }

    async requestNetRequest(user: User, target: NetUser, accept: boolean): Promise<UserRelation | null | false> {
        // user accept/reject follow request from target
        try {
            let relation = await this.getRelation(target, user);

            if (!relation || relation.type !== UserRelationType.REQUEST)
                return null;

            let body: IMakeRelationRequest = {
                type: accept ? 'follow_accept' : 'follow_refuse',
                initiator: user.id,
                target: target.id
            }
            let server = await target.getNetServer();
            let infos = await server.fetchInfos();
            if (!infos) return null;
            let response = await request(new URL('/api/relation', infos.gateways.http), {
                method: 'POST',
                headers: {
                    ...this.app.server.defaultHeaders,
                    ...await server.requestHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });
            if (response.statusCode !== 200) return null;
            var response_data = await response.body.json() as { data?: IMakeRelationResponse, error?: any };
            if (response_data.error || !response_data.data) return null;

            if (response_data.data.type !== 'ok')
                return false;

            for (let s of await user.getSockets())
                s.sendData(accept ? 'new_following' : 'reject_following', { user: target.toIdentifier().toString(), dev: 10 });
            relation.type = UserRelationType.FOLLOW;
            await relation.update();
            return relation;
        } catch { }
        return null;
    }

    async requestLocalFollow(user: User, target: User): Promise<UserRelation | Error | false> {
        if (target.useAutoRejectFollow())
            return false;
        if (target.useManualFollowValidation()) {
            for (let s of await target.getSockets())
                s.emitData('request_follower_received', { user: user.toIdentifier().toString(), dev: 9 });
            for (let s of await user.getSockets())
                s.emitData('request_following_sent', { user: target.toIdentifier().toString(), dev: 8 });
            return await this.createRelation(user, target, UserRelationType.REQUEST); // user request target
        }
        for (let s of await target.getSockets())
            s.emitData('new_follower', { user: user.toIdentifier().toString(), dev: 7 });
        for (let s of await user.getSockets())
            s.emitData('new_following', { user: target.toIdentifier().toString(), dev: 6 });
        return await this.createRelation(user, target, UserRelationType.FOLLOW); // user follow target
    }

    async requestFollowedByNet(user: NetUser, target: User): Promise<UserRelation | Error | false> {
        if (target.useAutoRejectFollow())
            return false;
        if (target.useManualFollowValidation()) {
            for (let s of await target.getSockets())
                s.emitData('request_follower_received', { user: user.toIdentifier().toString(), dev: 5 });
            return await this.createRelation(user, target, UserRelationType.REQUEST); // user request target
        }
        for (let s of await target.getSockets())
            s.emitData('new_follower', { user: user.toIdentifier().toString(), dev: 4 });
        return await this.createRelation(user, target, UserRelationType.FOLLOW); // user follow target
    }

    async requestNetFollow(user: User, target: NetUser): Promise<UserRelation | Error | false> {
        try {
            let body: IMakeRelationRequest = {
                type: 'follow',
                initiator: user.id,
                target: target.id
            }

            let server = await target.getNetServer();
            let infos = await server.fetchInfos();
            if (!infos)
                return new Error("Failed to fetch server infos");

            let response = await server.fetch<IMakeRelationResponse>('/api/relations', 'relations/update_response', {
                method: 'POST',
                body
            });

            if (response.error || !response.data)
                return new Error(response.error?.message || "Invalid response from server");

            if (response.data.type === 'follow_rejected') {
                for (let s of await user.getSockets())
                    s.sendData('reject_following', { user: target.toIdentifier().toString(), dev: 3 });
                return false;
            }

            let u: UserRelation | Error = new Error("Unknown response type");

            if (response.data.type === 'follow_accepted') {
                u = await this.createRelation(user, target, UserRelationType.FOLLOW);
                for (let s of await user.getSockets())
                    s.emitData('new_following', { user: target.toIdentifier().toString(), dev: 1 });
            } else if (response.data.type === 'follow_pending') {
                u = await this.createRelation(user, target, UserRelationType.REQUEST);
                for (let s of await user.getSockets())
                    s.emitData('request_following_sent', { user: target.toIdentifier().toString(), dev: 2 });
            }

            return u;
        } catch (e) {
            Debug.error(e);
            return new Error("Failed to request net follow");
        }
    }

    async createRelation(user: User | NetUser, target: User | NetUser, type: $Enums.UserRelationType) {
        try {
            let relation = await this.app.database.userRelation.create({
                data: {
                    initiator_ref: (await user.toIdentifier()).toString(),
                    target_ref: (await target.toIdentifier()).toString(),
                    type: type
                }
            });
            return new UserRelation(relation, this.app);
        } catch (e) {
            Debug.error(e);
            return new Error("Failed to create relation");
        }
    }

    async deleteRelation(id: string): Promise<boolean> {
        try {
            await this.app.database.userRelation.delete({ where: { id } });
            return true;
        } catch { }
        return false;
    }

    async updateRelation(arg0: UserRelation): Promise<boolean> {
        try {
            await this.app.database.userRelation.update({
                where: { id: arg0.id },
                data: {
                    initiator_ref: arg0.initiatorRef.toString(),
                    target_ref: arg0.targetRef.toString(),
                    type: arg0.type
                }
            });
            return true;
        } catch { }
        return false;
    }

    async requestLocalUnfollow(user: User, target: User) {
        let relation = await this.getRelation(user, target);
        if (!relation || (relation.type !== UserRelationType.FOLLOW && relation.type !== UserRelationType.REQUEST))
            return null;

        if (relation.type === UserRelationType.REQUEST) {
            for (let s of await user.getSockets())
                s.emitData('request_following_canceled', { user: target.toIdentifier().toString(), dev: 13 });
            for (let s of await target.getSockets())
                s.emitData('request_follower_canceled', { user: user.toIdentifier().toString(), dev: 14 });
        } else if (relation.type === UserRelationType.FOLLOW) {
            for (let s of await user.getSockets())
                s.emitData('remove_following', { user: target.toIdentifier().toString(), dev: 11 });
            for (let s of await target.getSockets())
                s.emitData('remove_follower', { user: user.toIdentifier().toString(), dev: 12 });
        }


        return await relation.delete();
    }

    async requestNetUnfollow(user: User, target: User | NetUser) {
        return null;
    }
}