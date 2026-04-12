import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { StorageService } from '../storage/storage.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { Avatar, AvatarWithMethods } from './avatar.model';
import { AvatarAsset, AvatarAssetWithMethods } from './avatar-asset.model';
import { SUPPORTED_ENGINES, SUPPORTED_PLATFORMS } from './avatars.types';
import { AssetProcessingQueue, ProcessingJob } from '../worlds/asset-processing.queue';
import { AvatarAssetProcessor, AVATAR_ASSET_PROCESSOR_TYPE } from './avatar-asset-processor';
import { ExternalServersService } from '../external/external-servers.service';
import { ActivityService } from '../activity/activity.service';
import type { CreateAvatarDto } from './dto/create-avatar.dto';
import type { UpdateAvatarDto } from './dto/update-avatar.dto';
import type { CreateAvatarAssetDto } from './dto/create-avatar-asset.dto';
import type { UserWithMethods } from '../users/user.model';
import { NoxIdentifier } from 'src/common/identifier';
import { ExternalUserWithMethods } from 'src/external/external-user.model';

type DiskMulterFile = Express.Multer.File & { path?: string };

@Injectable()
export class AvatarsService {

    readonly queue = new AssetProcessingQueue();

    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
        public readonly storage: StorageService,
        public readonly externalServers: ExternalServersService,
        public readonly activity: ActivityService,
    ) {
        this.queue.register(AVATAR_ASSET_PROCESSOR_TYPE, new AvatarAssetProcessor(this));
    }

    async address(): Promise<string> {
        return this.wellKnown.address();
    }

    async apiBase(): Promise<string> {
        return this.wellKnown.apiBaseUrl();
    }

    // ── Validators ───────────────────────────────────────────────────────────────

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

    canCreateAvatar(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_avatar_create');
    }

    canUploadFile(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_file_upload');
    }

    canExternalFetch(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_external_fetch');
    }

    // ── Lookup ───────────────────────────────────────────────────────────────────

    async findById(id: number): Promise<AvatarWithMethods | null> {
        const model = await this.prisma.avatars.findUnique({ where: { id } });
        if (!model) return null;
        return Avatar.attach(model, this);
    }

    async findAssetById(id: number): Promise<AvatarAssetWithMethods | null> {
        const model = await this.prisma.avatarAssets.findUnique({ where: { id } });
        if (!model) return null;
        return AvatarAsset.attach(model, this);
    }

    async findAssetByIndex(
        avatarId: number,
        version: number,
        engine: string,
        platform: string,
    ): Promise<AvatarAssetWithMethods | null> {
        const model = await this.prisma.avatarAssets.findUnique({
            where: { avatarId_version_engine_platform: { avatarId, version, engine, platform } },
        });
        if (!model) return null;
        return AvatarAsset.attach(model, this);
    }

    async findAssetsByAvatarId(avatarId: number, filters: {
        versions?: number[];
        engines?: string[];
        platforms?: string[];
        showEmpty?: boolean;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ assets: AvatarAssetWithMethods[]; total: number }> {
        const where: any = { avatarId };
        if (filters.versions && filters.versions.length > 0) where.version = { in: filters.versions };
        if (filters.engines && filters.engines.length > 0) where.engine = { in: filters.engines };
        if (filters.platforms && filters.platforms.length > 0) where.platform = { in: filters.platforms };
        if (filters.showEmpty === false) where.hash = { not: null };

        const limit = filters.limit ?? 50;
        const offset = filters.offset ?? 0;

        const [models, total] = await Promise.all([
            this.prisma.avatarAssets.findMany({ where, take: limit, skip: offset, orderBy: { id: 'asc' } }),
            this.prisma.avatarAssets.count({ where }),
        ]);

        return { assets: models.map(m => AvatarAsset.attach(m, this)), total };
    }

    // ── Search ───────────────────────────────────────────────────────────────────

    async searchAvatars(
        opts: { ids?: number[]; query?: string },
        limit = 10,
        offset = 0,
    ): Promise<{ avatars: AvatarWithMethods[]; total: number }> {
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
            this.prisma.avatars.findMany({ where, take: limit, skip: offset, orderBy: { id: 'asc' } }),
            this.prisma.avatars.count({ where }),
        ]);

        return { avatars: models.map(m => Avatar.attach(m, this)), total };
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────────

    async createAvatar(dto: CreateAvatarDto, user: UserWithMethods | ExternalUserWithMethods): Promise<AvatarWithMethods> {
        let display = !user.isLocal()
            ? (await user.fetch()).display
            : user.display;

        dto.title = (dto.title?.trim() || `${display ?? 'Unknown'}'s Avatar`);
        if (dto.title.length === 0 || dto.title.length > 255)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'title must be 1-255 characters');

        if (dto.description !== undefined && dto.description !== null && dto.description.length > 4096)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'description must be at most 4096 characters');

        // Validate custom id if provided
        if (dto.id !== undefined) {
            const existing = await this.prisma.avatars.findUnique({ where: { id: dto.id } });
            if (existing)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `id ${dto.id} is already taken`);
        }

        // Validate unique name if provided
        let name: string | null = null;
        if (dto.name) {
            const existing = await this.prisma.avatars.findUnique({ where: { name: dto.name } });
            if (existing)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `name "${dto.name}" is already taken`);
            name = dto.name;
        }

        const contributorRefs = await this.normalizeContributors(dto.contributors);
        const ownerRef = NoxIdentifier.type(null, await user.identifier()).toString();

        const model = await this.prisma.avatars.create({
            data: {
                ...(dto.id !== undefined ? { id: dto.id } : {}),
                name,
                title: dto.title,
                description: dto.description ?? null,
                ownerRef,
                contributorRefs,
                tags: [],
            },
        });
        this.activity.create({
            type: 'avatar.create',
            message: `Avatar "${model.title}" created`,
            details: { avatar_id: model.id },
            author: (await user.identifier()).toString()
        }).catch(() => { });
        return Avatar.attach(model, this);
    }

    async updateAvatar(
        avatarId: number,
        dto: UpdateAvatarDto,
        file?: Express.Multer.File,
    ): Promise<AvatarWithMethods> {
        const model = await this.prisma.avatars.findUnique({ where: { id: avatarId } });
        if (!model) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Avatar');

        const updates: any = {};

        if (dto.name !== undefined) {
            if (dto.name === null) {
                updates.name = null;
            } else {
                const existing = await this.prisma.avatars.findUnique({ where: { name: dto.name } });
                if (existing && existing.id !== avatarId)
                    throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `name "${dto.name}" is already taken`);
                updates.name = dto.name;
            }
        }

        if (dto.title !== undefined) {
            if (!dto.title || dto.title.trim().length === 0 || dto.title.length > 255)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'title must be 1-255 characters');
            updates.title = dto.title.trim();
        }

        if (Object.prototype.hasOwnProperty.call(dto, 'description'))
            if (dto.description !== null && dto.description !== undefined && dto.description.length > 4096)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'description must be at most 4096 characters');
            else updates.description = dto.description ?? null;

        if (file) {
            const f = file as DiskMulterFile;
            const stored = await this.storage.store({ source: f.path!, mimetype: f.mimetype });
            updates.thumbnail = stored.key;
        } else if (Object.prototype.hasOwnProperty.call(dto, 'thumbnail')) {
            updates.thumbnail = dto.thumbnail ?? null;
        }

        if (Object.prototype.hasOwnProperty.call(dto, 'release')) {
            if (dto.release !== null && dto.release !== undefined) {
                if (!Number.isInteger(dto.release) || dto.release < 0)
                    throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'release must be a non-negative integer');
            }
            updates.release = dto.release ?? null;
        }

        if (dto.contributors !== undefined)
            updates.contributorRefs = await this.normalizeContributors(dto.contributors);

        const updated = await this.prisma.avatars.update({ where: { id: avatarId }, data: updates });

        if (Object.prototype.hasOwnProperty.call(updates, 'thumbnail')) {
            const oldThumb = model.thumbnail;
            if (oldThumb && oldThumb !== updates.thumbnail)
                await this.storage.delete(oldThumb);
        }

        this.activity.create({
            type: 'avatar.update',
            message: `Avatar "${updated.title}" updated`,
            details: { avatar_id: avatarId },
            author: NoxIdentifier.parse(model.ownerRef).toString()
        }).catch(() => { });

        return Avatar.attach(updated, this);
    }

    async deleteAvatar(avatarId: number): Promise<void> {
        const model = await this.prisma.avatars.findUnique({ where: { id: avatarId }, include: { assets: true } });
        if (!model) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Avatar');

        for (const asset of (model as any).assets ?? []) {
            if (asset.url) await this.storage.delete(asset.url);
        }
        if (model.thumbnail) await this.storage.delete(model.thumbnail);

        this.activity.create({
            type: 'avatar.delete',
            message: `Avatar "${model.title}" deleted`,
            details: { avatar_id: model.id },
            author: NoxIdentifier.parse(model.ownerRef).toString()
        }).catch(() => { });
        await this.prisma.avatars.delete({ where: { id: avatarId } });
    }

    // ── Assets ───────────────────────────────────────────────────────────────────

    async createAsset(avatarId: number, dto: CreateAvatarAssetDto): Promise<AvatarAssetWithMethods> {
        if (!this.isValidVersion(dto.version))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'version must be an integer 0-65535');
        if (!this.isValidEngine(dto.engine))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `engine must be one of: ${SUPPORTED_ENGINES.join(', ')}`);
        if (!this.isValidPlatform(dto.platform))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}`);

        const existing = await this.findAssetByIndex(avatarId, dto.version, dto.engine, dto.platform);
        if (existing) throw new ApiException(ApiErrorCode.CONFLICT, null, `Asset (v${dto.version}/${dto.engine}/${dto.platform})`);

        const model = await this.prisma.avatarAssets.create({
            data: {
                avatarId,
                version: dto.version,
                engine: dto.engine,
                platform: dto.platform,
                url: dto.url ?? null,
            },
        });
        return AvatarAsset.attach(model, this);
    }

    async enqueueAssetFile(
        assetId: number,
        file: Express.Multer.File,
        user: UserWithMethods | ExternalUserWithMethods,
        expectedHash?: string,
    ): Promise<ProcessingJob> {
        const f = file as DiskMulterFile;
        if (!f.path) throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, 'Asset file path unavailable');

        const hash = createHash('sha256').update(readFileSync(f.path)).digest('hex');
        if (expectedHash && expectedHash !== hash)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'File hash mismatch');

        return this.queue.enqueue({
            type: AVATAR_ASSET_PROCESSOR_TYPE,
            assetId,
            filePath: f.path,
            hash,
            fileSize: f.size,
            uploaderRef: NoxIdentifier.type(null, await user.identifier()).toString(),
        });
    }

    getJobStatus(assetId: number): ProcessingJob | undefined {
        return this.queue.getJob(assetId);
    }

    async updateAssetRecord(
        assetId: number,
        data: { url: string; hash: string; size: number; uploaderRef: string },
    ): Promise<void> {
        await this.prisma.avatarAssets.update({
            where: { id: assetId },
            data: { url: data.url, hash: data.hash, size: data.size, uploaderRef: data.uploaderRef },
        });
    }

    async deleteAsset(assetId: number): Promise<void> {
        const asset = await this.prisma.avatarAssets.findUnique({ where: { id: assetId } });
        if (!asset) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Asset');
        if (asset.url) await this.storage.delete(asset.url);
        await this.prisma.avatarAssets.delete({ where: { id: assetId } });
    }

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

    async resolveRelease(avatarId: number, release: number | null): Promise<number> {
        if (release !== null) return release;
        const asset = await this.prisma.avatarAssets.findFirst({
            where: { avatarId, hash: { not: null } },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        return asset?.version ?? -1;
    }
}
