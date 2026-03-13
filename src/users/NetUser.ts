import { NetUser as INetUser, Prisma } from "@prisma/client";
import User, { IUserBlacklist } from "./User";
import Main from "../Main";
import { IRUser } from "./UserAPIWeb";
import UserIdentifier from "./UserIdentifier";
import { hasTag } from "../utils/Utils";
import NetServer from "../server/NetServer";
import Env from "../utils/Environment";

export default class NetUser implements INetUser {
    constructor(user: INetUser, private readonly app: Main) {
        this.id = user.id;
        this.server_id = user.server_id;
        this.rank = user.rank;
        this.blacklisted = user.blacklisted;
        this.last_seen = user.last_seen;
        this.tags = user.tags;
    }

    server_id: number;
    last_seen: Date;
    id: number;
    rank: number;
    blacklisted: Prisma.JsonValue;
    tags: string[];

    getTags(): string[] {
        return [
            ...this.tags,
            ...Env.sync('DEFAULT_NETUSER_TAGS'),
            ...(this.rank === 0 ? ['sys:unverified'] : []),
            ...(this.getBlacklist() ? ['sys:blacklisted'] : [])
        ];
    }

    getBlacklist() {
        if (!this.blacklisted) return null;
        if (typeof this.blacklisted !== 'object') return null;
        if (Array.isArray(this.blacklisted)) return null;
        var blacklist: IUserBlacklist = this.blacklisted as any;
        if (blacklist.reason === undefined) return null;
        if (blacklist.expires > new Date()) return null;
        return blacklist;
    }

    async getNetServer() {
        return await this.app.netServers.findNetServerById(this.server_id) as NetServer;
    }

    async fetchUser(fingerprint?: string, as?: User): Promise<IRUser | Error> {
        let server = await this.getNetServer();
        return server
            ? await this.app.netUsers.fetchNetUserInfos(this.id, server, fingerprint, as)
            : new Error('No server found');
    }

    async toIdentifier(): Promise<UserIdentifier> {
        return new UserIdentifier(this.id, (await this.getNetServer())?.address);
    }

    canCreateWorld() {
        return hasTag(this.getTags(), 'sys:can_world_create') && this.getBlacklist() === null;
    }

    canCreateWorldAsset() {
        return hasTag(this.getTags(), 'sys:can_world_asset_create') && this.getBlacklist() === null;
    }

    canDeleteWorld() {
        return hasTag(this.getTags(), 'sys:can_world_delete') && this.getBlacklist() === null;
    }

    canUpdateWorld() {
        return hasTag(this.getTags(), 'sys:can_world_edit') && this.getBlacklist() === null;
    }

    canUpdateWorldAsset() {
        return hasTag(this.getTags(), 'sys:can_world_asset_update') && this.getBlacklist() === null;
    }

    canUploadWorldAssetFile() {
        return this.canUploadFile() && hasTag(this.getTags(), 'sys:can_world_asset_file');
    }

    canUploadFile() {
        return hasTag(this.getTags(), 'sys:can_upload_file') && this.getBlacklist() === null;
    }

    canCreateInstance() {
        return hasTag(this.getTags(), 'sys:can_instance_create') && this.getBlacklist() === null;
    }
}

