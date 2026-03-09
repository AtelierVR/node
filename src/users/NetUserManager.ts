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
            if (user instanceof Error) {
                Debug.error(`Failed to fetch user infos for reference ${user_ref} on server ${server.address}: ${user.message}`);
                return null;
            }
            
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

    async fetchNetUserInfos(user_ref: number | string, server: NetServer, fingerprint?: string): Promise<IRUser | Error> {
        let url = new URL(`/api/users/${user_ref}`, `http://${server.address}`);
        if (fingerprint) url.searchParams.set('fp', fingerprint);
        const res = await server.fetch<IRUser>(url, 'users/info_response');
        if (res.error) return new Error(res.error.message);
        if (!res.data) return new Error('No data received');
        return res.data;
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