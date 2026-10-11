import type { Readable } from 'node:stream';
import type {
  AssetAttributeFilter,
  IApiAsset,
  IApiFile,
  IApiRelease,
  ISanitizeOptions,
  ProcessStatus,
} from '@/assets/asset.types';
import type { AssetService } from '@/assets/asset.service';
import type { AssetWithMethods } from '@/assets/asset.model';
import type { AssetReleaseWithMethods } from '@/assets/asset-release.model';
import type { AssetFileWithMethods } from '@/assets/asset-file.model';
import type { UserWithMethods } from '@/users/user.model';

export interface AssetSearchOptions {
  query?: string;
  /**
   * Filters applied on the file attributes (AND across filters, OR within a
   * filter's values). A release matches when at least one of its files
   * satisfies every filter.
   */
  attributes?: AssetAttributeFilter[];
  /**
   * Statuses to include (cumulative). A release/file listing keeps the
   * resources whose status is in that list, and an asset listing keeps the
   * assets owning at least one such release.
   *
   * Absent or empty, the provider applies its default: `completed` only, so
   * half-finished uploads stay out of the listings.
   */
  statuses?: readonly ProcessStatus[];
  limit: number;
  offset: number;
}

export interface AssetSearchResult<TAsset = AssetWithMethods> {
  query: string | null;
  offset: number;
  limit: number;
  total: number;
  items: TAsset[];
}

/** A locally-uploaded image to attach to an asset. */
export interface AssetImageInput {
  /** Absolute path to the temporary file to store. */
  source: string;
  /** Image MIME type. */
  mimetype: string;
}

export type AssetFile =
  | {
      kind: 'stream';
      stream: Readable;
      contentType?: string;
      contentLength?: number;
    }
  | {
      kind: 'redirect';
      url: string;
      statusCode?: 301 | 302 | 307 | 308;
    };

export interface IAssetProvider {
  readonly id: string;
  readonly assetTypes: readonly string[];

  search(
    type: string,
    options: AssetSearchOptions,
    manager: AssetService,
  ): Promise<AssetSearchResult<AssetWithMethods>>;
  getAsset(
    type: string,
    id: string,
    manager: AssetService,
  ): Promise<AssetWithMethods | null>;
  sanitizeAsset(
    asset: AssetWithMethods,
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiAsset>;
  sanitizeRelease(
    release: AssetReleaseWithMethods,
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiRelease>;
  sanitizeFile(
    file: AssetFileWithMethods,
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiFile>;
  listReleases(
    type: string,
    id: string,
    manager: AssetService,
    options: AssetSearchOptions,
  ): Promise<AssetSearchResult<AssetReleaseWithMethods> | null>;
  getRelease(
    type: string,
    id: string,
    version: string,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods | null>;
  /** Paginated files of one release (`GET …/releases/{version}/files`). */
  listFiles(
    type: string,
    id: string,
    version: string,
    options: AssetSearchOptions,
    manager: AssetService,
  ): Promise<AssetSearchResult<AssetFileWithMethods> | null>;
  getFile(
    type: string,
    id: string,
    version: string,
    name: string,
    manager: AssetService,
  ): Promise<AssetFile | null>;

  /**
   * Delete an asset (and, for locally-hosted providers, its releases/files and
   * stored files). Optional — providers mirroring a remote source omit it.
   * Must throw when the asset does not exist.
   */
  deleteAsset?(
    type: string,
    id: string,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<void>;
  /** Delete a single release (and its files). Optional — see {@link deleteAsset}. */
  deleteRelease?(
    type: string,
    id: string,
    version: string,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<void>;
  /** Delete a single file. Optional — see {@link deleteAsset}. */
  deleteFile?(
    type: string,
    id: string,
    version: string,
    name: string,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<void>;

  /** Attach an uploaded image to an asset. Optional — see {@link deleteAsset}. */
  addImage?(
    type: string,
    id: string,
    image: AssetImageInput,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods>;
  /** Remove an asset image by its index. Optional — see {@link deleteAsset}. */
  removeImage?(
    type: string,
    id: string,
    index: number,
    manager: AssetService,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods>;

  handleWebhook?(
    type: string,
    id: string,
    token: string,
  ): Promise<boolean | null>;
}
