import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

import type {
  AssetFile as AssetFileRef,
  AssetImageInput,
  AssetSearchOptions,
  AssetSearchResult,
} from '@/assets/asset-provider.interface';
import type {
  IApiAsset,
  IApiFile,
  IApiRelease,
  IAnalysed,
  IStatus,
  ISanitizeOptions,
} from '@/assets/asset.types';
import {
  parseAnalysis,
  parseAttributes,
  parseProcessStatus,
  sanitizeStatus,
} from '@/assets/asset.types';
import type { IStatusProgress } from '@/assets/asset.types';
import type { AssetService } from '@/assets/asset.service';
import {
  searchAssetIds,
  searchFileIds,
  searchReleaseIds,
} from '@/assets/release-search';
import { Asset, type AssetWithMethods } from '@/assets/asset.model';
import {
  AssetRelease,
  type AssetReleaseWithMethods,
} from '@/assets/asset-release.model';
import {
  AssetFile,
  type AssetFileWithMethods,
} from '@/assets/asset-file.model';
import {
  getAssetControllerTypes,
  getAssetEndpoint,
} from '@/assets/asset-controller.registry';
import { PrismaService } from '@/database/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { JobQueueService } from '@/jobs/job-queue.service';
import { WellKnownService } from '@/fediverse/well-known.service';
import { AppConfigService } from '@/config/config.service';
import { NoxIdentifier } from '@/common/identifier';
import { Tags } from '@/common/tags';
import type { ApiImage } from '@/common/image.types';
import { Prisma } from '@/generated/prisma/client';
import type { AssetReleaseModel } from '@/generated/prisma/models/AssetRelease';
import type { AssetFileModel } from '@/generated/prisma/models/AssetFile';
import type { UserWithMethods } from '@/users/user.model';
import {
  isAssetUploadProvider,
  type IAssetUploadProvider,
  type UploadHeaders,
} from '@/assets/upload/upload-provider.interface';
import type {
  CreateUploadAssetDto,
  CreateUploadReleaseDto,
  InitUploadFileDto,
  UpdateUploadAssetDto,
  UpdateUploadReleaseDto,
} from '@/assets/upload/dto/upload.dto';
import { checkValidAssetFile } from '@/utils/assetbundle';
import type { AnalyzedAssetBundle } from '@/utils/assetbundle';
import { getUploadValidator } from '@/assets/upload/upload-validation';
import type { IApiAlias } from '@/common/alias.types';

/** MIME type used when an uploaded file does not advertise its own. */
const DEFAULT_UPLOAD_MIME = 'application/octet-stream';

/**
 * Default lifetime of an incomplete release / file slot before it expires.
 * Overridable via the `upload.expiration_ms` config key.
 */
const DEFAULT_UPLOAD_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/**
 * Default delay advertised through `refetch_at` while a resource is still
 * changing. Overridable via the `upload.refetch_ms` config key.
 */
const DEFAULT_REFETCH_MS = 5000;

/** How many stored keys are deleted per batch when purging a release. */
const STORAGE_DELETE_BATCH = 500;

/** Queue carrying the finalization of an upload (analysis, validation, storage). */
const UPLOAD_JOB_QUEUE = 'asset-upload';

/** Slot status while the bytes have not been received yet. */
const AWAITING_FILE_STATUS: IStatus = {
  status: 'awaiting',
  progress: null,
  message: 'Waiting for the file bytes',
};

/** Slot status once the bytes are received, until the analysis has run. */
const QUEUED_VALIDATION_STATUS: IStatus = {
  status: 'queued',
  progress: null,
  message: 'Waiting for the bundle analysis',
};

/** Slot status while the background analysis is running. */
const ANALYSIS_RUNNING_STATUS: IStatus = {
  status: 'processing',
  progress: null,
  message: 'Analyzing the uploaded bundle',
};

/**
 * Payload of an {@link UPLOAD_JOB_QUEUE} job. Receiving the bytes is the only
 * part that has to stay inside the request, so the job carries everything the
 * finalization needs once the response has been sent — including the temporary
 * file holding the received bytes, which the job deletes.
 */
interface UploadJobData {
  /** Asset type being uploaded (`mod`, `avatar`, `world`…). */
  type: string;
  /** Database id of the slot to finalize. */
  fileId: number;
  /** Temporary file holding the received bytes. */
  path: string;
  /** MIME type retained for the stored file. */
  mimetype: string;
  /** Slot attributes, handed to the type validator. */
  attributes: Record<string, string>;
}

/** Minimal release reference needed to recompute a release status. */
interface ReleaseRef {
  assetType: string;
  assetId: number;
  id: number;
}

/** Partial status update reported while a slot is processed. */
interface StatusUpdate {
  progress?: IStatusProgress | null;
  message?: string | null;
}

/**
 * A finalization running in this process, tracked so a deletion can stop it.
 * Keyed by slot id in {@link UploadProvider.running}.
 */
interface RunningUpload {
  assetType: string;
  assetId: number;
  releaseId: number;
  abort: AbortController;
}

/** Re-exported for `AssetService` type-guarding without importing the interface twice. */
export { isAssetUploadProvider };

/**
 * Locally-hosted asset provider: it owns assets/releases/files that were
 * uploaded directly to this node (via the SDK / CI-CD flow) instead of being
 * mirrored from an external source such as GitHub.
 *
 * The provider is deliberately generic: it serves every asset type registered
 * through `@AssetController(...)`, so a single instance handles `mod`, and any
 * future uploadable type, without change.
 */
@Injectable()
export class UploadProvider implements IAssetUploadProvider, OnModuleInit {
  readonly id = 'upload';
  private readonly logger = new Logger(UploadProvider.name);

  /**
   * The provider is instantiated once per asset type (and subclassed for
   * worlds), but they all share the same job queue: only the first instance
   * registers the handler.
   */
  private static handlerRegistered = false;

  /**
   * Finalizations running in this process, keyed by slot id.
   *
   * Deleting a slot, a release or an asset aborts the matching job(s) right
   * away, so no CPU is spent on a dead upload. It is only a fast path: every
   * write of a job re-checks that its slot still exists, which is what keeps
   * the deletion correct when the job runs in another process (bullmq worker).
   *
   * Static because the provider is instantiated once per asset type while the
   * job handler lives on a single instance.
   */
  private static readonly running = new Map<number, RunningUpload>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly wellKnown: WellKnownService,
    private readonly config: AppConfigService,
    private readonly jobs: JobQueueService,
  ) {}

  onModuleInit(): void {
    if (UploadProvider.handlerRegistered) return;
    UploadProvider.handlerRegistered = true;
    this.jobs.process<UploadJobData>(UPLOAD_JOB_QUEUE, (data) =>
      this.finalizeUpload(data),
    );
  }

  /** Every asset type registered with `@AssetController`, resolved lazily. */
  get assetTypes(): readonly string[] {
    return getAssetControllerTypes();
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  async search(
    type: string,
    options: AssetSearchOptions,
    manager: AssetService,
  ): Promise<AssetSearchResult<AssetWithMethods>> {
    // Text search, status filter, count and pagination all run in PostgreSQL:
    // only the requested page of assets is loaded here. By default the status
    // filter keeps the assets owning at least one **completed** release, so an
    // asset that was created but never uploaded is not listed.
    const { ids, total } = await searchAssetIds(
      this.prisma,
      { provider: this.id, type },
      options,
    );

    const records = ids.length
      ? await this.prisma.assets.findMany({
          where: { type, id: { in: ids } },
        })
      : [];
    const byId = new Map(records.map((record) => [record.id, record]));

    return {
      query: options.query ?? null,
      offset: options.offset,
      limit: options.limit,
      total,
      items: ids
        .map((id) => byId.get(id))
        .filter((record) => record !== undefined)
        .map((record) => Asset.attach(record, manager, {})),
    };
  }

  async getAsset(
    type: string,
    id: string,
    manager: AssetService,
  ): Promise<AssetWithMethods | null> {
    const record = await this.findAssetRow(type, id);
    if (!record) return null;
    return Asset.attach(record, manager, {});
  }

  async sanitizeAsset(
    asset: AssetWithMethods,
    _viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiAsset> {
    const server = await this.wellKnown.address();
    const preferred = this.preferredRelease(asset);
    const resolvedRelease =
      preferred ?? (await this.latestReleaseId(asset.type, asset.id));
    const endpoint = this.endpointFor(asset.type);

    return {
      type: asset.type,
      id: asset.id,
      name: asset.name,
      title: asset.title,
      images: await this.resolveImages(asset),
      description: asset.description,
      tags: [...asset.tags],
      server,
      owner: formatRef(asset.owner, server),
      contributors: (asset.contributor ?? []).map((ref) => formatRef(ref, server)),
      alias: [
        {
          key: 'api',
          value: new URL(
            `${endpoint}/${asset.id}`,
            await this.wellKnown.apiBaseUrl(),
          ).toString(),
        },
        { key: 'iid', value: `${asset.id}@${server}` },
        ...(asset.name ? [{ key: 'nid', value: `${asset.name}@${server}` }] : []),
      ],
      release: options?.expanded
        ? { auto: preferred === null, value: resolvedRelease }
        : resolvedRelease,
      created_at: asset.createdAt.getTime(),
      updated_at: asset.updatedAt.getTime(),
    };
  }

  async listReleases(
    type: string,
    id: string,
    manager: AssetService,
    searchOptions: AssetSearchOptions,
  ): Promise<AssetSearchResult<AssetReleaseWithMethods> | null> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) return null;

    // Text search, attribute filters, count and pagination all run in
    // PostgreSQL, so only the requested page of releases is loaded here.
    const { ids, total } = await searchReleaseIds(
      this.prisma,
      asset.type,
      asset.id,
      searchOptions,
    );

    return {
      query: searchOptions.query ?? null,
      offset: searchOptions.offset,
      limit: searchOptions.limit,
      total,
      items: await this.loadReleases(asset, ids, manager),
    };
  }

  /**
   * Loads a page of releases, preserving the id order returned by the database.
   * Their **files are never loaded** (the payload does not expose them).
   */
  private async loadReleases(
    asset: AssetWithMethods,
    ids: number[],
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.assetReleases.findMany({
      where: { assetType: asset.type, assetId: asset.id, id: { in: ids } },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    const releases: AssetReleaseWithMethods[] = [];
    for (const releaseId of ids) {
      const record = byId.get(releaseId);
      if (!record) continue;
      releases.push(this.attachRelease(record, asset, manager));
    }
    return releases;
  }

  async getRelease(
    type: string,
    id: string,
    version: string,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods | null> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) return null;
    const record = await this.findReleaseRow(type, asset.id, version);
    return record ? this.attachRelease(record, asset, manager) : null;
  }

  /**
   * Paginated files of **one** release (`GET …/releases/{version}/files`).
   *
   * The text search, the attribute filters, the count and the page all run in
   * PostgreSQL: a release holding a million files only ever loads the requested
   * page in the process.
   */
  async listFiles(
    type: string,
    id: string,
    releaseRef: string,
    searchOptions: AssetSearchOptions,
    manager: AssetService,
  ): Promise<AssetSearchResult<AssetFileWithMethods> | null> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) return null;
    const releaseRow = await this.findReleaseRow(type, asset.id, releaseRef);
    if (!releaseRow) return null;

    const { ids, total } = await searchFileIds(
      this.prisma,
      releaseRow,
      searchOptions,
    );
    const rows = ids.length
      ? await this.prisma.assetFiles.findMany({ where: { id: { in: ids } } })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const release = this.attachRelease(releaseRow, asset, manager);
    release.files = ids
      .map((fileId) => byId.get(fileId))
      .filter((row): row is AssetFileModel => row !== undefined)
      .map((row) => AssetFile.attach(row, manager, { release }));

    return {
      query: searchOptions.query ?? null,
      offset: searchOptions.offset,
      limit: searchOptions.limit,
      total,
      items: release.files,
    };
  }

  async getFile(
    type: string,
    id: string,
    version: string,
    name: string,
    manager: AssetService,
  ): Promise<AssetFileRef | null> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) return null;
    const release = await this.findReleaseRow(type, asset.id, version);
    if (!release) return null;
    const file = await this.findFileRow(release, name);
    if (!file || !file.url) return null;
    const stored = await this.storage.get(file.url);
    return { kind: 'redirect', url: stored.url.toString() };
  }

  async sanitizeRelease(
    release: AssetReleaseWithMethods,
    _viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiRelease> {
    const asset = release.getAsset();
    const server = await this.wellKnown.address();
    const endpoint = this.endpointFor(asset.type);
    const apiBase = await this.wellKnown.apiBaseUrl();
    const name = release.name ?? '';
    const expiresAt = parseExpiry(release.metadata);
    const refetchAt = await this.refetchAt(
      release.status?.status !== COMPLETED_STATUS.status ||
        (await this.hasPendingFiles(release)),
    );
    return {
      id: release.id,
      name,
      title: release.title,
      changelog: release.changelog,
      channel: release.channel,
      alias: [
        {
          key: 'api',
          value: new URL(
            `${endpoint}/${asset.id}/releases/${release.id}`,
            apiBase,
          ).toString(),
        },
        {
          key: 'iid',
          value: new NoxIdentifier(null, String(asset.id), server, {
            v: name,
          }).toString(null),
        },
      ],
      status: sanitizeStatus(release.status),
      ...(expiresAt !== null ? { expires_at: expiresAt } : {}),
      ...(refetchAt !== null ? { refetch_at: refetchAt } : {}),
    };
  }

  async sanitizeFile(
    file: AssetFileWithMethods,
    _viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiFile> {
    const release = file.getRelease();
    const asset = release.getAsset();
    const server = await this.wellKnown.address();
    const metadata = asRecord(file.metadata);
    const upload = asRecord(metadata.upload);
    const completed = !!file.url;

    const url = completed
      ? (await this.storage.get(file.url)).url.toString()
      : typeof upload.url === 'string'
        ? upload.url
        : '';

    const expiresAt = parseExpiry(metadata);
    const refetchAt = await this.refetchAt(!this.isFileStable(file));

    return {
      id: file.id,
      name: file.name ?? null,
      url: options?.expanded ? { proxified: url, original: url } : url,
      alias: [{ key: 'api', value: url }],
      size: Number(file.size),
      mime: file.mime,
      hashs: [...file.hashes],
      uploader: formatRef(file.uploader ?? NoxIdentifier.Invalid.toString(), server),
      status: sanitizeStatus(file.status),
      attributes: parseAttributes(file.attributes),
      analysis: parseAnalysis(metadata),
      created_at: file.createdAt.getTime(),
      updated_at: file.updatedAt.getTime(),
      signature: typeof upload.signature === 'string' ? upload.signature : null,
      ...(expiresAt !== null ? { expires_at: expiresAt } : {}),
      ...(refetchAt !== null ? { refetch_at: refetchAt } : {}),
    };
  }

  // ── Upload ───────────────────────────────────────────────────────────────────

  async createAsset(
    type: string,
    dto: CreateUploadAssetDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetWithMethods> {
    this.assertCanUpload(viewer);

    if (dto.id !== undefined) {
      const taken = await this.prisma.assets.findUnique({
        where: { type_id: { type, id: dto.id } },
      });
      if (taken)
        throw new BadRequestException(
          `id ${dto.id} is already taken for type "${type}"`,
        );
    }

    const name = dto.name?.trim() || null;
    if (name) {
      const existing = await this.prisma.assets.findUnique({
        where: { type_provider_name: { type, provider: this.id, name } },
      });
      if (existing) throw new BadRequestException(`Asset "${name}" already exists`);
    }

    const owner = (await viewer.identifier()).toString();
    const record = await this.guarded(name ? `Asset "${name}"` : 'Asset', () =>
      this.prisma.assets.create({
        data: {
          ...(dto.id !== undefined ? { id: dto.id } : {}),
          type,
          provider: this.id,
          name,
          title: dto.title?.trim() || name || 'Untitled',
          description: dto.description ?? null,
          tags: cleanTags(dto.tags),
          owner,
          contributor: [],
          metadata: {},
        },
      }),
    );

    this.logger.log(
      `Created upload asset ${type}/${name ?? `#${record.id}`} (#${record.id})`,
    );
    return Asset.attach(record, manager, {});
  }

  async createRelease(
    type: string,
    id: string,
    dto: CreateUploadReleaseDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    if (dto.id !== undefined) {
      const taken = await this.prisma.assetReleases.findUnique({
        where: {
          assetType_assetId_id: {
            assetType: asset.type,
            assetId: asset.id,
            id: dto.id,
          },
        },
      });
      if (taken)
        throw new BadRequestException(
          `release id ${dto.id} is already taken for this asset`,
        );
    }

    const name = dto.name?.trim() || null;
    if (name) {
      const existing = await this.prisma.assetReleases.findFirst({
        where: { assetType: asset.type, assetId: asset.id, name },
      });
      if (existing) throw new BadRequestException(`Release "${name}" already exists`);
    }

    const expiresAt = await this.expiryDate();
    const record = await this.guarded(
      name ? `Release "${name}"` : 'Release',
      () =>
        this.prisma.assetReleases.create({
          data: {
            ...(dto.id !== undefined ? { id: dto.id } : {}),
            assetType: asset.type,
            assetId: asset.id,
            name,
            title: dto.title?.trim() || name || 'Untitled',
            changelog: dto.changelog ?? null,
            channel: dto.channel ?? 'stable',
            metadata: {
              // A release without any completed file is incomplete: it is
              // `awaiting` and expires. Both are resolved once its first file is
              // finalized.
              status: statusJson(RELEASE_AWAITING_STATUS),
              expires_at: expiresAt,
            } as Prisma.InputJsonObject,
          },
          include: { files: true },
        }),
    );

    return this.attachRelease(record, asset, manager);
  }

  async initFile(
    type: string,
    id: string,
    releaseRef: string,
    dto: InitUploadFileDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetFileWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    const releaseRow = await this.findReleaseRow(type, asset.id, releaseRef);
    if (!releaseRow)
      throw new NotFoundException(`Release not found: ${releaseRef}`);
    const release = this.attachRelease(releaseRow, asset, manager);

    const name = dto.name?.trim() || null;
    if (name) {
      const existing = await this.prisma.assetFiles.findFirst({
        where: {
          releaseAssetType: release.assetType,
          releaseAssetId: release.assetId,
          releaseId: release.id,
          name,
        },
        select: { id: true },
      });
      if (existing)
        throw new BadRequestException(
          `File "${name}" already exists in release "${release.name}"`,
        );
    }

    const attributes = (dto.attributes ?? []).map((attribute) => ({
      key: attribute.key,
      value: attribute.value,
    }));
    const waitingStatus = statusJson(AWAITING_FILE_STATUS);
    // A reserved slot is incomplete until its file is uploaded: it expires too.
    const expiresAt = await this.expiryDate();
    const uploader = (await viewer.identifier()).toString();
    const record = await this.guarded(name ? `File "${name}"` : 'File', () =>
      this.prisma.assetFiles.create({
        data: {
          releaseAssetType: release.assetType,
          releaseAssetId: release.assetId,
          releaseId: release.id,
          name,
          url: '',
          size: BigInt(0),
          mime: dto.mime ?? DEFAULT_UPLOAD_MIME,
          attributes,
          hashes: [],
          uploader,
          metadata: {
            status: waitingStatus,
            expires_at: expiresAt,
          } as Prisma.InputJsonObject,
        } as unknown as Prisma.AssetFileCreateInput,
      }),
    );

    const uploadUrl = await this.uploadUrl(type, asset.id, release.id, record.id);
    const updated = await this.prisma.assetFiles.update({
      where: { id: record.id },
      data: {
        metadata: {
          status: waitingStatus,
          expires_at: expiresAt,
          upload: { url: uploadUrl },
        } as Prisma.InputJsonObject,
      },
    });

    return AssetFile.attach(updated, manager, { release });
  }

  async storeFile(
    type: string,
    id: string,
    releaseRef: string,
    fileId: number,
    stream: Readable,
    contentType: string | undefined,
    headers: UploadHeaders,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetFileWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    const releaseRow = await this.findReleaseRow(type, asset.id, releaseRef);
    if (!releaseRow)
      throw new NotFoundException(`Release not found: ${releaseRef}`);
    const release = this.attachRelease(releaseRow, asset, manager);

    // Only the slot being written is loaded, not the whole release.
    const fileRecord = await this.findFileRow(release, String(fileId));
    if (!fileRecord) throw new NotFoundException(`File not found: ${fileId}`);
    const file = AssetFile.attach(fileRecord, manager, { release });
    release.files = [file];

    const metadata = asRecord(file.metadata);
    const upload = asRecord(metadata.upload);
    const attributes = parseAttributes(file.attributes);
    if (file.url)
      throw new BadRequestException('File has already been uploaded');

    // The slot may be unnamed: fall back to the filename advertised by the
    // upload (`Content-Disposition`), just like the MIME type comes from
    // `Content-Type`. An explicit slot name always wins.
    const resolvedName = file.name ?? parseFilename(headers.disposition);
    if (!file.name && resolvedName) {
      const clash = await this.prisma.assetFiles.findFirst({
        where: {
          releaseAssetType: release.assetType,
          releaseAssetId: release.assetId,
          releaseId: release.id,
          name: resolvedName,
        },
      });
      if (clash)
        throw new BadRequestException(
          `File "${resolvedName}" already exists in release "${release.name}"`,
        );
    }

    const mimetype = contentType?.split(';')[0]?.trim() || file.mime || DEFAULT_UPLOAD_MIME;

    let streamed;
    try {
      streamed = await this.streamToTempFile(stream);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markFileFailed(file.id, message);
      throw new BadRequestException(message);
    }
    const { path: tmpPath, hash, size } = streamed;

    // Optional integrity headers: cross-check what the client advertised.
    if (headers.length !== undefined && headers.length !== '') {
      const expectedLength = Number(headers.length);
      if (
        Number.isFinite(expectedLength) &&
        expectedLength >= 0 &&
        expectedLength !== size
      ) {
        await unlink(tmpPath).catch(() => { /* best-effort */ });
        const message = `Content-Length mismatch: expected ${expectedLength}, received ${size}`;
        await this.markFileFailed(file.id, message);
        throw new BadRequestException(message);
      }
    }
    const advertisedHash = headers.hash ? normalizeHash(headers.hash) : null;
    if (advertisedHash && advertisedHash !== hash) {
      await unlink(tmpPath).catch(() => { /* best-effort */ });
      await this.markFileFailed(file.id, 'Content-Hash mismatch');
      throw new BadRequestException('Content-Hash mismatch');
    }

    // The bytes are received and verified: the rest of the pipeline (bundle
    // analysis, type validation and storage) is handed to a background job, so
    // a large bundle never keeps the request open. The slot stays `queued`
    // (waiting for the validation) until the job turns it into `completed` or
    // `failed`; `refetch_at` tells the client when to look again. An uploaded
    // slot no longer has a deadline — only `awaiting` and `failed` ones expire.
    const pendingMetadata: Record<string, unknown> = {
      ...metadata,
      status: statusJson(QUEUED_VALIDATION_STATUS),
      upload: {
        url: upload.url,
        hash,
        size,
        mime: mimetype,
        signature: headers.signature ?? null,
      },
    };
    delete pendingMetadata.expires_at;

    let updated;
    try {
      updated = await this.guarded(
        resolvedName ? `File "${resolvedName}"` : 'File',
        () =>
          this.prisma.assetFiles.update({
            where: { id: file.id },
            data: {
              name: resolvedName,
              size: BigInt(size),
              mime: mimetype,
              hashes: [`sha256:${hash}`],
              metadata: pendingMetadata as unknown as Prisma.InputJsonObject,
            },
          }),
      );
      await this.jobs.add<UploadJobData>(UPLOAD_JOB_QUEUE, {
        type,
        fileId: file.id,
        path: tmpPath,
        mimetype,
        attributes: toAttributeMap(attributes),
      });
    } catch (error) {
      // No job owns the received bytes yet: drop them before failing.
      await unlink(tmpPath).catch(() => { /* best-effort */ });
      throw error;
    }

    return AssetFile.attach(updated, manager, { release });
  }

  /**
   * Finalizes an upload out of band: analyzes the received bundle, runs the
   * type-specific validator, stores the bytes, then flips the slot to
   * `completed`. The temporary file is deleted in every case, and a rejection
   * (analysis or validation) leaves the slot `failed` so the client can retry
   * the very same slot.
   */
  private async finalizeUpload(data: UploadJobData): Promise<void> {
    try {
      const file = await this.prisma.assetFiles.findUnique({
        where: { id: data.fileId },
      });
      // The slot (or its release/asset) was deleted before the job ran.
      if (!file) return;

      if (!(await this.setFileStatus(data.fileId, ANALYSIS_RUNNING_STATUS)))
        return;

      // Publish the run so a deletion can abort it (kills the analyzer at once).
      const cancellation = new AbortController();
      UploadProvider.running.set(data.fileId, {
        assetType: file.releaseAssetType,
        assetId: file.releaseAssetId,
        releaseId: file.releaseId,
        abort: cancellation,
      });

      // The analyzer streams `::progress::<current> <total> <message>` lines:
      // forward them to the slot so a polling client follows the analysis live
      // (`status.progress` / `status.message`).
      const reporter = this.createProgressReporter(data.fileId);
      let analyzed: AnalyzedAssetBundle;
      try {
        analyzed = await checkValidAssetFile(data.path, {
          signal: cancellation.signal,
          onEvent: (event) => {
            if (event.type === 'progress')
              reporter.report({
                // Unknown steps are left out: the slot keeps the last known ones.
                ...(event.current !== null && event.total !== null
                  ? { progress: { current: event.current, total: event.total } }
                  : {}),
                ...(event.message ? { message: event.message } : {}),
              });
            else reporter.report({ message: event.message });
          },
        });
      } catch (error) {
        // Cancelled: the slot is gone, there is nothing left to fail.
        if (cancellation.signal.aborted) {
          this.logger.debug(
            `Upload of file ${data.fileId} cancelled: its slot was deleted`,
          );
          return;
        }
        throw error;
      }

      const validator = getUploadValidator(data.type);
      const analysis: IAnalysed | null = validator
        ? (validator(analyzed, {
            type: data.type,
            attributes: data.attributes,
          }) ?? null)
        : null;

      // Do not store bytes for a slot that vanished while its bundle was parsed.
      if (!(await this.fileExists(data.fileId))) {
        this.logger.debug(
          `Upload of file ${data.fileId} cancelled before storing its bytes`,
        );
        return;
      }

      const stored = await this.storage.store({
        source: data.path,
        mimetype: data.mimetype,
      });

      // Nothing may overwrite the terminal status once the file is finalized.
      await reporter.close();

      const current = await this.prisma.assetFiles.findUnique({
        where: { id: data.fileId },
      });
      if (!current) {
        // Deleted while the analysis was running: drop what we just stored.
        await this.storage.delete(stored.key).catch(() => { /* best-effort */ });
        return;
      }

      const currentMetadata = asRecord(current.metadata);
      const completedMetadata: Record<string, unknown> = {
        ...currentMetadata,
        status: statusJson(COMPLETED_STATUS),
        analysis,
        upload: { ...asRecord(currentMetadata.upload), key: stored.key },
      };
      delete completedMetadata.expires_at;

      const written = await this.prisma.assetFiles.updateMany({
        where: { id: data.fileId },
        data: {
          url: stored.key,
          metadata: completedMetadata as unknown as Prisma.InputJsonObject,
        },
      });
      if (written.count === 0) {
        await this.storage.delete(stored.key).catch(() => { /* best-effort */ });
        return;
      }

      await this.refreshReleaseState({
        assetType: file.releaseAssetType,
        assetId: file.releaseAssetId,
        id: file.releaseId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.debug(
          `Upload of file ${data.fileId} cancelled while analyzing`,
        );
        return;
      }
      this.logger.warn(
        `Upload finalization failed for file ${data.fileId}: ${message}`,
      );
      await this.markFileFailed(data.fileId, message);
    } finally {
      UploadProvider.running.delete(data.fileId);
      await unlink(data.path).catch(() => { /* best-effort */ });
    }
  }

  /**
   * Throttled writer for the live analysis progress: at most one update per
   * `intervalMs`, and never after {@link close}.
   *
   * The throttle is *trailing* — the last value received during a window is
   * written when the window closes — so no message of the analyzer is lost and
   * the slot never keeps a stale message. Only slots still `processing` are
   * touched, which also covers a slot deleted meanwhile.
   */
  private createProgressReporter(fileId: number, intervalMs = 400) {
    let closed = false;
    let scheduled = false;
    let timer: NodeJS.Timeout | null = null;
    let lastWrite = 0;
    let queued: Promise<void> = Promise.resolve();
    let latest: StatusUpdate = {};

    const flush = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      scheduled = false;
      if (!Object.keys(latest).length) return;
      const update = latest;
      latest = {};
      lastWrite = Date.now();
      queued = queued
        .then(() => this.setFileProgress(fileId, update))
        .then(() => undefined)
        .catch(() => {
          /* best-effort: the slot may be gone */
        });
    };

    return {
      report: (update: StatusUpdate): void => {
        if (closed) return;
        latest = { ...latest, ...update };
        const elapsed = Date.now() - lastWrite;
        if (elapsed >= intervalMs) {
          flush();
          return;
        }
        if (scheduled) return;
        scheduled = true;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        timer = setTimeout(flush, intervalMs - elapsed);
        timer.unref?.();
      },
      close: async (): Promise<void> => {
        closed = true;
        flush();
        await queued;
      },
    };
  }

  /**
   * Updates the `processing` progress/message of a slot, leaving its status
   * alone when it is no longer `processing` (finalized or failed meanwhile).
   * Returns false when nothing was written.
   */
  private async setFileProgress(
    fileId: number,
    update: StatusUpdate,
  ): Promise<boolean> {
    const file = await this.prisma.assetFiles.findUnique({
      where: { id: fileId },
    });
    if (!file) return false;

    const metadata = asRecord(file.metadata);
    const current = parseProcessStatus(metadata);
    if (current?.status !== ANALYSIS_RUNNING_STATUS.status) return false;

    const status: IStatus = {
      status: 'processing',
      progress: update.progress !== undefined ? update.progress : current.progress,
      message: update.message !== undefined ? update.message : current.message,
    };
    const written = await this.prisma.assetFiles.updateMany({
      where: { id: fileId },
      data: {
        metadata: {
          ...metadata,
          status: statusJson(status),
        } as unknown as Prisma.InputJsonObject,
      },
    });
    return written.count > 0;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async updateAsset(
    type: string,
    id: string,
    dto: UpdateUploadAssetDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name?.trim() || null;
      if (name) {
        const clash = await this.prisma.assets.findUnique({
          where: { type_provider_name: { type, provider: this.id, name } },
        });
        if (clash && clash.id !== asset.id)
          throw new BadRequestException(`Asset "${name}" already exists`);
      }
      data.name = name;
    }
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.tags !== undefined) data.tags = cleanTags(dto.tags);
    if (dto.release !== undefined) {
      if (dto.release === null) {
        // Back to `auto`: the latest release is used.
        data.release = null;
      } else {
        const target = await this.prisma.assetReleases.findFirst({
          where: {
            id: dto.release,
            assetType: asset.type,
            assetId: asset.id,
          },
        });
        if (!target)
          throw new BadRequestException(
            `Release ${dto.release} does not belong to this asset`,
          );
        data.release = target.id;
      }
    }

    const updated = await this.guarded('Asset name', () =>
      this.prisma.assets.update({
        where: { type_id: { type: asset.type, id: asset.id } },
        data: data as unknown as Prisma.AssetUpdateInput,
      }),
    );
    return Asset.attach(updated, manager, {});
  }

  async updateRelease(
    type: string,
    id: string,
    version: string,
    dto: UpdateUploadReleaseDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    // Only the release row is needed for the checks: the updated release (with
    // its files) is loaded once, at the end.
    const release = await this.findReleaseRow(type, asset.id, version);
    if (!release) throw new NotFoundException(`Release not found: ${version}`);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name?.trim() || null;
      if (name && name !== release.name) {
        const clash = await this.prisma.assetReleases.findFirst({
          where: { assetType: asset.type, assetId: asset.id, name },
        });
        if (clash)
          throw new BadRequestException(`Release "${name}" already exists`);
      }
      data.name = name;
    }
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.changelog !== undefined) data.changelog = dto.changelog ?? null;
    if (dto.channel !== undefined) data.channel = dto.channel;

    const updated = await this.guarded('Release name', () =>
      this.prisma.assetReleases.update({
        where: {
          assetType_assetId_id: {
            assetType: release.assetType,
            assetId: release.assetId,
            id: release.id,
          },
        },
        data: data as unknown as Prisma.AssetReleaseUpdateInput,
        include: { files: true },
      }),
    );
    return this.attachRelease(updated, asset, manager);
  }

  // ── Status ───────────────────────────────────────────────────────────────────

  async getFileStatus(
    type: string,
    id: string,
    releaseRef: string,
    fileRef: string,
    _viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetFileWithMethods | null> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    const release = await this.findReleaseRow(type, asset.id, releaseRef);
    if (!release)
      throw new NotFoundException(`Release not found: ${releaseRef}`);

    const row = await this.findFileRow(release, fileRef);
    if (!row) return null;
    return this.attachSingleFile(release, row, asset, manager);
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async deleteAsset(
    type: string,
    id: string,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<void> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    // Stop the uploads still running for this asset (its whole tree goes away).
    this.abortRuns(
      (run) => run.assetType === asset.type && run.assetId === asset.id,
    );

    // Stored bytes are deleted release by release, in bounded batches: a release
    // may hold a very large number of files.
    const releases = await this.prisma.assetReleases.findMany({
      where: { assetType: asset.type, assetId: asset.id },
      select: { id: true },
    });
    for (const release of releases)
      await this.deleteStoredFilesOf({
        assetType: asset.type,
        assetId: asset.id,
        id: release.id,
      });

    const imageKeys = this.imageRefs(asset).map((ref) =>
      typeof ref.key === 'string' ? ref.key : null,
    );
    await this.deleteStoredFiles(imageKeys);
    // Releases and files are removed by the `onDelete: Cascade` relations.
    await this.prisma.assets.delete({
      where: { type_id: { type: asset.type, id: asset.id } },
    });
  }

  async deleteRelease(
    type: string,
    id: string,
    version: string,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<void> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    const release = await this.findReleaseRow(type, asset.id, version);
    if (!release) throw new NotFoundException(`Release not found: ${version}`);

    // Stop the uploads still running for this release.
    this.abortRuns(
      (run) =>
        run.assetType === release.assetType &&
        run.assetId === release.assetId &&
        run.releaseId === release.id,
    );

    await this.deleteStoredFilesOf(release);
    await this.prisma.assetReleases.delete({
      where: {
        assetType_assetId_id: {
          assetType: release.assetType,
          assetId: release.assetId,
          id: release.id,
        },
      },
    });

    // Cascade: an asset preferring this release falls back to `auto`.
    if (this.preferredRelease(asset) === release.id) {
      await this.prisma.assets.update({
        where: { type_id: { type: asset.type, id: asset.id } },
        data: { release: null } as unknown as Prisma.AssetUpdateInput,
      });
    }
  }

  async deleteFile(
    type: string,
    id: string,
    version: string,
    name: string,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<void> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    const release = await this.findReleaseRow(type, asset.id, version);
    if (!release) throw new NotFoundException(`Release not found: ${version}`);

    // Files are immutable: they can only be created or deleted, never updated.
    const file = await this.findFileRow(release, name);
    if (!file) throw new NotFoundException(`File not found: ${name}`);

    // Stop the upload still running for this slot.
    this.abortRuns((_run, fileId) => fileId === file.id);

    await this.deleteStoredFiles([file.url]);
    await this.prisma.assetFiles.delete({ where: { id: file.id } });
    // A release left without any file goes back to `awaiting` (and expires
    // again).
    await this.refreshReleaseState(release);
  }

  /** True while the slot still exists (used by jobs before storing anything). */
  private async fileExists(fileId: number): Promise<boolean> {
    const file = await this.prisma.assetFiles.findFirst({
      where: { id: fileId },
      select: { id: true },
    });
    return file !== null;
  }

  /**
   * Aborts the finalizations matching `match`, killing their analyzer process.
   * Called by the delete routes so a removed slot stops costing CPU at once.
   */
  private abortRuns(
    match: (run: RunningUpload, fileId: number) => boolean,
  ): void {
    for (const [fileId, run] of UploadProvider.running) {
      if (!match(run, fileId)) continue;
      this.logger.debug(`Cancelling the upload job of file ${fileId}`);
      run.abort.abort();
    }
  }

  /** Best-effort deletion of stored files by their storage key. */
  private async deleteStoredFiles(urls: Array<string | null>): Promise<void> {
    const keys = urls.filter((url): url is string => !!url);
    await Promise.all(
      keys.map((key) =>
        this.storage.delete(key).catch(() => { /* best-effort */ }),
      ),
    );
  }

  /**
   * Deletes the stored bytes of **every** file of a release, in bounded batches
   * so a release holding a huge number of files never has to be loaded at once.
   */
  private async deleteStoredFilesOf(release: ReleaseRef): Promise<void> {
    let cursor: number | undefined;
    for (;;) {
      const batch = await this.prisma.assetFiles.findMany({
        where: {
          releaseAssetType: release.assetType,
          releaseAssetId: release.assetId,
          releaseId: release.id,
        },
        select: { id: true, url: true },
        orderBy: { id: 'asc' },
        take: STORAGE_DELETE_BATCH,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (batch.length === 0) return;
      await this.deleteStoredFiles(batch.map((file) => file.url));
      if (batch.length < STORAGE_DELETE_BATCH) return;
      cursor = batch[batch.length - 1].id;
    }
  }

  // ── Images ───────────────────────────────────────────────────────────────────

  async addImage(
    type: string,
    id: string,
    image: AssetImageInput,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    // The image metadata (dimensions, …) is persisted by the storage alongside
    // the file; the asset only keeps an ordered reference to the stored file.
    const stored = await this.storage.store({
      source: image.source,
      mimetype: image.mimetype,
      metadata: await readImageDimensions(image.source),
    });

    const images = this.imageRefs(asset);
    images.push({ key: stored.key, priority: images.length, alt: null });

    const updated = await this.prisma.assets.update({
      where: { type_id: { type: asset.type, id: asset.id } },
      data: { images } as unknown as Prisma.AssetUpdateInput,
    });
    return Asset.attach(updated, manager, {});
  }

  async removeImage(
    type: string,
    id: string,
    index: number,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods> {
    const asset = await this.getAsset(type, id, manager);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    await this.assertCanModify(asset, viewer);

    const images = this.imageRefs(asset);
    if (!Number.isInteger(index) || index < 0 || index >= images.length)
      throw new NotFoundException(`Image ${index} not found`);

    const [removed] = images.splice(index, 1);
    const key = typeof removed.key === 'string' ? removed.key : null;
    if (key) await this.storage.delete(key).catch(() => { /* best-effort */ });

    const updated = await this.prisma.assets.update({
      where: { type_id: { type: asset.type, id: asset.id } },
      data: { images } as unknown as Prisma.AssetUpdateInput,
    });
    return Asset.attach(updated, manager, {});
  }

  /** Ordered image references stored on the asset (column `images`). */
  private imageRefs(asset: AssetWithMethods): Array<Record<string, unknown>> {
    const raw = (asset as unknown as { images?: unknown }).images;
    return Array.isArray(raw) ? raw.map((entry) => asRecord(entry)) : [];
  }

  /** Resolves the asset image references into API images. */
  private async resolveImages(asset: AssetWithMethods): Promise<ApiImage[]> {
    const refs = this.imageRefs(asset);
    const images: ApiImage[] = [];
    for (let index = 0; index < refs.length; index++) {
      const ref = refs[index];
      const priority = typeof ref.priority === 'number' ? ref.priority : index;
      const alt = typeof ref.alt === 'string' ? ref.alt : null;

      // Local image — resolve URL and dimensions from the storage metadata.
      if (typeof ref.key === 'string' && ref.key) {
        try {
          const info = await this.storage.get(ref.key);
          const metadata = asRecord(info.metadata);
          images.push({
            url: info.url.toString(),
            priority,
            width: typeof metadata.width === 'number' ? metadata.width : 0,
            height: typeof metadata.height === 'number' ? metadata.height : 0,
            alt,
          });
          continue;
        } catch {
          /* stored file missing — fall through to any external URL */
        }
      }

      // External image — referenced directly by URL.
      if (typeof ref.url === 'string' && ref.url) {
        images.push({
          url: ref.url,
          priority,
          width: typeof ref.width === 'number' ? ref.width : 0,
          height: typeof ref.height === 'number' ? ref.height : 0,
          alt,
        });
      }
    }
    return images;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async findAssetRow(type: string, id: string) {
    if (/^\d+$/.test(id)) {
      const numeric = Number(id);
      if (Number.isSafeInteger(numeric)) {
        const record = await this.prisma.assets.findUnique({
          where: { type_id: { type, id: numeric } },
        });
        if (record && record.provider === this.id) return record;
      }
    }
    return this.prisma.assets.findUnique({
      where: { type_provider_name: { type, provider: this.id, name: id } },
    });
  }

  /**
   * Where-clause resolving a release from its id or its name (a numeric value
   * matches the id first, then the name).
   */
  private releaseWhere(type: string, assetId: number, version: string) {
    return {
      assetType: type,
      assetId,
      ...(/^\d+$/.test(version)
        ? { OR: [{ id: Number(version) }, { name: version }] }
        : { name: version }),
    };
  }

  /**
   * Loads a release row **without** its files. A release can hold a very large
   * number of files, and their content is never part of a release payload —
   * only `GET …/releases/{version}/files` paginates them.
   */
  private async findReleaseRow(
    type: string,
    assetId: number,
    version: string,
  ): Promise<AssetReleaseModel | null> {
    return this.prisma.assetReleases.findFirst({
      where: this.releaseWhere(type, assetId, version),
    });
  }

  /**
   * Loads **one** file of a release straight from the database: indexed by its
   * id, or by the `(release, name)` unique key — never by walking the files of
   * the release, which is what makes a 1M-file release unaffordable.
   *
   * `reference` is a numeric file id or a file name.
   */
  private async findFileRow(
    release: ReleaseRef,
    reference: string,
  ): Promise<AssetFileModel | null> {
    const scope = {
      releaseAssetType: release.assetType,
      releaseAssetId: release.assetId,
      releaseId: release.id,
    };
    const numeric = /^\d+$/.test(reference) ? Number(reference) : null;
    if (numeric !== null) {
      const byId = await this.prisma.assetFiles.findFirst({
        where: { ...scope, id: numeric },
      });
      if (byId) return byId;
    }
    return this.prisma.assetFiles.findFirst({
      where: { ...scope, name: reference },
    });
  }

  /** Attaches a single file to a release row loaded without its files. */
  private attachSingleFile(
    releaseRecord: AssetReleaseModel,
    fileRecord: AssetFileModel,
    asset: AssetWithMethods,
    manager: AssetService,
  ): AssetFileWithMethods {
    const release = this.attachRelease(releaseRecord, asset, manager);
    const file = AssetFile.attach(fileRecord, manager, { release });
    release.files = [file];
    return file;
  }

  private attachRelease(
    record: AssetReleaseModel & { files?: AssetFileModel[] },
    asset: AssetWithMethods,
    manager: AssetService,
  ): AssetReleaseWithMethods {
    const release = AssetRelease.attach(record, manager, { asset });
    release.files = (record.files ?? []).map((file) =>
      AssetFile.attach(file, manager, { release }),
    );
    return release;
  }

  private async latestReleaseId(type: string, assetId: number): Promise<number> {
    const record = await this.prisma.assetReleases.findFirst({
      where: { assetType: type, assetId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return record?.id ?? -1;
  }

  private endpointFor(type: string): string {
    return getAssetEndpoint(type) ?? type;
  }

  private async uploadUrl(
    type: string,
    assetId: number,
    releaseId: number,
    fileId: number,
  ): Promise<string> {
    return new URL(
      `${this.endpointFor(type)}/${assetId}/releases/${releaseId}/files/${fileId}`,
      await this.wellKnown.apiBaseUrl(),
    ).toString();
  }

  private async markFileFailed(fileId: number, message: string): Promise<void> {
    // A rejected slot can be retried, so it gets back a deadline.
    await this.setFileStatus(
      fileId,
      {
        status: 'failed',
        progress: null,
        message,
      },
      { expires: 'refresh' },
    );
  }

  /**
   * Replaces the processing status of a slot, leaving the rest of its metadata
   * untouched. `expires` refreshes (`awaiting` / `failed`) or clears (an
   * uploaded slot) the deadline; by default it is left as is.
   *
   * Returns false when the slot is gone (deleted in the meantime), so
   * background jobs never fail on a race with a deletion.
   */
  private async setFileStatus(
    fileId: number,
    status: IStatus,
    options: { expires?: 'refresh' | 'clear' | 'keep' } = {},
  ): Promise<boolean> {
    const file = await this.prisma.assetFiles.findUnique({
      where: { id: fileId },
    });
    if (!file) return false;

    const metadata: Record<string, unknown> = {
      ...asRecord(file.metadata),
      status: statusJson(status),
    };
    if (options.expires === 'refresh')
      metadata.expires_at = await this.expiryDate();
    else if (options.expires === 'clear') delete metadata.expires_at;

    const written = await this.prisma.assetFiles.updateMany({
      where: { id: fileId },
      data: { metadata: metadata as unknown as Prisma.InputJsonObject },
    });
    return written.count > 0;
  }

  /** ISO timestamp at which an incomplete release/slot should expire. */
  private async expiryDate(): Promise<string> {
    const configured = await this.config.getOptional<number>('upload.expiration_ms');
    const ttl =
      typeof configured === 'number' && configured > 0
        ? configured
        : DEFAULT_UPLOAD_EXPIRATION_MS;
    return new Date(Date.now() + ttl).toISOString();
  }

  /**
   * Re-derives a release state from its files: `completed` (with its expiration
   * cleared) as soon as one file has been uploaded, `awaiting` again (with a
   * fresh expiration) when no file is left.
   */
  private async refreshReleaseState(release: ReleaseRef): Promise<void> {
    const uploaded = await this.prisma.assetFiles.count({
      where: {
        releaseAssetType: release.assetType,
        releaseAssetId: release.assetId,
        releaseId: release.id,
        url: { not: '' },
      },
    });

    const record = await this.prisma.assetReleases.findUnique({
      where: {
        assetType_assetId_id: {
          assetType: release.assetType,
          assetId: release.assetId,
          id: release.id,
        },
      },
    });
    if (!record) return;

    const metadata = asRecord(record.metadata);
    const current = asRecord(metadata.status).status;
    if (uploaded > 0) {
      const alreadyComplete =
        !('expires_at' in metadata) && current === COMPLETED_STATUS.status;
      if (alreadyComplete) return;
      delete metadata.expires_at;
      metadata.status = statusJson(COMPLETED_STATUS);
    } else {
      const alreadyAwaiting =
        'expires_at' in metadata && current === RELEASE_AWAITING_STATUS.status;
      if (alreadyAwaiting) return;
      metadata.status = statusJson(RELEASE_AWAITING_STATUS);
      metadata.expires_at = await this.expiryDate();
    }

    await this.prisma.assetReleases.update({
      where: {
        assetType_assetId_id: {
          assetType: release.assetType,
          assetId: release.assetId,
          id: release.id,
        },
      },
      data: { metadata: metadata as unknown as Prisma.InputJsonObject },
    });
  }

  /**
   * True when the release still holds a slot waiting for its bytes or being
   * validated. It is resolved **in the database**: loading the files of the
   * release just to look at their status is what makes a 1M-file release
   * unaffordable.
   *
   * A slot is pending while it has no stored `url` and has not failed — the SQL
   * twin of `isFileStable()`.
   */
  private async hasPendingFiles(release: ReleaseRef): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`SELECT count(*)::int AS total
        FROM "asset_files" f
        WHERE f."release_asset_type" = ${release.assetType}
          AND f."release_asset_id" = ${release.assetId}
          AND f."release_id" = ${release.id}
          AND COALESCE(f."url", '') = ''
          AND COALESCE(f."metadata"->'status'->>'status', 'awaiting') <> 'failed'`,
    );
    return Number(rows?.[0]?.total ?? 0) > 0;
  }

  /** A file is stable once it is uploaded or has failed (retryable, but not polled). */
  private isFileStable(file: AssetFileWithMethods): boolean {
    return !!file.url || file.status?.status === 'failed';
  }

  /**
   * Refetch hint exposed by the API: `null` when the resource is stable,
   * otherwise the epoch ms after which the SDK should GET it again.
   */
  private async refetchAt(pending: boolean): Promise<number | null> {
    if (!pending) return null;
    const configured = await this.config.getOptional<number>('upload.refetch_ms');
    const delay =
      typeof configured === 'number' && configured > 0
        ? configured
        : DEFAULT_REFETCH_MS;
    return Date.now() + delay;
  }

  /** Preferred release id stored on the asset (`null` = auto → latest release). */
  private preferredRelease(asset: AssetWithMethods): number | null {
    const value = (asset as unknown as { release?: unknown }).release;
    return typeof value === 'number' ? value : null;
  }

  private async streamToTempFile(
    stream: Readable,
  ): Promise<{ path: string; hash: string; size: number }> {
    const path = join(tmpdir(), `nox-upload-${randomBytes(12).toString('hex')}`);
    const digest = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        digest.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, createWriteStream(path));
    } catch (error) {
      await unlink(path).catch(() => { /* best-effort */ });
      throw new BadRequestException('Failed to receive the uploaded file', {
        cause: error,
      });
    }
    return { path, hash: digest.digest('hex'), size };
  }

  private assertCanUpload(viewer: UserWithMethods): void {
    if (viewer.isAdmin()) return;
    if (Tags.has(viewer.tags, Tags.MODERATION, 'can_file_upload')) return;
    throw new ForbiddenException('Missing "can_file_upload" permission');
  }

  private async assertCanModify(
    asset: AssetWithMethods,
    viewer: UserWithMethods,
  ): Promise<void> {
    if (viewer.isAdmin()) return;
    const user = await viewer.identifier();
    const owner = NoxIdentifier.parse(asset.owner);
    if (owner.equals(user, false)) return;
    const contributors = (asset.contributor ?? []).map((ref) => NoxIdentifier.parse(ref));
    if (contributors.some((ref) => ref.equals(user, false))) return;
    throw new ForbiddenException('Not allowed to modify this asset');
  }

  /**
   * Runs a write that may hit a unique constraint. The availability is checked
   * beforehand, but a concurrent request can take the name in between — in that
   * case Prisma throws `P2002`, which is translated into a plain `400` instead
   * of a `500`.
   */
  private async guarded<T>(
    conflict: string,
    write: () => PromiseLike<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error))
        throw new BadRequestException(`${conflict} is already taken`);
      throw error;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const COMPLETED_STATUS: IStatus = {
  status: 'completed',
  progress: null,
  message: null,
};

/** Status of a release that has not received any completed file yet. */
const RELEASE_AWAITING_STATUS: IStatus = {
  status: 'awaiting',
  progress: null,
  message: 'Waiting for the first file',
};

/** Serializes an internal {@link IStatus} into the metadata blob shape. */
function statusJson(status: IStatus): Prisma.InputJsonObject {
  return {
    status: status.status,
    progress: status.progress
      ? { current: status.progress.current, total: status.progress.total }
      : null,
    message: status.message,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatRef(reference: string, server: string): string {
  try {
    return NoxIdentifier.parse(reference).toString(server);
  } catch {
    return NoxIdentifier.Invalid.toString();
  }
}

/** Keeps only well-formed Nox tags (`<prefix>:<value>`). */
function cleanTags(tags?: string[]): string[] {
  return (tags ?? []).filter((tag) => Tags.isValid(tag));
}

/** Strips an optional `algo:` prefix from a hash, returning the raw digest. */
function normalizeHash(value: string): string {
  const separator = value.indexOf(':');
  return separator === -1 ? value : value.slice(separator + 1);
}

/** True when Prisma rejected a write because of a unique constraint (`P2002`). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function parseExpiry(metadata: unknown): number | null {
  const value = asRecord(metadata).expires_at;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extracts a safe file name from a `Content-Disposition` header value
 * (`filename="…"` or RFC 5987 `filename*=UTF-8''…`). Returns null when absent
 * or unsafe (path separators, empty, …).
 */
function parseFilename(disposition: string | undefined): string | null {
  if (!disposition) return null;
  const encoded = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(disposition)?.[1];
  const raw =
    encoded ??
    /filename\s*=\s*"([^"]*)"/i.exec(disposition)?.[1] ??
    /filename\s*=\s*([^;]+)/i.exec(disposition)?.[1];
  if (!raw) return null;

  let name = raw.trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep the raw value */
  }
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    return null;
  }
  return name.slice(0, 255);
}

/** Converts the stored `{ key, value }[]` attributes into a `key → value` map. */
function toAttributeMap(value: unknown[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of value) {
    const record = asRecord(entry);
    if (typeof record.key === 'string' && typeof record.value === 'string')
      map[record.key] = record.value;
  }
  return map;
}

/** Reads image dimensions (and format) via sharp; `{}` for non-images. */
async function readImageDimensions(
  source: string,
): Promise<Record<string, unknown>> {
  try {
    const metadata = await sharp(source).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
    };
  } catch {
    return {};
  }
}
