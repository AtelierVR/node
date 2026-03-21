import Reileta from "../Main";
import World from "./World";
import { World as IWorld, WorldAsset as IWorldAsset } from '@prisma/client';
import WorldAsset from "./WorldAsset";
import WorldAPIWeb from "./WorldAPIWeb";
import User from "../users/User";
import { isValidInt } from "../utils/Utils";
import { join } from "node:path";
import { cwd } from "node:process";
import Env from "../utils/Environment";
import Debug from "../utils/Debug";

export default class WorldManager {
    static getWorldSelector(world_id: string) {
        try {
            var json = JSON.parse(world_id);
            if (json.ids && (!Array.isArray(json.ids) || !json.ids.every((id: any) => WorldManager.isValidWorldId(id))))
                return null;
            let obj: IWorldSelector = {
                ids: json.ids || [],
            };
            return obj;
        } catch { return null; }
    }
    api_web: WorldAPIWeb;

    constructor(private readonly app: Reileta) {
        this.api_web = new WorldAPIWeb(app, this);
    }

    static isValidWorldId(id: number): boolean { // uint
        return isValidInt(id, 0, 1n << 32n);
    }

    static isValidAssetId(id: number): boolean { // uint
        return isValidInt(id, 0, 1n << 32n);
    }

    static isValidAssetVersion(version: number): boolean { // ushort
        return isValidInt(version, 0, 1n << 16n);
    }

    static isValidCapacity(capacity: number): boolean { // ushort
        return isValidInt(capacity, 0, 1n << 16n);
    }

    async searchWorldsByIds(ids: number[], ilimit: number, ioffset: number) {
        let worlds: IWorld[] = [];
        let total: number = 0;
        try {
            worlds = await this.app.database.world.findMany({
                where: {
                    id: { in: ids }
                },
                skip: ioffset,
                take: ilimit
            });
            total = await this.app.database.world.count({ where: { id: { in: ids } } });
        } catch { }
        return { worlds: worlds.map(world => new World(world, this.app)), total };
    }

    async searchWorldsByQuery(search: string | undefined, ilimit: number, ioffset: number) {
        let worlds: IWorld[] = [];
        let total: number = 0;
        try {
            const query: any = search ? {
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } }
                ]
            } : {};
            worlds = await this.app.database.world.findMany({
                where: query,
                orderBy: search ? {
                    _relevance: {
                        fields: ["title", "description"],
                        search: search,
                        sort: "desc",
                    }
                } : undefined,
                skip: ioffset,
                take: ilimit
            });
            total = await this.app.database.world.count({ where: query });
        } catch { }
        return { worlds: worlds.map(world => new World(world, this.app)), total };
    }

    static AssetFolder = join(cwd(), 'assets');

    static isValidEngine(engine: string): boolean {
        return Env.sync('SUPPORTED_WORLD_ASSET_ENGINE').includes(engine);
    }

    static isValidPlatform(platform: string): boolean {
        return Env.sync('SUPPORTED_WORLD_ASSET_PLATFORM').includes(platform);
    }

    async createWorld(body: IMakeWorld, user: User): Promise<World | null> {
        let world: IWorld | null = null;
        try {
            world = await this.app.database.world.create({
                data: {
                    id: body.id || undefined,
                    title: body.title || 'New World',
                    description: body.description || 'This is a new world.',
                    capacity: body.capacity || 0,
                    thumbnail: body.thumbnail || undefined,
                    owner_ref: user.id.toString(),
                    contributor_refs: body.contributor_refs || [],
                    tags: []
                }
            });
        } catch (e) { Debug.error(e); }
        return !world ? null : new World(world, this.app);
    }

    async deleteWorld(id: number): Promise<boolean> {
        try {
            await this.app.database.world.delete({ where: { id: id } });
            return true;
        } catch { }
        return false;
    }


    async findWorldById(id: number): Promise<World | null> {
        let world: IWorld | null = null;
        try {
            world = await this.app.database.world.findUnique({ where: { id: Number(id) } });
        } catch { }
        return !world ? null : new World(world, this.app);
    }

    async findWorldAssetById(id: number): Promise<WorldAsset | null> {
        let asset: IWorldAsset | null = null;
        try {
            asset = await this.app.database.worldAsset.findUnique({ where: { id: Number(id) } });
        } catch { }
        return !asset ? null : new WorldAsset(asset, this.app);
    }

    async findWorldAssetByIndex(world_id: number, version: number, engine: string, platform: string): Promise<WorldAsset | null> {
        let asset: IWorldAsset | null = null;
        try {
            asset = await this.app.database.worldAsset.findFirst({
                where: {
                    world_id: world_id,
                    version: version,
                    engine: engine,
                    platform: platform
                }
            });
        } catch { }
        return !asset ? null : new WorldAsset(asset, this.app);
    }

    async findWorldAssetByWorldId(world_id: number): Promise<WorldAsset[]> {
        let assets: IWorldAsset[] = [];
        try {
            assets = await this.app.database.worldAsset.findMany({ where: { world_id: world_id } });
        } catch { }
        return assets.map(asset => new WorldAsset(asset, this.app));
    }

    async updateWorld(id: number, body: IUpdateWorld): Promise<World | null> {
        let world: IWorld | null = null;
        try {
            world = await this.app.database.world.update({
                where: { id: id },
                data: {
                    title: body.title || undefined,
                    description: body.description || undefined,
                    capacity: body.capacity || undefined,
                    thumbnail: body.thumbnail || undefined
                }
            });
        } catch { }
        return !world ? null : new World(world, this.app);
    }

    async createWorldAsset(body: IMakeWorldAsset): Promise<WorldAsset | null> {
        let asset: IWorldAsset | null = null;
        try {
            asset = await this.app.database.worldAsset.create({
                data: {
                    world_id: body.world_id,
                    version: body.version,
                    engine: body.engine,
                    platform: body.platform,
                    url: body.url || undefined,
                    hash: body.hash || undefined,
                    size: body.size || undefined
                }
            });
        } catch (e) {
            Debug.error(e);
        }
        return !asset ? null : new WorldAsset(asset, this.app);
    }

    async updateWorldAsset(asset: WorldAsset): Promise<WorldAsset | null> {
        let asset_: IWorldAsset | null = null;
        try {
            asset_ = await this.app.database.worldAsset.update({
                where: { id: asset.id },
                data: {
                    url: asset.url || undefined,
                    hash: asset.hash || undefined,
                    size: asset.size || undefined
                }
            });
        } catch { }
        return !asset_ ? null : new WorldAsset(asset_, this.app);
    }

    async findWorldAssets(world_id: number, { show_empty, versions, engines, platforms, limit, offset }: { show_empty?: boolean, limit: number, offset: number, versions?: number[], engines?: string[], platforms?: string[] }) {
        let assets: IWorldAsset[] = [];
        let total: number = 0;
        try {
            let query = {
                world_id: world_id,
                version: { in: versions },
                engine: { in: engines },
                platform: { in: platforms },
                hash: show_empty ? undefined : { not: null },
                url: show_empty ? undefined : { not: null },
                size: show_empty ? undefined : { not: 0 }
            };
            assets = await this.app.database.worldAsset.findMany({
                where: query,
                orderBy: { version: 'desc' },
                skip: offset,
                take: limit
            });
            total = await this.app.database.worldAsset.count({ where: query });
        } catch { }
        return { assets: assets.map(asset => new WorldAsset(asset, this.app)), total };
    }
}

export interface IMakeWorld {
    id?: number;
    title?: string;
    description?: string;
    capacity?: number;
    thumbnail?: string;
    contributor_refs: string[];
}

export interface IUpdateWorld {
    title?: string;
    description?: string;
    capacity?: number;
    thumbnail?: string;
    contributor_refs?: string[];
}

export interface IMakeWorldAsset {
    id?: number;
    world_id: number;
    version: number;
    engine: string;
    platform: string;
    url?: string;
    hash?: string;
    size?: number;
}

export interface IWorldSelector {
    ids: number[];
}