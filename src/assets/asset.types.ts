import type { IApiAlias } from '@/common/alias.types';
import type { ApiUrl } from '@/common/urls.types';
import type { ApiTag } from '@/common/tags.types';
import type { ApiImage } from '@/common/image.types';

export interface ISanitizeOptions {
  expanded?: boolean;
}

/**
 * A release/file attribute filter. A file matches when it declares `key`,
 * with one of `values` when the list is non-empty (an empty list only requires
 * the key to be present).
 */
export interface AssetAttributeFilter {
  key: string;
  /** Accepted values (OR-ed together). Empty = any value. */
  values: string[];
}

/**
 * Returns true when `attributes` satisfies every filter: each filter key must
 * be present, case-insensitively, with one of the filter values (when any).
 */
export function matchesAttributeFilters(
  attributes: readonly IApiAlias[] | undefined,
  filters: readonly AssetAttributeFilter[] | undefined,
): boolean {
  if (!filters || filters.length === 0) return true;
  const list = attributes ?? [];
  return filters.every((filter) => {
    const key = filter.key.trim().toLocaleLowerCase();
    if (!key) return true;
    return list.some((attribute) => {
      if (attribute.key.toLocaleLowerCase() !== key) return false;
      if (filter.values.length === 0) return true;
      if (typeof attribute.value !== 'string') return false;
      const value = attribute.value.toLocaleLowerCase();
      return filter.values.some(
        (candidate) => candidate.toLocaleLowerCase() === value,
      );
    });
  });
}

// API

export interface IApiAsset {
  type: string;
  id: number;
  name: string | null;
  title: string | null;
  images: ApiImage[];
  description: string | null;
  tags: ApiTag[];
  server: string;
  owner: string;
  contributors: string[];
  alias: IApiAlias[];
  release: IApiReleasePreference;
  created_at: number;
  updated_at: number;
}

/**
 * API-facing representation of a release.
 *
 * Its **files are not embedded**: a release can hold a very large number of
 * them, so they are paginated through `GET …/releases/{version}/files`.
 */
export interface IApiRelease {
  id: number;
  name: string;
  title: string | null;
  changelog: string | null;
  channel: 'stable' | 'candidate' | 'nightly';
  alias: IApiAlias[];
  status: IApiStatus;
  /** Expiration timestamp (epoch ms) while the release is incomplete; omitted once it holds a completed file. */
  expires_at?: number;
  /**
   * Epoch ms after which the SDK should GET the release again while it is still
   * changing (pending file, or no completed file yet). Omitted once the release
   * is stable — like `expires_at`.
   */
  refetch_at?: number;
}

/**
 * Expanded form of an asset's release preference (`?full=1`).
 *
 * `value` is always the release clients should use: the pinned one when
 * `auto` is false, the latest one otherwise.
 */
export interface IApiReleaseExpandPreference {
  /** True when the asset follows its latest release instead of a pinned one. */
  auto: boolean;
  /** Effective release id (`-1` when the asset has no release at all). */
  value: number;
}

export type IApiReleasePreference =
  | IApiReleaseExpandPreference['value']
  | IApiReleaseExpandPreference;

/**
 * API-facing representation of an asset file.
 *
 * Every field is always present (never `undefined`): use `null` for unknown
 * values and empty arrays for collections. The only optional field is
 * `expires_at`, which is omitted once the file is complete.
 */
export interface IApiFile {
  /** File name, or null when the slot is unnamed. */
  name: string | null;
  /** Final download URL, or the temporary upload URL while the upload is pending. */
  url: ApiUrl;
  alias: IApiAlias[];
  /** File size in bytes (0 until the bytes have been received). */
  size: number;
  /** MIME type. */
  mime: string;
  /** Content hashes (`algo:digest`); empty until computed. */
  hashs: string[];
  /** NoxIdentifier string (or numeric id) of the uploader. */
  uploader: string | number;
  /** Processing status (always present). */
  status: IApiStatus;
  /** Free-form attributes (e.g. `engine`, `platform`, `arch`); empty when none. */
  attributes: IApiAlias[];
  /** Result of the type-specific analysis/validation, or null when there is none. */
  analysis: IAnalysed | null;
  /** Creation timestamp (epoch ms). Always set. */
  created_at: number;
  /** Last update timestamp (epoch ms). Always set. */
  updated_at: number;
  /** Detached signature over the file hash (e.g. `ed25519:…`), or null. */
  signature: string | null;
  /**
   * Expiration timestamp (epoch ms) of a retryable resource: present while an
   * `awaiting` slot/release waits for its bytes, and on a `failed` file (its
   * retry window). Omitted for `queued`, `processing` and `completed`.
   */
  expires_at?: number;
  /**
   * Epoch ms after which the SDK should GET the file again while it is still
   * changing. Omitted once the file is stable (completed or failed) — like
   * `expires_at`. Tells a client whether it should keep polling.
   */
  refetch_at?: number;
}

// Status

/**
 * Lifecycle of an asynchronous file process (upload, analysis, …).
 *
 * - `awaiting` — the slot is reserved, the bytes have not been received yet;
 * - `queued` — the bytes have been received, the background analysis (bundle
 *   parsing + type validator) has not run yet;
 * - `processing` — the background analysis is running;
 * - `completed` — the file is finalized (stored bytes, download URL available);
 * - `failed` — the upload was rejected (integrity or bundle validation).
 */
export type ProcessStatus =
  | 'awaiting'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

/** Every {@link ProcessStatus}, in lifecycle order. */
export const PROCESS_STATUSES: readonly ProcessStatus[] = [
  'awaiting',
  'queued',
  'processing',
  'completed',
  'failed',
];

/**
 * Statuses a listing shows by default: only what a client can actually
 * consume. Pending and failed resources are opt-in through `?status=`.
 */
export const DEFAULT_STATUS_FILTER: readonly ProcessStatus[] = ['completed'];

/** Accepted `?status=` values: one {@link ProcessStatus}, or `all`. */
export type StatusFilterValue = ProcessStatus | 'all';

/**
 * Reads the `?status=` filters of a listing query. The parameter is repeatable
 * and **cumulative** (`?status=awaiting&status=queued`), `all` expands to every
 * status, and an empty parameter — the default — keeps only
 * {@link DEFAULT_STATUS_FILTER}.
 *
 * Returns `null` when a value is not a known status, so the HTTP layer can
 * answer `400` instead of silently matching nothing.
 */
export function parseStatusFilters(
  value: string | string[] | undefined,
): ProcessStatus[] | null {
  if (value === undefined) return [...DEFAULT_STATUS_FILTER];

  const entries = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim().toLocaleLowerCase())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return [...DEFAULT_STATUS_FILTER];

  const statuses = new Set<ProcessStatus>();
  for (const entry of entries) {
    if (entry === 'all' || entry === '*') {
      for (const status of PROCESS_STATUSES) statuses.add(status);
      continue;
    }
    if (!isProcessStatus(entry)) return null;
    statuses.add(entry);
  }
  return [...statuses];
}

/** Steps of a running process: how many are done, out of how many. */
export interface IStatusProgress {
  /** Steps already processed. */
  current: number;
  /** Steps to process in total. */
  total: number;
}

/** Full internal status of a file process. */
export interface IStatus {
  status: ProcessStatus;
  /**
   * Steps of the current run, or `null` while they cannot be estimated (the
   * analyzer has not counted anything yet, or the provider does not report
   * steps). Clients should then show an indeterminate progress.
   */
  progress: IStatusProgress | null;
  /** Optional human-readable detail about the current step. */
  message: string | null;
}

/** API-facing status: the shorthand status string, or the full status object. */
export type IApiStatus = ProcessStatus | IStatus;

/**
 * Converts an internal {@link IStatus} into its API representation.
 * Finished files are collapsed to the shorthand `"completed"` string.
 */
export function sanitizeStatus(status: IStatus | null): IApiStatus {
  if (!status || status.status === 'completed') return 'completed';
  return status;
}

function isProcessStatus(value: unknown): value is ProcessStatus {
  return (
    value === 'awaiting' ||
    value === 'queued' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed'
  );
}

/**
 * Reads an internal {@link IStatus} from a metadata blob (`metadata.status`).
 * Returns null when the metadata holds no valid status.
 */
export function parseProcessStatus(metadata: unknown): IStatus | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).status;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (!isProcessStatus(candidate.status)) return null;
  return {
    status: candidate.status,
    progress: toProgress(candidate.progress),
    message: typeof candidate.message === 'string' ? candidate.message : null,
  };
}

/** Reads a step counter (`current` / `total`), or null when absent/invalid. */
function toStep(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

/**
 * Reads the `progress` steps of a stored status.
 *
 * Returns null when they are unknown; a `total` of 0 means "not counted yet".
 * Statuses stored before steps existed held a plain percentage here — they are
 * ignored rather than misread as a step count.
 */
function toProgress(value: unknown): IStatusProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const current = toStep(candidate.current);
  const total = toStep(candidate.total);
  if (current === null || total === null || total <= 0) return null;
  return { current: Math.min(current, total), total };
}

// Internal

/**
 * Internal, pre-sanitization representation of an asset file.
 * Backed by the `AssetFile` record; the processing status is exposed through an
 * accessor because it is optional and provider-dependent.
 *
 * A file may be incomplete (e.g. a reserved upload slot), so every field except
 * `id` and `status` may be absent.
 */
export interface IFile {
  id: number;
  name?: string | null;
  /** Storage key or URL. Absent until the bytes have been received. */
  url?: string;
  size?: bigint;
  mime?: string;
  attributes?: IApiAlias[];
  hashes?: string[];
  uploader?: string | null;
  get status(): IStatus | null;
  /** Result of the type-specific analysis/validation, or null when there is none. */
  get analysis(): IAnalysed | null;
}

/**
 * Result of a file analysis / validation, delivered by the type-specific
 * validator when one is registered (e.g. avatar performance statistics).
 */
export interface IAnalysed {
  /** Engine that produced the file (e.g. `unity`). */
  engine?: string | null;
  /** Target platform (e.g. `windows`). */
  platform?: string | null;
  /** Engine version, when the analyser knows it. */
  version?: string | null;
  /** Number of descriptors found by the validator. */
  descriptors?: number | null;
  /**
   * Free-form metrics produced by the validator (e.g. avatar performance:
   * polygon count, texture memory, download size, performance rank, …).
   */
  metrics?: Record<string, unknown>;
}

/**
 * Parses an `{ key, value }[]` attributes blob (JSON column or metadata).
 * Keeps only entries whose `key` and `value` are strings.
 */
export function parseAttributes(value: unknown): IApiAlias[] {
  if (!Array.isArray(value)) return [];
  const result: IApiAlias[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key === 'string' && typeof record.value === 'string')
      result.push({ key: record.key, value: record.value });
  }
  return result;
}

/**
 * Reads an {@link IAnalysed} result from a metadata blob (`metadata.analysis`).
 * Returns null when the metadata holds no analysis.
 */
export function parseAnalysis(metadata: unknown): IAnalysed | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).analysis;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as IAnalysed;
}

/**
 * Internal, pre-sanitization representation of an asset release.
 * Backed by the `AssetRelease` record; the build status is exposed through an
 * accessor because it is optional and provider-dependent.
 */
export interface IRelease {
  id: number;
  name: string | null;
  title: string | null;
  changelog: string | null;
  get status(): IStatus | null;
}
