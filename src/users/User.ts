import { User as IUser, Prisma, PresenceStatus } from "@prisma/client";
import UserIdentifier from "./UserIdentifier";
import UserManager from "./UserManager";
import { hasTag, isValidURL } from "../utils/Utils";
import Main from "../Main";
import WorldIdentifier from "../worlds/WorldIdentifier";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import Env from "../utils/Environment";
import { Security } from "../utils/Security";
import AvatarIdentifier from "../avatars/AvatarIdentifier";
import { get } from "node:http";

export interface IUserLink {
    label: string;
    value: string;
}

export default class User implements Omit<IUser, 'links'> {
    constructor(user: IUser, private readonly app: Main) {
        this.id = user.id;
        this.username = user.username;
        this.display = user.display;
        this.links = user.links;
        this.email = user.email;
        this.email_verified = user.email_verified;
        this.password = user.password;
        this.rank = user.rank;
        this.tags = user.tags;
        this.thumbnail = user.thumbnail;
        this.banner = user.banner;
        this.blacklisted = user.blacklisted;
        this.home_ref = user.home_ref;
        this.avatar_ref = user.avatar_ref;
        this.pronoun = user.pronoun;
        this.bio = user.bio;
        this.created_at = user.created_at;
        this.updated_at = user.updated_at;
        this.twofa_enabled = user.twofa_enabled;
        this.twofa_secret = user.twofa_secret;
        this.cert_blob = user.cert_blob;
        this.cert_expires = user.cert_expires;
        this.key_blob = user.key_blob;
        this.presence = user.presence;
        this.presence_status = user.presence_status;
    }

    created_at: Date;
    updated_at: Date;
    bio: string | null;
    home_ref: string | null;
    avatar_ref: string | null;
    pronoun: string | null;
    id: number;
    username: string;
    display: string;
    links: Prisma.JsonValue;
    email: string | null;
    email_verified: boolean;
    password: string | null;
    rank: number;
    tags: string[];
    thumbnail: string | null;
    banner: string | null;
    blacklisted: Prisma.JsonValue;
    twofa_enabled: boolean;
    twofa_secret: string | null;
    cert_blob: Uint8Array<ArrayBufferLike>;
    key_blob: Uint8Array<ArrayBufferLike>;
    cert_expires: Date;
    presence: PresenceStatus;
    presence_status: string | null;

    get publicCertificate() {
        return Security.derToCertificate(this.cert_blob);
    }

    get publicKey() {
        return this.publicCertificate.publicKey;
    }

    get privateKey() {
        return Security.derToPrivateKey(this.key_blob);
    }

    getBanner(base: URL): URL | null {
        if (this.isLocalBanner()) {
            var s = statSync(this.getLocalBannerPath() as string);
            var u = new URL(`/api/users/${this.id}/banner`, base);
            u.searchParams.set('t', s.mtime.getTime().toString());
            return u;
        }

        if (this.banner)
            try {
                return new URL(this.banner);
            } catch { }
        return null;
    }

    getThumbnail(base: URL): URL | null {
        if (this.isLocalThumbnail()) {
            var s = statSync(this.getLocalThumbnailPath() as string);
            var u = new URL(`/api/users/${this.id}/thumbnail`, base);
            u.searchParams.set('t', s.mtime.getTime().toString());
            return u;
        }

        if (this.thumbnail)
            try {
                return new URL(this.thumbnail);
            } catch { }
        return null;
    }

    getLocalThumbnailPath(): string | null {
        if (this.isLocalThumbnail())
            return join(UserManager.AssetFolder, this.app.storage.files.urlToKey(this.thumbnail as string));
        return null;
    }

    isLocalThumbnail(): boolean {
        return this.app.storage.files.isLocalFile(this.thumbnail ?? '');
    }

    isLocalBanner(): boolean {
        return this.app.storage.files.isLocalFile(this.banner ?? '');
    }

    getLocalBannerPath(): string | null {
        if (this.isLocalBanner())
            return join(UserManager.AssetFolder, this.app.storage.files.urlToKey(this.banner as string));
        return null;
    }

    getTags(): string[] {
        return UserManager.getOverallTags([
            ...this.tags,
            ...Env.getDefaultUserTags(),
            ...(this.rank === 0 ? ['sys:unverified'] : []),
            ...(this.getBlacklist() ? ['sys:blacklisted'] : [])
        ]);
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

    getHomeRef(): WorldIdentifier | null {
        if (!this.home_ref) return null;
        return WorldIdentifier.fromString(this.home_ref);
    }

    getAvatarRef(): AvatarIdentifier | null {
        if (!this.avatar_ref) return null;
        return AvatarIdentifier.fromString(this.avatar_ref);
    }

    getLinks(): IUserLink[] {
        if (!this.links || !Array.isArray(this.links)) return [];
        return (this.links as unknown as IUserLink[]).filter(l =>
            l &&
            typeof l === 'object' &&
            'label' in l &&
            'value' in l &&
            typeof l.label === 'string' &&
            typeof l.value === 'string' &&
            isValidURL(l.value)
        );
    }

    getLinksAsStringArray(): string[] {
        return this.getLinks().map(l => l.value);
    }

    toIdentifier(): UserIdentifier {
        return new UserIdentifier(this.id, undefined);
    }

    toUsernameIdentifier(): UserIdentifier {
        return new UserIdentifier(this.username)
    }

    async alias() {
        var infos = this.app.server.getInfos();
        return [
            {
                key: "profile",
                value: `${infos.gateways.web.origin}/u/${this.username}`
            },
            {
                key: "api",
                value: `${infos.gateways.http.origin}/api/users/${this.id}`
            },
            {
                key: "iid",
                value: (await this.toIdentifier()).toString(infos.address)
            },
            {
                key: "uid",
                value: (this.toUsernameIdentifier()).toString(infos.address)
            }
        ]
    }

    canCreateWorld() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_world_create') && this.getBlacklist() === null;
    }

    canCreateWorldAsset() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_world_asset_create') && this.getBlacklist() === null;
    }

    canDeleteWorld() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_world_delete') && this.getBlacklist() === null;
    }

    canUpdateWorld() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_world_edit') && this.getBlacklist() === null;
    }

    canUpdateWorldAsset() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_world_asset_update') && this.getBlacklist() === null;
    }

    canUploadWorldAssetFile() {
        return this.isAdmin() || this.canUploadFile() && this.canUpdateWorldAsset();
    }

    canUploadFile() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_file_upload') && this.getBlacklist() === null;
    }

    canUpdateUser() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_self_edit') && this.getBlacklist() === null;
    }

    canCreateInstance() {
        return this.isAdmin() || hasTag(this.getTags(), 'sys:can_instance_create') && this.getBlacklist() === null;
    }

    canFetchExternal() {
        return this.isAdmin() || hasTag(this.getTags(), 'dft:fetch_external') && this.getBlacklist() === null;
    }

    isAdmin() {
        return this.id === Env.getAdminId() || hasTag(this.getTags(), 'sys:admin');
    }

    async update(): Promise<User | null> {
        let user = await this.app.users.updateUser(this);
        if (!user) return null;
        return this;
    }

    getSockets() {
        return this.app.http.socket.getSocketsByUserId(this.id);
    }

    useManualFollowValidation() {
        return hasTag(this.getTags(), 'sys:manual_follow_validation');
    }

    useAutoRejectFollow() {
        return hasTag(this.getTags(), 'sys:auto_reject_follow');
    }

    setThumbnailFile(file: Express.Multer.File, hash: string) {
        try {
            if (!existsSync(UserManager.AssetFolder)) mkdirSync(UserManager.AssetFolder);
            let ext = file.originalname.split('.').pop();
            let type = file.mimetype.split('/').pop();
            let p = `${hash}-${type}.${ext}`;
            copyFileSync(file.path, join(UserManager.AssetFolder, p));
            rmSync(file.path);
            this.thumbnail = this.app.storage.files.keyToUrl(p);
            return true;
        } catch (e) {
            return false
        }
    }

    getFileInfos(path: string) {
        let matchs = path.match(/file:\/\/([a-f0-9]+)-([a-z0-9]+).([a-z0-9]+)/);
        if (!matchs) return null;
        return {
            hash: matchs[1],
            type: matchs[2],
            ext: matchs[3]
        };
    }

    setBannerFile(file: Express.Multer.File, hash: string) {
        try {
            if (!existsSync(UserManager.AssetFolder)) mkdirSync(UserManager.AssetFolder);
            let ext = file.originalname.split('.').pop();
            let type = file.mimetype.split('/').pop();
            let p = `${hash}-${type}.${ext}`;
            copyFileSync(file.path, join(UserManager.AssetFolder, p));
            rmSync(file.path);
            this.banner = this.app.storage.files.keyToUrl(p);
            return true;
        } catch (e) {
            return false
        }
    }


    hasFingerprint(fingerprint: string): Promise<boolean> {
        return this.app.users.hasFingerprint(this.id, fingerprint);
    }

    async getFollowersCount(): Promise<number> {
        if (hasTag(this.getTags(), 'usr:hide_followers'))
            return -1;
        return await this.app.relations.getFollowersCount(this);
    }

    async getFollowingCount(): Promise<number> {
        if (hasTag(this.getTags(), 'usr:hide_following'))
            return -1;
        return await this.app.relations.getFollowingCount(this);
    }
}

export interface IUserBlacklist {
    reason: string;
    expires: Date;
    by_id: number;
    createdAt: Date;
    updatedAt: Date;
}
