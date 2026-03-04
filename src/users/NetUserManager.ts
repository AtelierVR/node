import { request } from "undici";
import Main from "../Main";
import NetServer from "../server/NetServer";
import { ServerManager } from "../server/ServerManager";
import NetUser from "./NetUser";
import { IRUser } from "./UserAPIWeb";
import UserManager from "./UserManager";
import { NetUser as INetUser } from "@prisma/client";
import { Regex } from "../utils/Constants";
import { isValidURL } from "../utils/Utils";
import Debug from "../utils/Debug";

export default class NetUserManager {
    constructor(private readonly app: Main) { }

    async findNetUserById(id: number, server: number): Promise<NetUser | null> {
        if (!UserManager.isValidId(id) || !ServerManager.isValidId(server)) return null;
        let user: INetUser | null = null;
        try {
            user = await this.app.database.netUser.findUnique({ where: { id_server_id: { id: Number(id), server_id: Number(server) } } });
        } catch { }
        return !user ? null : new NetUser(user, this.app);
    }

    async findOrFetch(user_ref: number | string, server: NetServer): Promise<NetUser | null> {
        let id: number;
        if (typeof user_ref === 'number') id = user_ref;
        else {
            let user = await this.fetchNetUserInfos(user_ref, server);
            if (!user) return null;
            id = user.id;
        }
        return await this.findNetUserById(id, server.id)
            || await this.createNetUser(id, server);
    }


    async findNetUsersByIdAndAddress(users: { id: number, server: string }[]): Promise<NetUser[]> {
        try {
            let netUsers: INetUser[] = await this.app.database.netUser.findMany({
                where: {
                    OR: users.map(user => ({
                        id: user.id,
                        server: { address: user.server }
                    }))
                }
            });
            return netUsers.map(user => new NetUser(user, this.app));
        } catch { }
        return [];
    }

    checkUserInfos(user: any): user is IRUser {
        return typeof user.id === 'number' && UserManager.isValidId(user.id)
            && typeof user.username === 'string' && Regex.Username.test(user.username)
            && typeof user.display === 'string' && Regex.Display.test(user.display)
            && typeof user.server === 'string'
            && (user.bio === null || typeof user.bio === 'string')
            && Array.isArray(user.tags)
            && (user.thumbnail === null || (typeof user.thumbnail === 'string' && isValidURL(user.thumbnail)))
            && (user.banner === null || (typeof user.banner === 'string' && isValidURL(user.banner)))
            && Array.isArray(user.links) && user.links.every((link: any) => typeof link === 'string' && isValidURL(link))
            && typeof user.rank === 'number' && user.rank >= 0 && user.rank < 1;
    }

    async fetchNetUserInfos(user_ref: number | string, server: NetServer, fingerprint?: string): Promise<IRUser | null> {
        try {
            let nsData = await server.fetchInfos();
            if (!nsData) return null;
            let url = nsData.gateways.http;
            url.pathname = `/api/users/${user_ref}`;
            if (fingerprint) url.searchParams.set('fp', fingerprint);
            let res = await request(url, {
                headers: {
                    ...this.app.server.defaultHeaders,
                    ...await server.requestHeaders()
                }
            });
            if (res.statusCode !== 200) return null;
            let body = await res.body.json() as { data?: IRUser, error?: any };
            if (!body.data || body.error || !this.checkUserInfos(body.data)) return null;
            return body.data;
        } catch (e) {
            Debug.error(e);
            return null;
        }
    }

    async createNetUser(user_id: number, server: NetServer): Promise<NetUser | null> {
        try {
            let user = await this.app.database.netUser.create({
                data: {
                    id: user_id,
                    server_id: server.id
                }
            });
            return new NetUser(user, this.app);
        } catch { }
        return null;
    }
}

export interface IMakeNetUser {

}