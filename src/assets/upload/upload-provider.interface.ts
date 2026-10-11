import type { Readable } from 'node:stream';
import type { IAssetProvider } from '@/assets/asset-provider.interface';
import type { AssetService } from '@/assets/asset.service';
import type { AssetWithMethods } from '@/assets/asset.model';
import type { AssetReleaseWithMethods } from '@/assets/asset-release.model';
import type { AssetFileWithMethods } from '@/assets/asset-file.model';
import type { UserWithMethods } from '@/users/user.model';
import type {
  CreateUploadAssetDto,
  CreateUploadReleaseDto,
  InitUploadFileDto,
  UpdateUploadAssetDto,
  UpdateUploadReleaseDto,
} from '@/assets/upload/dto/upload.dto';

/** Headers sent alongside the raw upload (all optional). */
export interface UploadHeaders {
  /** Expected content hash (`sha256:<hex>` or bare hex) — checked against the received bytes. */
  hash?: string;
  /** Detached signature (`ed25519:…`) — stored as-is. */
  signature?: string;
  /** Expected content length in bytes (from `Content-Length`) — checked against the received size. */
  length?: string;
  /** Raw `Content-Disposition` header — its filename names the slot when it has none. */
  disposition?: string;
}

/**
 * Provider capable of creating and receiving asset uploads on this node
 * (as opposed to mirroring an external source such as GitHub).
 *
 * It plugs into {@link AssetService} and exposes the SDK / CI-CD upload flow:
 *
 *  1. `PUT    /api/:type`                                   → {@link createAsset}
 *  2. `PUT    /api/:type/:id/releases`                      → {@link createRelease}
 *  3. `POST   /api/:type/:id/releases/:releaseId/files`     → {@link initFile}
 *  4. `PUT    /api/:type/:id/releases/:releaseId/files/:fid`→ {@link storeFile} (analyzes, validates and finalizes the file)
 */
export interface IAssetUploadProvider extends IAssetProvider {
  /** Register a new locally-hosted asset owned by `viewer`. Returns the entity — the caller sanitizes it. */
  createAsset(
    type: string,
    dto: CreateUploadAssetDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetWithMethods>;

  /** Create a release (upload target) for an existing asset. Returns the entity. */
  createRelease(
    type: string,
    id: string,
    dto: CreateUploadReleaseDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods>;

  /** Reserve a file slot and return it (with its upload URL). Returns the entity. */
  initFile(
    type: string,
    id: string,
    release: string,
    dto: InitUploadFileDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetFileWithMethods>;

  /**
   * Receive the raw file bytes for a reserved slot, analyze/validate them and
   * finalize the file. The hash & size are computed automatically and the
   * integrity headers are cross-checked when provided. Authorized through the
   * normal authentication (owner/contributor/admin).
   */
  storeFile(
    type: string,
    id: string,
    release: string,
    fileId: number,
    stream: Readable,
    contentType: string | undefined,
    headers: UploadHeaders,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetFileWithMethods>;

  /** Update an asset's metadata (title, description, tags, name, preferred release). */
  updateAsset(
    type: string,
    id: string,
    dto: UpdateUploadAssetDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetWithMethods>;

  /** Update a release's metadata. Its files are immutable (create or delete only). */
  updateRelease(
    type: string,
    id: string,
    version: string,
    dto: UpdateUploadReleaseDto,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods>;

  /**
   * Lightweight status lookup for a file slot, by numeric id (no bytes are
   * streamed back). Returns null when the file does not exist.
   */
  getFileStatus(
    type: string,
    id: string,
    release: string,
    fileId: number,
    viewer: UserWithMethods,
    manager: AssetService,
  ): Promise<AssetFileWithMethods | null>;
}

/** Narrows an {@link IAssetProvider} to an upload-capable provider. */
export function isAssetUploadProvider(
  provider: IAssetProvider,
): provider is IAssetUploadProvider {
  const candidate = provider as Partial<IAssetUploadProvider>;
  return (
    typeof candidate.createAsset === 'function' &&
    typeof candidate.createRelease === 'function' &&
    typeof candidate.initFile === 'function' &&
    typeof candidate.storeFile === 'function' &&
    typeof candidate.updateAsset === 'function' &&
    typeof candidate.updateRelease === 'function' &&
    typeof candidate.getFileStatus === 'function'
  );
}
