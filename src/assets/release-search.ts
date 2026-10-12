import { Prisma } from '@/generated/prisma/client';
import type { AssetSearchOptions } from '@/assets/asset-provider.interface';
import {
  DEFAULT_STATUS_FILTER,
  type AssetAttributeFilter,
  type ProcessStatus,
} from '@/assets/asset.types';

/** Minimal raw-SQL runner needed by the searches (a `PrismaService` satisfies it). */
export interface RawQueryRunner {
  $queryRaw(query: Prisma.Sql): Promise<unknown>;
}

export interface ReleaseSearchResult {
  /** Matching ids for the requested page, ordered by ascending id. */
  ids: number[];
  /** Total number of matches, ignoring `limit`/`offset`. */
  total: number;
}

/**
 * Statuses to match for a listing query: the requested ones, or the default
 * (`completed` only) — so a half-finished upload never shows up unless the
 * caller explicitly asks for it with `?status=`.
 */
function resolveStatuses(options: AssetSearchOptions): readonly ProcessStatus[] {
  const statuses = options.statuses?.filter((status) => !!status) ?? [];
  return statuses.length > 0 ? statuses : DEFAULT_STATUS_FILTER;
}

/**
 * Predicate on the status stored in a metadata blob (`metadata.status.status`).
 * A row without any status counts as `awaiting`. `alias` is the table alias.
 */
function statusPredicate(
  alias: Prisma.Sql,
  options: AssetSearchOptions,
): Prisma.Sql {
  const statuses = resolveStatuses(options);
  return Prisma.sql`COALESCE(${alias}."metadata"->'status'->>'status', 'awaiting') IN (${Prisma.join(
    statuses,
  )})`;
}

/** `%query%` with the LIKE metacharacters escaped (paired with `ESCAPE '!'`). */
function likePattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

/**
 * Resolves the **files of one release** in the database: the text search, the
 * attribute filters, the total count and the pagination all run in PostgreSQL,
 * so a release holding a million files never gets loaded in the process — the
 * caller only fetches the requested page of ids.
 *
 * The text search matches the file `name` and `mime`; attributes are matched on
 * the `attributes` JSON column (`[{ key, value }]`), case-insensitively, with
 * the same semantics as {@link searchReleaseIds} (every filter on the same
 * file, values of one filter OR-ed). Only the files whose status is requested
 * are returned: `completed` by default.
 */
export async function searchFileIds(
  prisma: RawQueryRunner,
  release: { assetType: string; assetId: number; id: number },
  options: AssetSearchOptions,
): Promise<ReleaseSearchResult> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`f."release_asset_type" = ${release.assetType}`,
    Prisma.sql`f."release_asset_id" = ${release.assetId}`,
    Prisma.sql`f."release_id" = ${release.id}`,
    statusPredicate(Prisma.sql`f`, options),
  ];

  const query = options.query?.trim();
  if (query) {
    const like = likePattern(query);
    conditions.push(Prisma.sql`(
      f."name" ILIKE ${like} ESCAPE '!'
      OR f."mime" ILIKE ${like} ESCAPE '!'
    )`);
  }

  for (const filter of options.attributes ?? []) {
    const predicate = attributePredicate(filter);
    if (predicate) conditions.push(matchingAttributePredicate(predicate));
  }

  const where = Prisma.join(conditions, ' AND ');

  const counted = (await prisma.$queryRaw(
    Prisma.sql`SELECT count(*)::int AS total FROM "asset_files" f WHERE ${where}`,
  )) as Array<{ total: number }>;

  const rows = (await prisma.$queryRaw(
    Prisma.sql`SELECT f."id" FROM "asset_files" f WHERE ${where} ORDER BY f."id" ASC LIMIT ${options.limit} OFFSET ${options.offset}`,
  )) as Array<{ id: number }>;

  return {
    ids: rows.map((row) => Number(row.id)),
    total: Number(counted?.[0]?.total ?? 0),
  };
}

/**
 * First file of a release carrying **all** the given attributes, or `null`.
 *
 * Attributes are compared case-insensitively, like the attribute filters, and
 * `excludeFileId` skips the file being written. Backs the `unique` upload rules
 * (e.g. an avatar release accepts a single `platform`+`engine` pair).
 */
export async function findFileWithAttributes(
  prisma: RawQueryRunner,
  release: { assetType: string; assetId: number; id: number },
  attributes: readonly { key: string; value: string }[],
  excludeFileId?: number,
): Promise<{ id: number; name: string | null } | null> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`f."release_asset_type" = ${release.assetType}`,
    Prisma.sql`f."release_asset_id" = ${release.assetId}`,
    Prisma.sql`f."release_id" = ${release.id}`,
  ];
  if (excludeFileId !== undefined)
    conditions.push(Prisma.sql`f."id" <> ${excludeFileId}`);
  for (const { key, value } of attributes) {
    const predicate = attributePredicate({ key, values: [value] });
    if (predicate) conditions.push(matchingAttributePredicate(predicate));
  }

  const rows = (await prisma.$queryRaw(
    Prisma.sql`SELECT f."id", f."name" FROM "asset_files" f WHERE ${Prisma.join(
      conditions,
      ' AND ',
    )} ORDER BY f."id" ASC LIMIT 1`,
  )) as Array<{ id: number; name: string | null }>;

  const row = rows[0];
  return row ? { id: Number(row.id), name: row.name } : null;
}

/**
 * Resolves the releases of an asset **in the database**: the text search, the
 * file-attribute filters, the total count and the pagination all run in
 * PostgreSQL, so only the requested page is ever loaded in the process.
 *
 * Files are matched on their `attributes` JSON column (`[{ key, value }]`),
 * case-insensitively: every filter must be satisfied by the **same** file, and
 * several values for one key are OR-ed together.
 *
 * Only the releases whose status is requested are returned: `completed` by
 * default.
 */
export async function searchReleaseIds(
  prisma: RawQueryRunner,
  type: string,
  assetId: number,
  options: AssetSearchOptions,
): Promise<ReleaseSearchResult> {
  // Every user value below is embedded as a bound `Prisma.Sql` parameter — the
  // query string only ever contains literals and `$n` placeholders.
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r."asset_type" = ${type}`,
    Prisma.sql`r."asset_id" = ${assetId}`,
    statusPredicate(Prisma.sql`r`, options),
  ];

  const query = options.query?.trim();
  if (query) {
    const like = likePattern(query);
    conditions.push(Prisma.sql`(
      r."id"::text ILIKE ${like} ESCAPE '!'
      OR r."name" ILIKE ${like} ESCAPE '!'
      OR r."title" ILIKE ${like} ESCAPE '!'
      OR r."changelog" ILIKE ${like} ESCAPE '!'
      OR r."channel"::text ILIKE ${like} ESCAPE '!'
      OR EXISTS (
        SELECT 1 FROM "asset_files" sf
        WHERE sf."release_asset_type" = r."asset_type"
          AND sf."release_asset_id" = r."asset_id"
          AND sf."release_id" = r."id"
          AND sf."name" ILIKE ${like} ESCAPE '!'
      )
    )`);
  }

  for (const filter of options.attributes ?? []) {
    const predicate = attributePredicate(filter);
    if (predicate) conditions.push(matchingFilePredicate(predicate));
  }

  const where = Prisma.join(conditions, ' AND ');

  const counted = (await prisma.$queryRaw(
    Prisma.sql`SELECT count(*)::int AS total FROM "asset_releases" r WHERE ${where}`,
  )) as Array<{ total: number }>;

  const rows = (await prisma.$queryRaw(
    Prisma.sql`SELECT r."id" FROM "asset_releases" r WHERE ${where} ORDER BY r."id" DESC LIMIT ${options.limit} OFFSET ${options.offset}`,
  )) as Array<{ id: number }>;

  return {
    ids: rows.map((row) => Number(row.id)),
    total: Number(counted?.[0]?.total ?? 0),
  };
}

/**
 * Resolves the assets of one provider **in the database**: the text search, the
 * status filter, the total count and the pagination all run in PostgreSQL, so
 * only the requested page of assets is ever loaded in the process.
 *
 * An asset matches when it owns **at least one** release whose status is
 * requested — a completed one by default — so an asset created but never
 * uploaded is not listed. An asset with **no release at all** counts as
 * `awaiting`: it is returned by `?status=awaiting` (and `?status=all`), never
 * by the default listing.
 *
 * The text search matches the asset `id`, `name`, `title`, `description` and
 * `tags`.
 */
export async function searchAssetIds(
  prisma: RawQueryRunner,
  scope: { provider: string; type: string },
  options: AssetSearchOptions,
): Promise<ReleaseSearchResult> {
  const matchingRelease = Prisma.sql`EXISTS (
    SELECT 1 FROM "asset_releases" r
    WHERE r."asset_type" = a."type"
      AND r."asset_id" = a."id"
      AND ${statusPredicate(Prisma.sql`r`, options)}
  )`;
  const anyRelease = Prisma.sql`EXISTS (
    SELECT 1 FROM "asset_releases" r
    WHERE r."asset_type" = a."type" AND r."asset_id" = a."id"
  )`;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`a."provider" = ${scope.provider}`,
    Prisma.sql`a."type" = ${scope.type}`,
    resolveStatuses(options).includes('awaiting')
      ? Prisma.sql`(${matchingRelease} OR NOT ${anyRelease})`
      : matchingRelease,
  ];

  const query = options.query?.trim();
  if (query) {
    const like = likePattern(query);
    conditions.push(Prisma.sql`(
      a."id"::text ILIKE ${like} ESCAPE '!'
      OR a."name" ILIKE ${like} ESCAPE '!'
      OR a."title" ILIKE ${like} ESCAPE '!'
      OR a."description" ILIKE ${like} ESCAPE '!'
      OR EXISTS (
        SELECT 1 FROM unnest(a."tags") AS tag WHERE tag ILIKE ${like} ESCAPE '!'
      )
    )`);
  }

  const where = Prisma.join(conditions, ' AND ');

  const counted = (await prisma.$queryRaw(
    Prisma.sql`SELECT count(*)::int AS total FROM "assets" a WHERE ${where}`,
  )) as Array<{ total: number }>;

  const rows = (await prisma.$queryRaw(
    Prisma.sql`SELECT a."id" FROM "assets" a WHERE ${where} ORDER BY a."id" ASC LIMIT ${options.limit} OFFSET ${options.offset}`,
  )) as Array<{ id: number }>;

  return {
    ids: rows.map((row) => Number(row.id)),
    total: Number(counted?.[0]?.total ?? 0),
  };
}

/** Builds the JSON predicate for a single attribute filter (`null` for an empty key). */
function attributePredicate(filter: AssetAttributeFilter): Prisma.Sql | null {
  const key = filter.key.trim().toLocaleLowerCase();
  if (!key) return null;

  const keyMatches = Prisma.sql`lower(entry->>'key') = ${key}`;
  const values = filter.values
    .map((value) => value.trim().toLocaleLowerCase())
    .filter((value) => value.length > 0);
  if (values.length === 0) return keyMatches;

  return Prisma.sql`(${keyMatches} AND lower(entry->>'value') IN (${Prisma.join(
    values,
  )}))`;
}

/** Wraps an attribute predicate in an `EXISTS` over the files of the release. */
function matchingFilePredicate(predicate: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "asset_files" af
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(af."attributes") = 'array' THEN af."attributes" ELSE '[]'::jsonb END
    ) AS entry
    WHERE af."release_asset_type" = r."asset_type"
      AND af."release_asset_id" = r."asset_id"
      AND af."release_id" = r."id"
      AND ${predicate}
  )`;
}

/** Wraps an attribute predicate in an `EXISTS` over the attributes of a file row. */
function matchingAttributePredicate(predicate: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(f."attributes") = 'array' THEN f."attributes" ELSE '[]'::jsonb END
    ) AS entry
    WHERE ${predicate}
  )`;
}
