import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { StorageService } from '../storage/storage.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { NoxIdentifier } from '../common/identifier';
import { WorldDelegate } from 'src/generated/prisma/models/World';
import { WorldAssetDelegate } from 'src/generated/prisma/models/WorldAsset';
import { World, WorldWithMethods } from './world.model';
import { WorldAsset, WorldAssetWithMethods } from './world-asset.model';
import { SUPPORTED_ENGINES, SUPPORTED_PLATFORMS } from './worlds.types';
import type { CreateWorldDto } from './dto/create-world.dto';
import type { UpdateWorldDto } from './dto/update-world.dto';
import type { CreateAssetDto } from './dto/create-asset.dto';
import type { UserWithMethods } from '../users/user.model';
import type { ExternalUserWithMethods } from '../external/external-user.model';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AssetProcessingQueue, ProcessingJob } from './asset-processing.queue';
import { WorldAssetProcessor, WORLD_ASSET_PROCESSOR_TYPE } from './world-asset-processor';
import { ExternalServersService } from '../external/external-servers.service';
import { ActivityService } from '../activity/activity.service';

type DiskMulterFile = Express.Multer.File & { path?: string };

@Injectable()
export class WorldsService {

    public readonly logger = new Logger(WorldsService.name);

    readonly queue = new AssetProcessingQueue();

    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
        public readonly storage: StorageService,
        public readonly externalServers: ExternalServersService,
        public readonly activity: ActivityService,
    ) {
        this.queue.register(WORLD_ASSET_PROCESSOR_TYPE, new WorldAssetProcessor(this));
    }

    async address(): Promise<string> {
        return this.wellKnown.address();
    }

    async apiBase(): Promise<string> {
        return this.wellKnown.apiBaseUrl();
    }

    // ── Validators ───────────────────────────────────────────────────────────────

    isValidCapacity(n: number): boolean {
        return Number.isInteger(n) && n >= 0 && n <= 65535;
    }

    isValidVersion(n: number): boolean {
        return Number.isInteger(n) && n >= 0 && n <= 65535;
    }

    isValidEngine(e: string): boolean {
        return (SUPPORTED_ENGINES as readonly string[]).includes(e);
    }

    isValidPlatform(p: string): boolean {
        return (SUPPORTED_PLATFORMS as readonly string[]).includes(p);
    }

    // ── Permissions ──────────────────────────────────────────────────────────────

    canCreateWorld(user: UserWithMethods | ExternalUserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_world_create');
    }

    canUploadFile(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_file_upload');
    }

    canExternalFetch(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_external_fetch');
    }

    // ── Lookup ───────────────────────────────────────────────────────────────────

    async findById(id: number): Promise<WorldWithMethods | null> {
        const model = await this.worlds.findUnique({ where: { id } });
        if (!model) return null;
        return World.attach(model, this);
    }

    async findByName(name: string): Promise<WorldWithMethods | null> {
        const model = await this.worlds.findUnique({ where: { name } });
        if (!model) return null;
        return World.attach(model, this);
    }

    /**
     * Resolves a world by NoxIdentifier string.
     * Supports numeric IDs (e.g. "42@host") and name slugs (e.g. "myworld@host").
     */
    async findByIdentifier(id: string): Promise<WorldWithMethods | null> {
        const identifier = NoxIdentifier.parse(id);
        const numericId = identifier.numericId;
        if (numericId !== null) return this.findById(numericId);
        // Fall back to name lookup
        const namePart = identifier.id;
        if (namePart) return this.findByName(namePart);
        return null;
    }

    async findAssetById(id: number): Promise<WorldAssetWithMethods | null> {
        const model = await this.worldAssets.findUnique({ where: { id } });
        if (!model) return null;
        return WorldAsset.attach(model, this);
    }

    async findAssetByIndex(
        worldId: number,
        version: number,
        engine: string,
        platform: string,
    ): Promise<WorldAssetWithMethods | null> {
        const model = await this.worldAssets.findUnique({
            where: { worldId_version_engine_platform: { worldId, version, engine, platform } },
        });
        if (!model) return null;
        return WorldAsset.attach(model, this);
    }

    async findAssetsByWorldId(worldId: number, filters: {
        versions?: number[];
        engines?: string[];
        platforms?: string[];
        showEmpty?: boolean;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ assets: WorldAssetWithMethods[]; total: number }> {
        const where: any = { worldId };
        if (filters.versions && filters.versions.length > 0) where.version = { in: filters.versions };
        if (filters.engines && filters.engines.length > 0) where.engine = { in: filters.engines };
        if (filters.platforms && filters.platforms.length > 0) where.platform = { in: filters.platforms };
        if (filters.showEmpty === false) where.hash = { not: null };

        const limit = filters.limit ?? 50;
        const offset = filters.offset ?? 0;

        const [models, total] = await Promise.all([
            this.worldAssets.findMany({ where, take: limit, skip: offset, orderBy: { id: 'asc' } }),
            this.worldAssets.count({ where }),
        ]);

        return { assets: models.map(m => WorldAsset.attach(m, this)), total };
    }

    // ── Search ───────────────────────────────────────────────────────────────────

    async searchWorlds(
        opts: { ids?: number[]; query?: string },
        limit = 10,
        offset = 0,
    ): Promise<{ worlds: WorldWithMethods[]; total: number }> {
        const where: any = {};

        if (opts.ids && opts.ids.length > 0) {
            where.id = { in: opts.ids };
        } else if (opts.query) {
            where.OR = [
                { title: { contains: opts.query, mode: 'insensitive' } },
                { description: { contains: opts.query, mode: 'insensitive' } },
            ];
        }

        const [models, total] = await Promise.all([
            this.worlds.findMany({ where, take: limit, skip: offset, orderBy: { id: 'asc' } }),
            this.worlds.count({ where }),
        ]);

        return { worlds: models.map(m => World.attach(m, this)), total };
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────────

    async createWorld(dto: CreateWorldDto, user: UserWithMethods | ExternalUserWithMethods): Promise<WorldWithMethods> {
        let display = !user.isLocal()
            ? (await user.fetch()).display
            : user.display;

        dto.title = (dto.title?.trim() || `${display ?? 'Unknown'}'s World`);
        if (dto.title.length === 0 || dto.title.length > 255)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'title must be 1-255 characters');

        if (dto.description !== undefined && dto.description !== null && dto.description.length > 4096)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'description must be at most 4096 characters');

        const capacity = dto.capacity ?? 32;
        if (!this.isValidCapacity(capacity))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'capacity must be an integer 0-65535');

        const contributorRefs = await this.normalizeContributors(dto.contributors);
        let ownerRef = (await user.identifier());

        // Validate custom id if provided
        if (dto.id !== undefined) {
            const existing = await this.worlds.findUnique({ where: { id: dto.id } });
            if (existing)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `id ${dto.id} is already taken`);
        }

        // Validate unique name if provided
        let name: string | null = null;
        if (dto.name) {
            const existing = await this.worlds.findUnique({ where: { name: dto.name } });
            if (existing)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `name "${dto.name}" is already taken`);
            name = dto.name;
        }

        const model = await this.worlds.create({
            data: {
                ...(dto.id !== undefined ? { id: dto.id } : {}),
                name,
                title: dto.title,
                description: dto.description ?? null,
                capacity,
                ownerRef: ownerRef.toString(),
                contributorRefs,
                tags: [],
            },
        });

        await this.activity.create({
            type: 'world.create',
            message: `World "${model.title}" created`,
            details: { world_id: model.id },
            author: NoxIdentifier.type('u', ownerRef).toString()
        });

        return World.attach(model, this);
    }

    async updateWorld(
        worldId: number,
        dto: UpdateWorldDto,
        file?: Express.Multer.File,
        updater?: UserWithMethods | ExternalUserWithMethods,
    ): Promise<WorldWithMethods> {
        const model = await this.worlds.findUnique({ where: { id: worldId } });
        if (!model) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'World');

        const updates: any = {};

        if (dto.name !== undefined) {
            if (dto.name === null) {
                updates.name = null;
            } else {
                const existing = await this.worlds.findUnique({ where: { name: dto.name } });
                if (existing && existing.id !== worldId)
                    throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `name "${dto.name}" is already taken`);
                updates.name = dto.name;
            }
        }

        if (dto.title !== undefined) {
            if (!dto.title || dto.title.trim().length === 0 || dto.title.length > 255)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'title must be 1-255 characters');
            updates.title = dto.title.trim();
        }

        if (dto.description !== undefined)
            if (dto.description !== null && dto.description.length > 4096)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'description must be at most 4096 characters');
            else updates.description = dto.description ?? null;

        if (dto.capacity !== undefined) {
            if (!this.isValidCapacity(dto.capacity))
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'capacity must be an integer 0-65535');
            updates.capacity = dto.capacity;
        }

        if (dto.contributors !== undefined)
            updates.contributorRefs = await this.normalizeContributors(dto.contributors);

        if (dto.release !== undefined) {
            if (dto.release !== null) {
                if (!Number.isInteger(dto.release) || dto.release < 0)
                    throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'release must be a non-negative integer');
            }
            updates.release = dto.release ?? null;
        }

        // Tags: keep only usr:* tags provided, merge non-usr from existing
        if (dto.tags !== undefined) {
            const newUsrTags = Array.isArray(dto.tags)
                ? dto.tags.reduce((acc: string[], tag: string) => {
                    if (!acc.includes(tag)) acc.push(tag);
                    return acc;
                }, [] as string[]).filter(t => t.startsWith('usr:') && t.split(':')[1]?.length > 0)
                : [];
            const nonUsr = ((model as any).tags || []).filter((t: string) => !t.startsWith('usr:'));
            updates.tags = [...newUsrTags, ...nonUsr];
        }

        // Thumbnail — file takes priority over JSON field
        if (file) {
            const f = file as DiskMulterFile;
            const stored = await this.storage.store({ source: f.path!, mimetype: f.mimetype });
            updates.thumbnail = stored.key;
        } else if (dto.thumbnail !== undefined) {
            updates.thumbnail = dto.thumbnail ?? null;
        }

        const updated = await this.worlds.update({ where: { id: worldId }, data: updates });

        // Cleanup old thumbnail
        if (updates.thumbnail !== undefined) {
            const oldThumb = model.thumbnail;
            if (oldThumb && oldThumb !== updates.thumbnail)
                await this.storage.delete(oldThumb);
        }

        this.activity.create({
            type: 'world.update',
            message: `World "${updated.title}" updated`,
            details: { world_id: worldId },
            author: NoxIdentifier.type('u', await updater?.identifier() ?? NoxIdentifier.parse(model.ownerRef)).toString()
        }).catch(() => { });

        return World.attach(updated, this);
    }

    async deleteWorld(worldId: number, updater?: UserWithMethods | ExternalUserWithMethods): Promise<void> {
        const model = await this.worlds.findUnique({ where: { id: worldId }, include: { assets: true } });
        if (!model) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'World');

        // Delete asset files from storage
        for (const asset of (model as any).assets ?? []) {
            if (asset.url)
                await this.storage.delete(asset.url);
        }
        // Delete thumbnail
        if (model.thumbnail)
            await this.storage.delete(model.thumbnail);

        this.activity.create({
            type: 'world.delete',
            message: `World "${model.title}" deleted`,
            details: { world_id: model.id },
            author: NoxIdentifier.type('u', await updater?.identifier() ?? NoxIdentifier.parse(model.ownerRef)).toString()
        }).catch(() => { });
        await this.worlds.delete({ where: { id: worldId } });
    }

    // ── Assets ───────────────────────────────────────────────────────────────────

    async createAsset(worldId: number, dto: CreateAssetDto): Promise<WorldAssetWithMethods> {
        if (!this.isValidVersion(dto.version))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'version must be an integer 0-65535');
        if (!this.isValidEngine(dto.engine))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `engine must be one of: ${SUPPORTED_ENGINES.join(', ')}`);
        if (!this.isValidPlatform(dto.platform))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}`);

        const existing = await this.findAssetByIndex(worldId, dto.version, dto.engine, dto.platform);
        if (existing) throw new ApiException(ApiErrorCode.CONFLICT, null, `Asset (v${dto.version}/${dto.engine}/${dto.platform})`);

        const model = await this.worldAssets.create({
            data: {
                worldId,
                version: dto.version,
                engine: dto.engine,
                platform: dto.platform,
                url: dto.url ?? null,
            },
        });
        return WorldAsset.attach(model, this);
    }

    /**
     * Compute hash, validate against optional expected hash, then enqueue the file
     * for async processing (bundle analysis → storage → DB update).
     * Returns immediately with a ProcessingJob that the caller can poll.
     */
    enqueueAssetFile(
        assetId: number,
        file: Express.Multer.File,
        uploaderRef: string,
        expectedHash?: string,
    ): ProcessingJob {
        const f = file as DiskMulterFile;
        if (!f.path) throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, 'Asset file path unavailable');

        // Hash synchronously before enqueuing so we can reject bad uploads immediately
        const hash = createHash('sha256').update(readFileSync(f.path)).digest('hex');
        if (expectedHash && expectedHash !== hash)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'File hash mismatch');

        return this.queue.enqueue({
            type: WORLD_ASSET_PROCESSOR_TYPE,
            assetId,
            filePath: f.path,
            hash,
            fileSize: f.size,
            uploaderRef,
        });
    }

    getJobStatus(assetId: number): ProcessingJob | undefined {
        return this.queue.getJob(assetId);
    }

    /** Called by WorldAssetProcessor to persist the processed asset data. */
    async updateAssetRecord(
        assetId: number,
        data: { url: string; hash: string; size: number; uploaderRef: string },
    ): Promise<void> {
        await this.worldAssets.update({
            where: { id: assetId },
            data: { url: data.url, hash: data.hash, size: data.size, uploaderRef: data.uploaderRef },
        });
    }

    async deleteAsset(assetId: number): Promise<void> {
        const asset = await this.worldAssets.findUnique({ where: { id: assetId } });
        if (!asset) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Asset');

        if (asset.url)
            await this.storage.delete(asset.url);

        await this.worldAssets.delete({ where: { id: assetId } });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /** Normalize contributor refs: deduplicate valid NoxIdentifier strings */
    private async normalizeContributors(raw?: string[]): Promise<string[]> {
        if (!raw || raw.length === 0) return [];
        const domain = await this.address();
        const seen = new Set<string>();
        const result: string[] = [];
        for (const s of raw) {
            const ni = NoxIdentifier.parse(s);
            const key = ni.toString(domain);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(key);
            }
        }
        return result;
    }

    // ── Delegate shortcuts ────────────────────────────────────────────────────────

    private get worlds(): WorldDelegate {
        return this.prisma.worlds as WorldDelegate;
    }

    private get worldAssets(): WorldAssetDelegate {
        return this.prisma.worldAssets as WorldAssetDelegate;
    }

    async resolveRelease(worldId: number, release: number | null): Promise<number> {
        if (release !== null) return release;
        const asset = await this.worldAssets.findFirst({
            where: { worldId, hash: { not: null } },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        return asset?.version ?? -1;
    }
}
