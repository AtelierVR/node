import Reileta from "../Main";
import Avatar from "./Avatar";
import { Avatar as IAvatar, AvatarAsset as IAvatarAsset } from '@prisma/client';
import AvatarAsset from "./AvatarAsset";
import AvatarAPIWeb from "./AvatarAPIWeb";
import User from "../users/User";
import { isValidInt } from "../utils/Utils";
import { join } from "node:path";
import { cwd } from "node:process";
import Env from "../utils/Environment";
import Debug from "../utils/Debug";

export default class AvatarManager {
    static getAvatarSelector(avatar_id: string) {
        try {
            var json = JSON.parse(avatar_id);
            if (json.ids && (!Array.isArray(json.ids) || !json.ids.every((id: any) => AvatarManager.isValidAvatarId(id))))
                return null;
            let obj: IAvatarSelector = {
                ids: json.ids || [],
            };
            return obj;
        } catch { return null; }
    }
    
    api_web: AvatarAPIWeb;

    constructor(private readonly app: Reileta) {
        this.api_web = new AvatarAPIWeb(app, this);
    }

    static isValidAvatarId(id: number): boolean { // uint
        return isValidInt(id, 0, 1n << 32n);
    }

    static isValidAssetId(id: number): boolean { // uint
        return isValidInt(id, 0, 1n << 32n);
    }

    static isValidAssetVersion(version: number): boolean { // ushort
        return isValidInt(version, 0, 1n << 16n);
    }

    static isValidEngine(engine: string): boolean {
        return typeof engine === 'string' && engine.length > 0 && engine.length <= 64;
    }

    static isValidPlatform(platform: string): boolean {
        return typeof platform === 'string' && platform.length > 0 && platform.length <= 64;
    }

    static AssetFolder = join(cwd(), 'assets/');

    async searchAvatarsByIds(ids: number[], ilimit: number, ioffset: number) {
        let avatars: IAvatar[] = [];
        let total: number = 0;
        try {
            total = await this.app.database.avatar.count({
                where: {
                    id: { in: ids }
                }
            });
            avatars = await this.app.database.avatar.findMany({
                where: {
                    id: { in: ids }
                },
                take: ilimit,
                skip: ioffset,
                orderBy: { created_at: 'desc' }
            });
        } catch { }
        return { avatars: avatars.map(avatar => new Avatar(avatar, this.app)), total };
    }

    async searchAvatars(query: string, tags: string[], ilimit: number, ioffset: number) {
        let avatars: IAvatar[] = [];
        let total: number = 0;
        try {
            const searchConditions: any = {};
            
            if (query) {
                searchConditions.OR = [
                    { title: { contains: query, mode: 'insensitive' } },
                    { description: { contains: query, mode: 'insensitive' } }
                ];
            }
            
            if (tags.length > 0) {
                searchConditions.tags = { hasSome: tags };
            }

            total = await this.app.database.avatar.count({ where: searchConditions });
            avatars = await this.app.database.avatar.findMany({
                where: searchConditions,
                take: ilimit,
                skip: ioffset,
                orderBy: { created_at: 'desc' }
            });
        } catch { }
        return { avatars: avatars.map(avatar => new Avatar(avatar, this.app)), total };
    }

    async findAvatarById(id: number): Promise<Avatar | null> {
        let avatar: IAvatar | null = null;
        try {
            avatar = await this.app.database.avatar.findUnique({ where: { id: id } });
        } catch { }
        return !avatar ? null : new Avatar(avatar, this.app);
    }

    async createAvatar(body: IMakeAvatar, user: User): Promise<Avatar | null> {
        let avatar: IAvatar | null = null;
        try {
            avatar = await this.app.database.avatar.create({
                data: {
                    id: body.id || undefined,
                    title: body.title || 'New Avatar',
                    description: body.description || 'This is a new avatar.',
                    thumbnail: body.thumbnail || undefined,
                    owner_ref: user.id.toString(),
                    tags: []
                }
            });
        } catch (e) { Debug.error(e); }
        return !avatar ? null : new Avatar(avatar, this.app);
    }

    async deleteAvatar(id: number): Promise<boolean> {
        try {
            await this.app.database.avatar.delete({ where: { id: id } });
            return true;
        } catch { }
        return false;
    }

    async updateAvatar(id: number, body: IUpdateAvatar): Promise<Avatar | null> {
        let avatar: IAvatar | null = null;
        try {
            avatar = await this.app.database.avatar.update({
                where: { id: id },
                data: {
                    title: body.title,
                    description: body.description,
                    thumbnail: body.thumbnail,
                    updated_at: new Date()
                }
            });
        } catch { }
        return !avatar ? null : new Avatar(avatar, this.app);
    }

    async createAvatarAsset(body: IMakeAvatarAsset): Promise<AvatarAsset | null> {
        let asset: IAvatarAsset | null = null;
        try {
            asset = await this.app.database.avatarAsset.create({
                data: {
                    id: body.id || undefined,
                    version: body.version,
                    engine: body.engine,
                    platform: body.platform,
                    url: body.url || undefined,
                    hash: body.hash || undefined,
                    features: [],
                    size: body.size || 0,
                    avatar_id: body.avatar_id
                }
            });
        } catch { }
        return !asset ? null : new AvatarAsset(asset, this.app);
    }

    async findAvatarAssetByAvatarId(avatar_id: number): Promise<AvatarAsset[]> {
        let assets: IAvatarAsset[] = [];
        try {
            assets = await this.app.database.avatarAsset.findMany({
                where: { avatar_id: avatar_id },
                orderBy: { created_at: 'desc' }
            });
        } catch { }
        return assets.map(asset => new AvatarAsset(asset, this.app));
    }

    async findAvatarAssetByIndex(avatar_id: number, version: number, engine: string, platform: string): Promise<AvatarAsset | null> {
        let asset: IAvatarAsset | null = null;
        try {
            asset = await this.app.database.avatarAsset.findFirst({
                where: {
                    avatar_id: avatar_id,
                    version: version,
                    engine: engine,
                    platform: platform
                }
            });
        } catch { }
        return !asset ? null : new AvatarAsset(asset, this.app);
    }

    async findAvatarAssets(avatar_id: number, options: {
        offset?: number;
        limit?: number;
        versions?: number[];
        engines?: string[];
        platforms?: string[];
        show_empty?: boolean;
    }) {
        let assets: IAvatarAsset[] = [];
        let total: number = 0;
        try {
            const where: any = { avatar_id: avatar_id };
            
            if (options.versions) where.version = { in: options.versions };
            if (options.engines) where.engine = { in: options.engines };
            if (options.platforms) where.platform = { in: options.platforms };
            
            total = await this.app.database.avatarAsset.count({ where });
            assets = await this.app.database.avatarAsset.findMany({
                where,
                take: options.limit || 10,
                skip: options.offset || 0,
                orderBy: { created_at: 'desc' }
            });
        } catch { }
        return { assets: assets.map(asset => new AvatarAsset(asset, this.app)), total };
    }

    async findAvatarAssetById(id: number): Promise<AvatarAsset | null> {
        let asset: IAvatarAsset | null = null;
        try {
            asset = await this.app.database.avatarAsset.findUnique({ where: { id: Number(id) } });
        } catch { }
        return !asset ? null : new AvatarAsset(asset, this.app);
    }

    async updateAvatarAsset(asset: AvatarAsset): Promise<AvatarAsset | null> {
        let asset_: IAvatarAsset | null = null;
        try {
            asset_ = await this.app.database.avatarAsset.update({
                where: { id: asset.id },
                data: {
                    url: asset.url || undefined,
                    hash: asset.hash || undefined,
                    size: asset.size || undefined,
                    features: asset.features,
                    updated_at: new Date()
                }
            });
        } catch { }
        return !asset_ ? null : new AvatarAsset(asset_, this.app);
    }

    /**
     * Clean orphaned asset files (files that exist but no asset references them)
     * Only deletes if no other asset uses the same hash
     */
    async cleanOrphanedFiles(): Promise<{ deleted: number, skipped: number, errors: number }> {
        const { readdirSync, statSync, rmSync, existsSync } = await import('fs');
        const { join } = await import('path');
        
        let deleted = 0;
        let skipped = 0;
        let errors = 0;

        try {
            const avatarsFolder = join(AvatarManager.AssetFolder, 'avatars');
            if (!existsSync(avatarsFolder)) return { deleted, skipped, errors };

            // Get all avatar folders
            const avatarFolders = readdirSync(avatarsFolder);

            for (const avatarFolder of avatarFolders) {
                const avatarPath = join(avatarsFolder, avatarFolder);
                if (!statSync(avatarPath).isDirectory()) continue;

                const avatar_id = parseInt(avatarFolder);
                if (isNaN(avatar_id)) continue;

                // Get all files in this avatar folder
                const files = readdirSync(avatarPath);

                for (const file of files) {
                    const filePath = join(avatarPath, file);
                    const hash = file.replace('.gz', '');

                    try {
                        // Check if any asset references this hash
                        const referencingAssets = await this.app.database.avatarAsset.findMany({
                            where: { 
                                hash: hash,
                                url: { contains: hash }
                            }
                        });

                        if (referencingAssets.length === 0) {
                            // No asset references this file, safe to delete
                            rmSync(filePath);
                            deleted++;
                            Debug.log(`Deleted orphaned file: ${file}`);
                        } else {
                            skipped++;
                        }
                    } catch (error) {
                        Debug.error(`Error processing file ${file}:`, error);
                        errors++;
                    }
                }
            }
        } catch (error) {
            Debug.error('Error cleaning orphaned files:', error);
            errors++;
        }

        Debug.log(`Orphaned files cleanup: ${deleted} deleted, ${skipped} skipped, ${errors} errors`);
        return { deleted, skipped, errors };
    }
}

export interface IMakeAvatar {
    id?: number;
    title?: string;
    description?: string;
    thumbnail?: string;
}

export interface IUpdateAvatar {
    title?: string;
    description?: string;
    thumbnail?: string;
}

export interface IMakeAvatarAsset {
    id?: number;
    avatar_id: number;
    version: number;
    engine: string;
    platform: string;
    url?: string;
    hash?: string;
    size?: number;
}

export interface IAvatarSelector {
    ids: number[];
}
