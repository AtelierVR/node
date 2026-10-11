import { BadRequestException, Injectable } from '@nestjs/common';
import { UploadProvider } from '@/assets/upload/provider';
import { Asset, type AssetWithMethods } from '@/assets/asset.model';
import type { AssetService } from '@/assets/asset.service';
import type { IApiAsset, ISanitizeOptions } from '@/assets/asset.types';
import type {
    CreateUploadAssetDto,
    UpdateUploadAssetDto,
} from '@/assets/upload/dto/upload.dto';
import type {
    CreateWorldAssetDto,
    UpdateWorldAssetDto,
} from '@/assets/worlds/dto/world-asset.dto';
import type { IApiWorld } from '@/assets/worlds/worlds.types';
import { PrismaService } from '@/database/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { JobQueueService } from '@/jobs/job-queue.service';
import { WellKnownService } from '@/fediverse/well-known.service';
import { AppConfigService } from '@/config/config.service';
import type { UserWithMethods } from '@/users/user.model';
import type { Prisma } from '@/generated/prisma/client';

/** Asset type served by this provider (see `@AssetController('world', 'worlds')`). */
export const WORLD_ASSET_TYPE = 'world';

/** Default player capacity, mirroring the legacy `World.capacity` default. */
export const DEFAULT_WORLD_CAPACITY = 32;

/** `capacity` fits in an unsigned 16-bit integer, like the legacy world column. */
const MAX_WORLD_CAPACITY = 65535;

/**
 * Locally-hosted provider for **world** assets.
 *
 * Worlds reuse the whole generic asset pipeline (releases, files, images,
 * SDK/CI-CD upload, webhooks…) through {@link UploadProvider}; the only
 * addition is the world-specific `capacity` option, persisted in the asset
 * `metadata` JSON so no schema migration is needed.
 */
@Injectable()
export class WorldsProvider extends UploadProvider {
    constructor(
        private readonly db: PrismaService,
        storage: StorageService,
        wellKnown: WellKnownService,
        config: AppConfigService,
        jobs: JobQueueService,
    ) {
        super(db, storage, wellKnown, config, jobs);
    }

    /** This provider only handles world assets. */
    override get assetTypes(): readonly string[] {
        return [WORLD_ASSET_TYPE];
    }

    override async createAsset(
        type: string,
        dto: CreateUploadAssetDto,
        viewer: UserWithMethods,
        manager: AssetService,
    ): Promise<AssetWithMethods> {
        const capacity = normalizeCapacity((dto as CreateWorldAssetDto).capacity);
        const asset = await super.createAsset(type, dto, viewer, manager);
        return this.storeCapacity(asset, capacity, manager);
    }

    override async updateAsset(
        type: string,
        id: string,
        dto: UpdateUploadAssetDto,
        viewer: UserWithMethods,
        manager: AssetService,
    ): Promise<AssetWithMethods> {
        const asset = await super.updateAsset(type, id, dto, viewer, manager);
        const capacity = (dto as UpdateWorldAssetDto).capacity;
        if (capacity === undefined) return asset;
        return this.storeCapacity(asset, normalizeCapacity(capacity), manager);
    }

    override async sanitizeAsset(
        asset: AssetWithMethods,
        viewer?: UserWithMethods,
        options?: ISanitizeOptions,
    ): Promise<IApiWorld> {
        const base: IApiAsset = await super.sanitizeAsset(asset, viewer, options);
        return { ...base, capacity: readCapacity(asset) };
    }

    /** Persists the capacity into the asset `metadata` blob and returns the fresh entity. */
    private async storeCapacity(
        asset: AssetWithMethods,
        capacity: number,
        manager: AssetService,
    ): Promise<AssetWithMethods> {
        const updated = await this.db.assets.update({
            where: { type_id: { type: asset.type, id: asset.id } },
            data: {
                metadata: {
                    ...asRecord(asset.metadata),
                    capacity,
                } as Prisma.InputJsonObject,
            },
        });
        return Asset.attach(updated, manager, {});
    }
}

/** Validates a requested capacity, falling back to the default when omitted. */
function normalizeCapacity(value: unknown): number {
    if (value === undefined || value === null) return DEFAULT_WORLD_CAPACITY;
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_WORLD_CAPACITY
    ) {
        throw new BadRequestException(
            'capacity must be an integer between 0 and 65535',
        );
    }
    return value;
}

/** Reads the stored capacity, falling back to the default for legacy/missing values. */
function readCapacity(asset: AssetWithMethods): number {
    const raw = asRecord(asset.metadata).capacity;
    if (
        typeof raw === 'number' &&
        Number.isInteger(raw) &&
        raw >= 0 &&
        raw <= MAX_WORLD_CAPACITY
    ) {
        return raw;
    }
    return DEFAULT_WORLD_CAPACITY;
}

/** Copies a Prisma JSON value into a plain, mutable record. */
function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
}
