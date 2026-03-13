import { Avatar as IAvatar, AvatarAsset as IRAvatarAsset } from '@prisma/client';
import Main from '../Main';
import AvatarAsset from './AvatarAsset';
import User from '../users/User';
import NetUser from '../users/NetUser';
import { IMakeAvatar, IUpdateAvatar } from './AvatarManager';
import UserIdentifier from '../users/UserIdentifier';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { join } from 'path';
import AvatarManager from './AvatarManager';
import Debug from '../utils/Debug';
import AvatarIdentifier from './AvatarIdentifier';

export default class Avatar implements IAvatar {
    constructor(avatar: IAvatar, private readonly app: Main) {
        this.id = avatar.id;
        this.title = avatar.title;
        this.description = avatar.description;
        this.thumbnail = avatar.thumbnail;
        this.tags = avatar.tags;
        this.owner_ref = avatar.owner_ref;
        this.created_at = avatar.created_at;
        this.updated_at = avatar.updated_at;
    }

    created_at: Date;
    updated_at: Date;
    id: number;
    title: string;
    description: string | null;
    thumbnail: string | null;
    tags: string[];
    owner_ref: string;

    getTags(): string[] {
        return this.tags;
    }

    getThumbnail(): URL | null {
        if (this.thumbnail) {
            if (this.app.storage.files.isLocalFile(this.thumbnail)) {
                // For local files, return a URL pointing to our API endpoint
                try {
                    return new URL(`/api/avatars/${this.id}/thumbnail`, this.app.server.getInfos().gateways.http);
                } catch { }
            } else {
                // For external URLs, return as-is
                try {
                    return new URL(this.thumbnail);
                } catch { }
            }
        }
        return null;
    }

    async getOwner(): Promise<User | NetUser | null> {
        var own = this.OwnerRef;
        if (own.isUsername()) return null;
        if (own.isLocal())
            return await this.app.users.findUserById(own.identifier as number);
        const server = await this.app.netServers.findNetServerByAddress(own.server as string);
        if (!server) return null;
        return await this.app.netUsers.findNetUserById(own.identifier as number, server.id);
    }

    get OwnerRef(): UserIdentifier {
        return UserIdentifier.fromString(this.owner_ref);
    }

    async getAssets(): Promise<AvatarAsset[]> {
        return (await this.app.avatars.findAvatarAssetByAvatarId(this.id)) || [];
    }

    async delete(): Promise<boolean> {
        return await this.app.avatars.deleteAvatar(this.id);
    }

    async save(): Promise<boolean> {
        try {
            await this.app.database.avatar.update({
                where: { id: this.id },
                data: {
                    title: this.title,
                    description: this.description,
                    thumbnail: this.thumbnail,
                    tags: this.tags,
                    updated_at: new Date()
                }
            });
        } catch { return false; }
        return true;
    }

    async IsOwner(user: User): Promise<boolean> {
        var identifier = (await user.toIdentifier()).toString(this.app.server.getInfos().address);
        var ref = this.OwnerRef.toString(this.app.server.getInfos().address);
        return identifier === ref;
    }

    get ownerIdentifier(): UserIdentifier {
        return UserIdentifier.fromString(this.owner_ref);
    }

    isLocalThumbnail(): boolean {
        return this.app.storage.files.isLocalFile(this.thumbnail ?? '');
    }

    getLocalThumbnailPath(): string | null {
        if (!this.isLocalThumbnail()) return null;
        let path = this.app.storage.files.urlToKey(this.thumbnail as string);
        if (!path) return null;
        return join(AvatarManager.AssetFolder, path);
    }

    setThumbnailFile(file: any, hash: string): boolean {
        try {
            if (!existsSync(AvatarManager.AssetFolder))
                mkdirSync(AvatarManager.AssetFolder, { recursive: true });
            let ext = file.originalname.split('.').pop();
            let type = file.mimetype.split('/').pop();
            let filename = `${hash}-${type}.${ext}`;
            copyFileSync(file.path, join(AvatarManager.AssetFolder, filename));
            rmSync(file.path);
            this.thumbnail = this.app.storage.files.keyToUrl(filename);
            return true;
        } catch (e) {
            Debug.error('Error setting thumbnail file:', e);
            return false;
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

    toIdentifier(): AvatarIdentifier {
        return new AvatarIdentifier(this.id, undefined);
    }

    async alias() {
        var infos = this.app.server.getInfos();
        return [
            {
                key: "profile",
                value: `${infos.gateways.web.origin}/a/${this.id}`
            },
            {
                key: "api",
                value: `${infos.gateways.http.origin}/api/avatars/${this.id}`
            },
            {
                key: "iid",
                value: this.toIdentifier().toString(infos.address)
            }
        ]
    }

}
