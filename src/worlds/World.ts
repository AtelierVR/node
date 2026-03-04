import { World as IWorld, WorldAsset as IRWorldAsset } from '@prisma/client';
import Main from '../Main';
import WorldAsset from './WorldAsset';
import User from '../users/User';
import NetUser from '../users/NetUser';
import { IMakeWorld, IUpdateWorld } from './WorldManager';
import UserIdentifier from '../users/UserIdentifier';
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import WorldManager from './WorldManager';
import Debug from '../utils/Debug';

export default class World implements IWorld {
    constructor(world: IWorld, private readonly app: Main) {
        this.id = world.id;
        this.title = world.title;
        this.description = world.description;
        this.thumbnail = world.thumbnail;
        this.tags = world.tags;
        this.capacity = world.capacity;
        this.owner_ref = world.owner_ref;
        this.contributor_refs = world.contributor_refs;
        this.created_at = world.created_at;
        this.updated_at = world.updated_at;
    }
    
    created_at: Date;
    updated_at: Date;
    id: number;
    title: string;
    description: string | null;
    thumbnail: string | null;
    tags: string[];
    capacity: number;
    owner_ref: string;
    contributor_refs: string[];

    getTags(): string[] {
        return this.tags;
    }

    getThumbnail(base: URL): URL | null {
        if (this.isLocalThumbnail()) {
            var s = statSync(this.getLocalThumbnailPath() as string);
            var u = new URL(`/api/worlds/${this.id}/thumbnail`, base);
            u.searchParams.set('t', s.mtime.getTime().toString());
            return u;
        }

        if (this.thumbnail)
            try {
                return new URL(this.thumbnail);
            } catch { }
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

    async getAssets(): Promise<WorldAsset[]> {
        return (await this.app.worlds.findWorldAssetByWorldId(this.id)) || [];
    }

    async delete(): Promise<boolean> {
        return await this.app.worlds.deleteWorld(this.id);
    }

    async save(): Promise<boolean> {
        try {
            await this.app.database.world.update({
                where: { id: this.id },
                data: {
                    title: this.title,
                    description: this.description,
                    thumbnail: this.thumbnail,
                    tags: this.tags,
                    capacity: this.capacity,
                    contributor_refs: this.contributor_refs,
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

    async IsContributor(user: User): Promise<boolean> {
        var identifier = (await user.toIdentifier()).toString(this.app.server.getInfos().address);
        return this.contributor_refs.includes(identifier);
    }

    async CanModify(user: User): Promise<boolean> {
        return (await this.IsOwner(user)) || (await this.IsContributor(user));
    }

    async addContributor(user: User): Promise<boolean> {
        var identifier = (await user.toIdentifier()).toString(this.app.server.getInfos().address);
        if (!this.contributor_refs.includes(identifier)) {
            this.contributor_refs.push(identifier);
            return true;
        }
        return false;
    }

    async removeContributor(user: User): Promise<boolean> {
        var identifier = (await user.toIdentifier()).toString(this.app.server.getInfos().address);
        const index = this.contributor_refs.indexOf(identifier);
        if (index > -1) {
            this.contributor_refs.splice(index, 1);
            return true;
        }
        return false;
    }

    async getContributors(): Promise<(User | NetUser)[]> {
        const contributors: (User | NetUser)[] = [];
        for (const ref of this.contributor_refs) {
            const userRef = UserIdentifier.fromString(ref);
            if (userRef.isLocal()) {
                const user = await this.app.users.findUserById(userRef.identifier as number);
                if (user) contributors.push(user);
            } else {
                const server = await this.app.netServers.findNetServerByAddress(userRef.server as string);
                if (server) {
                    const netUser = await this.app.netUsers.findNetUserById(userRef.identifier as number, server.id);
                    if (netUser) contributors.push(netUser);
                }
            }
        }
        return contributors;
    }

    get ownerIdentifier(): UserIdentifier {
        return UserIdentifier.fromString(this.owner_ref);
    }

    isLocalThumbnail(): boolean {
        return this.thumbnail?.startsWith('file://') || false;
    }

    getLocalThumbnailPath(): string | null {
        if (!this.isLocalThumbnail()) return null;
        let path = this.thumbnail?.replace('file://', '');
        if (!path) return null;
        return join(WorldManager.AssetFolder, path);
    }

    setThumbnailFile(file: any, hash: string): boolean {
        try {
            if (!existsSync(WorldManager.AssetFolder)) mkdirSync(WorldManager.AssetFolder, { recursive: true });
            let ext = file.originalname.split('.').pop();
            let type = file.mimetype.split('/').pop();
            let filename = `${hash}-${type}.${ext}`;
            copyFileSync(file.path, join(WorldManager.AssetFolder, filename));
            rmSync(file.path);
            this.thumbnail = `file://${filename}`;
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
}