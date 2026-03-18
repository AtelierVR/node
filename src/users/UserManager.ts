import Reileta from "../Main";
import { User as IUser } from "@prisma/client";
import UserAPIWeb from "./UserAPIWeb";
import User, { IUserLink } from "./User";
import {  Regex, UserTagOverrides } from "../utils/Constants";
import UserIdentifier from "./UserIdentifier";
import { join } from "node:path";
import { cwd } from "node:process";
import { hash, sha256 } from "../utils/Utils";
import { Security } from "../utils/Security";
import Debug from "../utils/Debug";

export default class UserManager {
    constructor(private readonly app: Reileta) {
        this.api_web = new UserAPIWeb(app, this);
    }

    api_web: UserAPIWeb;

    static isValidId(id: number): boolean {
        return id >= 0n && id < (1n << 32n);
    }


    async searchUsers(search: SearchData, ilimit: number, ioffset: number) {
        let users: IUser[] = [];
        let total: number = 0;

        let locals_users = search.users?.filter(u => u.isLocal()) || [];
        let users_usernames = locals_users.filter(u => u.isUsername()).map(u => u.identifier as string) || [];
        let users_ids = locals_users.filter(u => !u.isUsername()).map(u => u.identifier as number) || [];

        try {
            var query: any = {
                OR: [
                    ...(search.query ? [
                        { username: { contains: (search.query as string), mode: 'insensitive' } },
                        { display: { contains: search.query as string, mode: 'insensitive' } }
                    ] : []),
                    ...(users_usernames.length > 0 ? [{ username: { in: users_usernames } }] : []),
                    ...(users_ids.length > 0 ? [{ id: { in: users_ids } }] : [])
                ]
            };

            users = await this.app.database.user.findMany({
                where: query,
                orderBy: search.query ? {
                    _relevance: {
                        fields: ["username", "display"],
                        search: search.query,
                        sort: "desc",
                    }
                } : undefined,
                skip: ioffset,
                take: ilimit
            });

            total = await this.app.database.user.count({ where: query });
        } catch { }

        return { users: users.map(user => new User(user, this.app)), total };
    }

    async hasFingerprint(id: number, fingerprint: string): Promise<boolean> {
        if (!UserManager.isValidId(id)) return false;
        try {
            let count = await this.app.database.session.count({ where: { user_id: id, fingerprint } });
            return count > 0;
        } catch { }
        return false;
    }

    async findUserById(id: number): Promise<User | null> {
        if (!UserManager.isValidId(id)) return null;
        let user: IUser | null = null;
        try {
            user = await this.app.database.user.findUnique({ where: { id: Number(id) } });
        } catch { }
        return !user ? null : new User(user, this.app);
    }

    async findUsersByIds(ids: number[]): Promise<User[]> {
        let users: IUser[] = [];
        try {
            users = await this.app.database.user.findMany({ where: { id: { in: ids } } });
        } catch { }
        return users.map(user => new User(user, this.app));
    }

    async findUserByUsername(username: string): Promise<User | null> {
        if (!Regex.Username.test(username)) return null;
        let user: IUser | null = null;
        try {
            user = await this.app.database.user.findUnique({ where: { username } });
        } catch { }
        return !user ? null : new User(user, this.app);
    }

    async findUserByEmail(email: string): Promise<User | null> {
        if (!Regex.Email.test(email)) return null;
        let user: IUser | null = null;
        try {
            user = await this.app.database.user.findUnique({ where: { email } });
        } catch { }
        return !user ? null : new User(user, this.app);
    }

    async findUsersByTag(tag: string): Promise<User[]> {
        let users: IUser[] = [];
        try {
            users = await this.app.database.user.findMany({ where: { tags: { has: tag } } });
        } catch { }
        return users.map(user => new User(user, this.app));
    }

    async createUser(data: CreateUser): Promise<User | null> {
        try {
            let cert = Security.generateSubCertificate(data.username, `${data.username}@${this.app.server.getInfos().address}`, 1);
            let user = await this.app.database.user.create({
                data: {
                    ...data,
                    display: data.display || data.username,
                    password: data.password ? hash(data.password) : null,
                    blacklisted: { value: false },
                    cert_blob: Security.certificateToDer(cert),
                    cert_expires: cert.validity.notAfter,
                    key_blob: Security.privateKeyToDer(Security.privateKey),
                }
            })
            return new User(user, this.app);
        } catch (e) { Debug.log(e); }
        return null;
    }

    static getOverallTags(tags: string[]): string[] {
        var ended = false;
        while (!ended) {
            ended = true;
            for (let i = 0; i < UserTagOverrides.length; i++) {
                let overHide = UserTagOverrides[i];
                if (overHide.tags.every(tag => tags.includes(tag))) {
                    tags = tags.filter(tag => !overHide.tags.includes(tag));
                    tags.push(overHide.overHide);
                    ended = false;
                }
            }
        }
        tags = tags.reduce<string[]>((acc, tag) => {
            if (!acc.includes(tag)) acc.push(tag);
            return acc;
        }, []);
        return tags;
    }

    async deleteUser(id: number): Promise<boolean> {
        if (!UserManager.isValidId(id)) return false;
        try {
            await this.app.database.user.delete({ where: { id } });
            return true;
        } catch { }
        return false;
    }

    async updateUser(user: User): Promise<User | null> {
        try {
            let updated = await this.app.database.user.update({
                where: { id: user.id },
                data: {
                    bio: user.bio || null,
                    home_ref: user.getHomeRef()?.toString() || null,
                    avatar_ref: user.avatar_ref || null,
                    id: user.id,
                    username: user.username,
                    display: user.display,
                    links: user.links as any,
                    email: user.email,
                    email_verified: user.email_verified,
                    password: user.password,
                    rank: user.rank,
                    created_at: user.created_at,
                    updated_at: user.updated_at,
                    tags: user.tags,
                    thumbnail: user.thumbnail || null,
                    banner: user.banner || null,
                    blacklisted: user.blacklisted || { value: false },
                    twofa_enabled: user.twofa_enabled,
                    twofa_secret: user.twofa_secret,
                    pronoun: user.pronoun || null,
                    presence: user.presence,
                    presence_status: user.presence_status || null,
                }
            });
            return new User(updated, this.app);
        } catch (e) { Debug.log(e); }
        return null;
    }

    static AssetFolder = join(cwd(), 'assets');
}

export interface CreateUser {
    id?: number;
    username: string;
    display?: string;
    email?: string;
    password: string;
    thumbnail?: string;
    banner?: string;
}

import { PresenceStatus } from "@prisma/client";

export interface IUpdateUser {
    username?: string;
    display?: string;
    bio?: string | null;
    email?: string | null;
    password?: string;
    current_password?: string;
    factor_code?: string;
    thumbnail?: string | null;
    banner?: string | null;
    pronoun?: string | null;
    links?: IUserLink[];
    tags?: string[];
    home?: string | null;
    avatar?: string | null;
    presence?: PresenceStatus;
    presence_status?: string | null;
}

export interface SearchData {
    query?: string;
    users?: UserIdentifier[];
}