import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiException } from '@/api/api-exception';
import { ApiErrorCode } from '@/api/api-error.factory';
import type {
  AssetSearchOptions,
  AssetSearchResult,
  IAssetProvider,
} from '@/assets/asset-provider.interface';
import type { AssetService } from '@/assets/asset.service';
import type {
  IApiAsset,
  IApiFile,
  IApiRelease,
  ISanitizeOptions,
  IStatus,
} from '@/assets/asset.types';
import {
  DEFAULT_STATUS_FILTER,
  matchesAttributeFilters,
  parseAnalysis,
  parseAttributes,
  sanitizeStatus,
} from '@/assets/asset.types';
import { searchFileIds, searchReleaseIds } from '@/assets/release-search';
import { NoxIdentifier } from '@/common/identifier';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/database/prisma.service';
import { Asset } from '@/assets/asset.model';
import { AssetRelease } from '@/assets/asset-release.model';
import { AssetFile } from '@/assets/asset-file.model';
import type { Prisma } from '@/generated/prisma/client';
import type { AssetWithMethods } from '@/assets/asset.model';
import type { AssetReleaseWithMethods } from '@/assets/asset-release.model';
import type { AssetFileWithMethods } from '@/assets/asset-file.model';
import type { UserWithMethods } from '@/users/user.model';
import { WellKnownService } from '@/fediverse/well-known.service';
import { AppConfigService } from '@/config/config.service';
import type {
  GithubAssetContext,
  GithubFileResponse,
  GithubRepositoryConfig,
  GithubRepositoryManifest,
  GithubReleaseResponse,
  GithubReleaseManifest,
  GithubModManifest,
  GithubModRepository,
} from '@/assets/mods/providers/github/type';

@Injectable()
export class GithubProvider implements IAssetProvider, OnModuleInit {
  readonly id = 'github';
  readonly assetTypes = ['mod'];
  private readonly logger = new Logger(GithubProvider.name);

  constructor(
    private readonly cache: CacheService,
    @Inject(PrismaService)
    private readonly prisma: Pick<
      PrismaService,
      'assets' | 'assetReleases' | '$queryRaw'
    >,
    private readonly wellKnown: WellKnownService,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ids = await this.config.get<number[]>('github.repositories');
    for (const id of new Set(ids))
      try {
        await this.appendRepositoryIfMissing(id);
      } catch (error) {
        this.logger.error(
          `Failed to synchronize GitHub repository ${id} during startup`,
          error instanceof Error ? error.stack : String(error),
        );
      }
  }

  async search(
    _type: string,
    options: AssetSearchOptions,
    manager: AssetService,
  ): Promise<AssetSearchResult> {
    const matches: AssetWithMethods[] = [];

    // Everything this provider mirrors is complete: a GitHub release is only
    // persisted once it is published, and its files come from the release
    // manifest (or are not listed at all). A status filter that excludes
    // `completed` therefore matches nothing.
    const statuses = options.statuses ?? DEFAULT_STATUS_FILTER;
    if (!statuses.includes('completed'))
      return {
        query: options.query ?? null,
        offset: options.offset,
        limit: options.limit,
        total: 0,
        items: [],
      };

    const records = await this.prisma.assets.findMany({
      where: { provider: this.id, type: 'mod' },
    });

    const ids = records
      .filter((record) => repositoryGithubId(record.metadata) !== null)
      .map((record) => record.id);

    const assets = await Promise.all(
      ids.map((assetId) => this.getAsset('mod', String(assetId), manager)),
    );

    for (const asset of assets) {
      if (!asset) continue;

      const sanitized = await asset.sanitize();
      const searchable = [
        sanitized.id,
        sanitized.title,
        sanitized.description,
        sanitized.name,
        ...sanitized.alias.map((alias) => alias.value),
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLocaleLowerCase();

      if (
        !options.query ||
        searchable.includes(options.query.toLocaleLowerCase())
      )
        matches.push(asset);
    }

    return {
      query: options.query ?? null,
      offset: options.offset,
      limit: options.limit,
      total: matches.length,
      items: matches.slice(options.offset, options.offset + options.limit),
    };
  }

  async getAsset(
    _type: string,
    id: string,
    manager: AssetService,
  ): Promise<AssetWithMethods | null> {
    const repository = await this.resolveRepository(id);
    if (!repository) return null;

    const context = await this.getCachedValue(
      this.assetContextKey(repository.githubId),
      (value): value is GithubAssetContext =>
        isGithubAssetContext(value, repository.githubId),
    );
    if (context && isGithubAssetContext(context, repository.githubId))
      return this.assetFromContext(context, repository, manager);

    const repo = await this.getGithubRepository(repository.githubId);
    if (!repo) return null;

    const [content, latest] = await Promise.all([
      this.requestJson<unknown>(
        `${await this.repositoryUrl(repository)}/contents/nox.mod.json`,
      ),
      this.requestJson<GithubReleaseResponse>(
        `${await this.repositoryUrl(repository)}/releases/latest`,
        isGithubRelease,
      ),
    ]);

    if (!isGithubFile(content))
      throw new BadGatewayException(
        `GitHub repository ${repository.owner}/${repository.repo} has no valid nox.mod.json`,
      );

    if (latest !== null && !isGithubRelease(latest))
      throw new BadGatewayException(
        'GitHub returned invalid latest release data',
      );

    const manifest = parseManifest(
      Buffer.from(content.content, 'base64').toString('utf8'),
    );

    if (repo.id !== repository.githubId)
      throw new BadGatewayException(
        'GitHub repository id does not match the configured mod source',
      );

    const latestRelease =
      isGithubRelease(latest) && !latest.draft ? latest : null;

    const latestReleaseManifest = latestRelease
      ? await this.getReleaseManifest(latestRelease, repository)
      : null;

    const assetContext: GithubAssetContext = {
      manifest,
      repository: repo,
      latestRelease,
      latestReleaseManifest,
    };

    const resolved = this.repositoryConfig(assetContext);

    const asset = await this.assetFromContext(assetContext, resolved, manager);

    await this.cache.set(
      this.assetContextKey(repository.githubId),
      { cached: true, value: assetContext },
      await this.githubCacheTtl(),
    );
    return asset;
  }

  async sanitizeAsset(
    asset: AssetWithMethods,
    _viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiAsset> {
    const context = asset.context as GithubAssetContext;
    const manifest = context.manifest;
    const repository = context.repository;
    const server = await this.wellKnown.address();
    const latestRelease = context.latestRelease;
    const resolvedRelease = latestRelease?.id ?? -1;
    return {
      type: asset.type,
      id: asset.id,
      name: asset.name,
      title: asset.title,
      images: manifest.icon
        ? [
            {
              url: manifest.icon,
              priority: 0,
              width: 0,
              height: 0,
              alt: manifest.name,
            },
          ]
        : [],
      description: asset.description,
      tags: [...asset.tags],
      server,
      owner: formatUserRef(asset.owner, server),
      contributors: asset.contributor.map((ref) => formatUserRef(ref, server)),
      alias: [
        { key: 'github', value: repository.html_url },
        {
          key: 'api',
          value: await this.assetApiUrl(asset),
        },
        {
          key: 'iid',
          value: `${asset.id}@${server}`,
        },
        ...(asset.name
          ? [
              {
                key: 'nid',
                value: `${asset.name}@${server}`,
              },
            ]
          : []),
      ],
      release: options?.expanded
        ? { auto: true, value: resolvedRelease }
        : resolvedRelease,
      created_at: Date.parse(repository.created_at),
      updated_at: Date.parse(repository.updated_at),
    };
  }

  async sanitizeRelease(
    release: AssetReleaseWithMethods,
    _viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiRelease> {
    const asset = release.getAsset();
    const server = await this.wellKnown.address();
    const externalId = metadataString(release.metadata, 'externalId');
    const releaseIdentifier = (id: string, version: string) =>
      new NoxIdentifier(null, id, server, {
        v: version,
      }).toString(null);
    return {
      id: parseGithubId(externalId),
      name: release.name ?? '',
      title: release.title,
      changelog: release.changelog,
      channel: release.channel,
      created_at: metadataDate(release.metadata, 'publishedAt')
         ?? release.createdAt.getTime(),
      alias: [
        {
          key: 'iid',
          value: releaseIdentifier(String(asset.id), externalId),
        },
        ...(asset.name
          ? [
              {
                key: 'nid',
                value: releaseIdentifier(asset.name, release.name ?? ''),
              },
            ]
          : []),
        {
          key: 'api',
          value: await this.releaseApiUrl(asset, externalId),
        },
        {
          key: 'github',
          value: metadataString(release.metadata, 'sourceUrl'),
        },
      ],
      status: sanitizeStatus(release.status),
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
    const url = await this.fileApiUrl(asset, release, file);
    const original = file.url;
    return {
      id: file.id,
      name: file.name ?? null,
      url: options?.expanded ? { proxified: url, original } : url,
      alias: [{ key: 'api', value: url }],
      size: Number(file.size),
      mime: file.mime,
      hashs: [...file.hashes],
      uploader: formatUserRef(
        file.uploader || NoxIdentifier.Invalid.toString(),
        server,
      ),
      status: sanitizeStatus(file.status ?? release.status),
      attributes: parseAttributes(file.attributes),
      analysis: parseAnalysis(file.metadata),
      created_at: file.createdAt.getTime(),
      updated_at: file.updatedAt.getTime(),
      signature: null,
    };
  }

  private assetContextKey(githubId: number): string {
    return `asset:${this.id}:mod:${githubId}:context`;
  }

  private repositoryKey(githubId: number): string {
    return `github:repository:${githubId}`;
  }

  private repositoryManifestKey(githubId: number): string {
    return `github:repository-manifest:${githubId}`;
  }

  private releasesKey(githubId: number): string {
    return `github:releases:${githubId}`;
  }

  private releaseKey(githubId: number, version: string): string {
    return `github:release:${githubId}:${encodeURIComponent(version)}`;
  }

  private async assetFromContext(
    context: GithubAssetContext,
    repository: GithubRepositoryConfig,
    manager: AssetService,
  ): Promise<AssetWithMethods> {
    const defaultUserRef = NoxIdentifier.Invalid.toString();
    const assetWhere = {
      type_provider_name: {
        type: 'mod',
        provider: this.id,
        name: context.manifest.id,
      },
    };
    const existing = await this.prisma.assets.findUnique({
      where: assetWhere,
    });
    const metadata = mergeAssetMetadata(
      existing?.metadata,
      context.repository.id,
    );
    const record = await this.prisma.assets.upsert({
      where: assetWhere,
      create: {
        type: 'mod',
        provider: this.id,
        name: context.manifest.id,
        title: context.manifest.name,
        description: context.manifest.description,
        tags: (context.manifest.tags ?? []).filter((tag) => tag.includes(':')),
        owner: defaultUserRef,
        contributor: [],
        metadata,
      },
      update: {
        title: context.manifest.name,
        description: context.manifest.description,
        tags: (context.manifest.tags ?? []).filter((tag) => tag.includes(':')),
        owner: defaultUserRef,
        contributor: [],
        metadata,
      },
    });
    const assetRecord = Asset.attach(record, manager, context);
    if (context.latestRelease && context.latestReleaseManifest) {
      await this.persistRelease(
        assetRecord,
        context.latestRelease,
        context.latestReleaseManifest,
        repository,
      );
    }
    return assetRecord;
  }

  async listReleases(
    _type: string,
    id: string,
    manager: AssetService,
    searchOptions: AssetSearchOptions,
  ): Promise<AssetSearchResult<AssetReleaseWithMethods> | null> {
    const repository = await this.resolveRepository(id);
    if (!repository) return null;
    const asset = await this.getAsset('mod', id, manager);
    if (!asset) return null;

    const response = await this.getGithubReleases(repository);
    if (response === null) return null;
    // Only actually published releases are exposed. Draft releases are builds
    // still running in GitHub Actions and are ignored until they are published.
    const published = response.filter((release) => !release.draft);
    // Sync every published release, then let PostgreSQL run the text search,
    // the attribute filters, the count and the pagination so only the
    // requested page of releases is loaded here.
    await Promise.all(
      published.map(async (release) => {
        const manifest = await this.findReleaseManifest(release, repository);
        await this.persistRelease(asset, release, manifest, repository);
      }),
    );

    const attributeFilters = searchOptions.attributes;
    const { ids, total } = await searchReleaseIds(
      this.prisma,
      asset.type,
      asset.id,
      searchOptions,
    );
    const records = ids.length
      ? await this.prisma.assetReleases.findMany({
          where: {
            assetType: asset.type,
            assetId: asset.id,
            id: { in: ids },
          },
          include: { files: true },
        })
      : [];
    const byId = new Map(records.map((record) => [record.id, record]));
    const items: AssetReleaseWithMethods[] = [];
    for (const releaseId of ids) {
      const record = byId.get(releaseId);
      if (!record) continue;
      const releaseRecord = AssetRelease.attach(record, asset.manager, {
        asset,
      });
      releaseRecord.files = record.files.map((file) =>
        AssetFile.attach(file, asset.manager, { release: releaseRecord }),
      );
      if (attributeFilters && attributeFilters.length > 0)
        releaseRecord.files = releaseRecord.files.filter((file) =>
          matchesAttributeFilters(
            parseAttributes(file.attributes),
            attributeFilters,
          ),
        );
      items.push(releaseRecord);
    }

    return {
      query: searchOptions.query ?? null,
      offset: searchOptions.offset,
      limit: searchOptions.limit,
      total,
      items,
    };
  }

  async getRelease(
    _type: string,
    id: string,
    version: string,
    manager: AssetService,
  ): Promise<AssetReleaseWithMethods | null> {
    const repository = await this.resolveRepository(id);
    if (!repository) return null;
    const asset = await this.getAsset('mod', id, manager);
    if (!asset) return null;

    const release = await this.getGithubRelease(repository, version);
    if (!release || release.draft) return null;
    const manifest = await this.findReleaseManifest(release, repository);
    return this.persistRelease(asset, release, manifest, repository);
  }

  /**
   * Paginated files of a GitHub release. The release itself is persisted with
   * its files (a GitHub release holds a handful of assets), but the search and
   * the page are still resolved in the database, like the upload provider.
   */
  async listFiles(
    _type: string,
    id: string,
    version: string,
    options: AssetSearchOptions,
    manager: AssetService,
  ): Promise<AssetSearchResult<AssetFileWithMethods> | null> {
    const release = await this.getRelease('mod', id, version, manager);
    if (!release) return null;

    const { ids, total } = await searchFileIds(this.prisma, release, options);
    const byId = new Map(release.files.map((file) => [file.id, file]));
    const items = ids
      .map((fileId) => byId.get(fileId))
      .filter((file): file is AssetFileWithMethods => file !== undefined);

    return {
      query: options.query ?? null,
      offset: options.offset,
      limit: options.limit,
      total,
      items,
    };
  }

  async getFile(
    _type: string,
    id: string,
    version: string,
    name: string,
    manager: AssetService,
  ) {
    const repository = await this.resolveRepository(id);
    if (!repository) return null;
    const asset = await this.getAsset('mod', id, manager);
    if (!asset) return null;
    const release = await this.getGithubRelease(repository, version);
    if (!release || release.draft) return null;
    const manifest = await this.findReleaseManifest(release, repository);
    if (!manifest) return null;
    const releaseRecord = await this.persistRelease(
      asset,
      release,
      manifest,
      repository,
    );
    // The reference is the file name, or its numeric id.
    const numeric = /^\d+$/.test(name) ? Number(name) : null;
    const file =
      (numeric !== null
        ? releaseRecord.files.find((entry) => entry.id === numeric)
        : undefined) ?? releaseRecord.files.find((entry) => entry.name === name);
    if (!file) return null;
    return { kind: 'redirect' as const, url: file.url };
  }

  async handleWebhook(
    type: string,
    id: string,
    token: string,
  ): Promise<boolean | null> {
    if (type !== 'mod') return null;
    const asset = await this.findAssetRecord(id);
    if (!asset || asset.provider !== this.id || asset.type !== type) {
      return null;
    }

    const githubId = repositoryGithubId(asset.metadata);
    if (githubId === null) return null;
    const webhookToken = metadataValue(asset.metadata, 'webhook_token');
    if (!webhookToken || !secureTokenEqual(webhookToken, token)) return false;

    const repository = await this.getGithubRepository(githubId);
    if (!repository) {
      throw new BadGatewayException(
        `GitHub repository ${githubId} was not found while processing its webhook`,
      );
    }
    const repositoryPart = encodeURIComponent(repository.full_name);
    const repositoryApiUrl = await this.githubUrl(`/repositories/${githubId}`);
    await this.cache.del(
      this.assetContextKey(githubId),
      this.repositoryKey(githubId),
      this.repositoryManifestKey(githubId),
      this.releasesKey(githubId),
      this.apiCacheKey(repositoryApiUrl),
    );
    await this.cache.clearPattern(`github:release:${githubId}:*`);
    await this.cache.clearPattern(
      `asset-provider:${this.id}:*${repositoryPart}*`,
    );
    return true;
  }

  private async getGithubRelease(
    repository: GithubRepositoryConfig,
    version: string,
  ): Promise<GithubReleaseResponse | null> {
    const releaseUrl = /^\d+$/.test(version)
      ? `${await this.repositoryUrl(repository)}/releases/${encodeURIComponent(version)}`
      : `${await this.repositoryUrl(repository)}/releases/tags/${encodeURIComponent(toTag(version))}`;
    const release = await this.getCachedValue(
      this.releaseKey(repository.githubId, version),
      (value): value is GithubReleaseResponse => isGithubRelease(value),
      async () => {
        const value = await this.requestJson<unknown>(
          releaseUrl,
          isGithubRelease,
        );
        if (value === null) return null;
        if (!isGithubRelease(value)) {
          throw new BadGatewayException('GitHub returned invalid release data');
        }
        return value;
      },
    );
    if (release === null) return null;
    if (!isGithubRelease(release)) {
      throw new BadGatewayException('GitHub returned invalid release data');
    }
    return release;
  }

  private async getGithubReleases(
    repository: GithubRepositoryConfig,
  ): Promise<GithubReleaseResponse[] | null> {
    return this.getCachedValue(
      this.releasesKey(repository.githubId),
      isGithubReleaseList,
      () => this.fetchGithubReleases(repository),
    );
  }

  private async fetchGithubReleases(
    repository: GithubRepositoryConfig,
  ): Promise<GithubReleaseResponse[] | null> {
    const releases: GithubReleaseResponse[] = [];
    const seenIds = new Set<number>();
    for (let page = 1; ; page++) {
      const response = await this.requestJson<unknown>(
        `${await this.repositoryUrl(repository)}/releases?per_page=100&page=${page}`,
        isGithubReleaseList,
      );
      if (response === null) {
        if (page === 1) return null;
        throw new BadGatewayException(
          'GitHub returned an incomplete release listing',
        );
      }
      if (!Array.isArray(response) || !response.every(isGithubRelease)) {
        throw new BadGatewayException('GitHub returned invalid release data');
      }
      for (const release of response) {
        if (seenIds.has(release.id)) continue;
        seenIds.add(release.id);
        releases.push(release);
      }
      if (response.length < 100) return releases;
    }
  }

  private async resolveRepository(
    id: string,
  ): Promise<GithubRepositoryConfig | null> {
    const databaseId = Number(id);
    if (/^\d+$/.test(id) && Number.isSafeInteger(databaseId)) {
      const asset = await this.prisma.assets.findUnique({
        where: { type_id: { type: 'mod', id: databaseId } },
      });
      if (asset && asset.provider === this.id) {
        const githubId = repositoryGithubId(asset.metadata);
        if (githubId !== null) return this.getRepositoryConfig(githubId);
      }
    }
    const asset = await this.prisma.assets.findUnique({
      where: {
        type_provider_name: {
          type: 'mod',
          provider: this.id,
          name: id,
        },
      },
    });
    if (asset) {
      const githubId = repositoryGithubId(asset.metadata);
      if (githubId !== null) return this.getRepositoryConfig(githubId);
    }
    if (/^\d+$/.test(id)) {
      const githubId = Number(id);
      if (Number.isSafeInteger(githubId) && githubId > 0) {
        return this.getRepositoryConfig(githubId);
      }
    }
    const records = await this.prisma.assets.findMany({
      where: { provider: this.id, type: 'mod' },
    });
    for (const record of records) {
      const githubId = repositoryGithubId(record.metadata);
      if (githubId === null) continue;
      const repository = await this.getRepositoryConfig(githubId);
      if (repository.id === id || repository.aliases.includes(id)) {
        return repository;
      }
    }
    return null;
  }

  private async findAssetRecord(id: string) {
    if (/^\d+$/.test(id)) {
      const databaseId = Number(id);
      if (Number.isSafeInteger(databaseId)) {
        const record = await this.prisma.assets.findUnique({
          where: { type_id: { type: 'mod', id: databaseId } },
        });
        if (record) return record;
      }
    }
    return this.prisma.assets.findUnique({
      where: {
        type_provider_name: {
          type: 'mod',
          provider: this.id,
          name: id,
        },
      },
    });
  }

  private async getRepositoryConfig(
    githubId: number,
  ): Promise<GithubRepositoryConfig> {
    const { manifest, repository } = await this.getRepositoryManifest(githubId);
    return this.repositoryConfig({
      manifest,
      repository,
      latestRelease: null,
      latestReleaseManifest: null,
    });
  }

  private async getRepositoryManifest(
    githubId: number,
  ): Promise<GithubRepositoryManifest> {
    const cached = await this.getCachedValue(
      this.repositoryManifestKey(githubId),
      (value): value is GithubRepositoryManifest =>
        isGithubRepositoryManifest(value) && value.repository.id === githubId,
      async () => {
        const repository = await this.getGithubRepository(githubId);
        if (!repository) {
          throw new BadGatewayException(
            'GitHub returned invalid repository data',
          );
        }
        const manifestResponse = await this.requestJson<unknown>(
          await this.githubUrl(
            `/repos/${repository.full_name}/contents/nox.mod.json`,
          ),
        );
        if (!isGithubFile(manifestResponse)) {
          throw new BadGatewayException(
            `GitHub repository ${repository.full_name} has no valid nox.mod.json`,
          );
        }
        return {
          manifest: parseManifest(
            Buffer.from(manifestResponse.content, 'base64').toString('utf8'),
          ),
          repository,
        };
      },
    );
    if (!cached) {
      throw new BadGatewayException(
        'GitHub repository manifest was not available',
      );
    }
    return cached;
  }

  private async appendRepositoryIfMissing(githubId: number): Promise<void> {
    const { manifest, repository } = await this.getRepositoryManifest(githubId);
    const where = {
      type_provider_name: {
        type: 'mod',
        provider: this.id,
        name: manifest.id,
      },
    };
    const existing = await this.prisma.assets.findUnique({ where });
    const metadata = mergeAssetMetadata(existing?.metadata, repository.id);
    const defaultUserRef = NoxIdentifier.Invalid.toString();

    await this.prisma.assets.upsert({
      where,
      create: {
        type: 'mod',
        provider: this.id,
        name: manifest.id,
        title: manifest.name,
        description: manifest.description,
        tags: (manifest.tags ?? []).filter((tag) => tag.includes(':')),
        owner: defaultUserRef,
        contributor: [defaultUserRef],
        metadata,
      },
      update: {
        owner: defaultUserRef,
        contributor: [defaultUserRef],
        metadata,
      },
    });
    this.logger.log(
      `Synchronized GitHub repository ${repository.full_name} as asset ${manifest.id}`,
    );
  }

  private repositoryConfig(
    context: GithubAssetContext,
  ): GithubRepositoryConfig {
    const [owner, repo] = context.repository.full_name.split('/');
    if (!owner || !repo) {
      throw new BadGatewayException(
        'GitHub returned an invalid repository name',
      );
    }
    return {
      id: context.manifest.id,
      githubId: context.repository.id,
      aliases: context.manifest.provides ?? [],
      owner,
      repo,
    };
  }

  private async repositoryUrl(repository: GithubRepositoryConfig) {
    return this.githubUrl(`/repos/${repository.owner}/${repository.repo}`);
  }

  private async getGithubRepository(
    githubId: number,
  ): Promise<GithubModRepository | null> {
    const validate = (value: unknown): value is GithubModRepository =>
      isGithubRepository(value) && value.id === githubId;
    return this.getCachedValue(
      this.repositoryKey(githubId),
      validate,
      async () =>
        this.requestJson<GithubModRepository>(
          await this.githubUrl(`/repositories/${githubId}`),
          validate,
        ),
    );
  }

  private async githubUrl(path: string): Promise<string> {
    const base = await this.config.get<string>('github.api_base');
    return new URL(
      path.replace(/^\/+/, ''),
      `${base.replace(/\/+$/, '')}/`,
    ).toString();
  }

  private async githubCacheTtl(): Promise<number> {
    return this.config.get<number>('github.cache_ttl');
  }

  private apiCacheKey(url: string): string {
    return `asset-provider:${this.id}:${encodeURIComponent(url)}`;
  }

  private async getCachedValue<T>(
    key: string,
    validate: (value: unknown) => value is T,
    fetchValue?: () => Promise<T | null>,
  ): Promise<T | null> {
    const cached = normalizeCachedDates(await this.cache.get<unknown>(key));
    if (isRecord(cached) && cached.cached === true) {
      if (cached.value === null || validate(cached.value)) {
        return cached.value as T | null;
      }
    } else if (cached !== null && validate(cached)) {
      return cached;
    }
    if (cached !== null) {
      this.logger.warn(`Ignoring invalid cached GitHub value for ${key}`);
      await this.cache.del(key);
    }

    if (!fetchValue) return null;
    const value = await fetchValue();
    await this.cache.set(
      key,
      { cached: true, value },
      await this.githubCacheTtl(),
    );
    return value;
  }

  private async requestJson<T>(
    url: string,
    validate?: (value: unknown) => boolean,
  ): Promise<T | null> {
    const cacheKey = this.apiCacheKey(url);
    const cached = normalizeCachedDates(
      await this.cache.get<unknown>(cacheKey),
    );
    if (isRecord(cached) && cached.cached === true) {
      if (cached.value === null || !validate || validate(cached.value)) {
        return cached.value as T | null;
      }
    } else if (cached !== null && (!validate || validate(cached))) {
      return cached as T;
    }
    if (cached !== null) {
      this.logger.warn(
        `Ignoring invalid GitHub API cache entry for ${url}; fetching a fresh response`,
      );
      await this.cache.del(cacheKey);
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = await this.config.getOptional<string>('github.token');
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new BadGatewayException('Unable to contact the GitHub API', {
        cause: error,
      });
    }

    if (response.status === 404) {
      await this.cache.set(
        cacheKey,
        { cached: true, value: null },
        await this.githubCacheTtl(),
      );
      return null;
    }
    if (!response.ok) {
      if (
        response.status === 403 &&
        response.headers.get('X-RateLimit-Remaining') === '0'
      ) {
        throw new ApiException(
          ApiErrorCode.EXTERNAL_SERVER_ERROR,
          null,
          'GitHub API rate limit exceeded; configure github.token or retry after the rate limit resets',
        );
      }
      if (response.status >= 500) {
        throw new BadGatewayException(
          `GitHub API request failed with status ${response.status}`,
        );
      }
      throw new BadGatewayException(
        `GitHub API request failed with status ${response.status}`,
      );
    }

    try {
      const value = (await response.json()) as T;
      if (value !== null && validate && !validate(value)) {
        throw new BadGatewayException(
          `GitHub returned an invalid response for ${new URL(url).pathname}`,
        );
      }
      await this.cache.set(
        cacheKey,
        { cached: true, value },
        await this.githubCacheTtl(),
      );
      return value;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('GitHub API returned invalid JSON', {
        cause: error,
      });
    }
  }

  private async persistRelease(
    asset: AssetWithMethods,
    source: GithubReleaseResponse,
    manifest: GithubReleaseManifest | null,
    repository: GithubRepositoryConfig,
  ): Promise<AssetReleaseWithMethods> {
    // Releases are persisted as soon as GitHub publishes them, so a persisted
    // release is always considered completed.
    const status: IStatus = {
      status: 'completed',
      progress: null,
      message: null,
    };
    const files = (manifest?.files ?? []).map((file) => {
      const url = this.validateGithubAssetUrl(file.url, repository);
      const name = releaseFileName(url);
      const githubAsset = source.assets.find((entry) => entry.name === name);
      const uploaderLogin = githubAsset?.uploader?.login;
      const uploader =
        !uploaderLogin || uploaderLogin === 'github-actions[bot]'
          ? NoxIdentifier.Invalid
          : new NoxIdentifier(null, uploaderLogin);
      return {
        name,
        url,
        size: BigInt(file.size),
        mime: githubAsset?.content_type ?? mimeType(name),
        attributes: file.platforms.map((platform) => ({
          key: 'platform',
          value: platform,
        })),
        hashes: [file.hash],
        uploader: uploader.toString(),
        metadata: {
          status: statusJson(status),
          providerData: {
            contentType: githubAsset?.content_type ?? null,
          },
        },
      };
    });
    const metadata: Prisma.InputJsonObject = {
      ...mergeProviderMetadata(
        {},
        {
          externalId: String(source.id),
          sourceUrl: source.html_url,
          publishedAt: source.published_at,
          prerelease: source.prerelease,
          manifestVersion: manifest?.version ?? source.tag_name,
        },
      ),
      status: statusJson(status),
    };
    const title = manifest?.version ?? source.name ?? source.tag_name;
    const record = await this.prisma.assetReleases.upsert({
      where: {
        assetType_assetId_name: {
          assetType: asset.type,
          assetId: asset.id,
          name: source.tag_name,
        },
      },
      create: {
        assetType: asset.type,
        assetId: asset.id,
        name: source.tag_name,
        title,
        changelog: source.body,
        channel: releaseChannel(source),
        metadata,
        ...(manifest ? { files: { create: files } } : {}),
      },
      update: {
        title,
        changelog: source.body,
        channel: releaseChannel(source),
        metadata,
        ...(manifest ? { files: { deleteMany: {}, create: files } } : {}),
      },
      include: { files: true },
    });
    const releaseRecord = AssetRelease.attach(record, asset.manager, { asset });
    releaseRecord.files = record.files.map((file) =>
      AssetFile.attach(file, asset.manager, { release: releaseRecord }),
    );
    return releaseRecord;
  }

  private async assetApiUrl(asset: AssetWithMethods): Promise<string> {
    const address = await this.wellKnown.address();
    return new URL(
      `/api/mods/${encodeURIComponent(String(asset.id))}`,
      `https://nox.${address}`,
    ).toString();
  }

  private async releaseApiUrl(
    asset: AssetWithMethods,
    version: string,
  ): Promise<string> {
    const address = await this.wellKnown.address();
    return new URL(
      `/api/mods/${encodeURIComponent(String(asset.id))}/releases/${encodeURIComponent(version)}`,
      `https://nox.${address}`,
    ).toString();
  }

  private async fileApiUrl(
    asset: AssetWithMethods,
    release: AssetReleaseWithMethods,
    file: AssetFileWithMethods,
  ): Promise<string> {
    const externalId = metadataString(release.metadata, 'externalId');
    const address = await this.wellKnown.address();
    return new URL(
      `/api/mods/${encodeURIComponent(String(asset.id))}/releases/${encodeURIComponent(externalId)}/files/${encodeURIComponent(file.name ?? '')}`,
      `https://nox.${address}`,
    ).toString();
  }

  private async getReleaseManifest(
    release: GithubReleaseResponse,
    repository: GithubRepositoryConfig,
  ): Promise<GithubReleaseManifest> {
    const manifest = await this.findReleaseManifest(release, repository);
    if (!manifest) {
      throw new BadGatewayException(
        `GitHub release ${release.tag_name} has no manifest.json`,
      );
    }
    return manifest;
  }

  /**
   * Resolves the release manifest when available.
   * A published release may not have produced its `manifest.json` asset yet —
   * `null` is returned in that case instead of failing the whole request.
   */
  private async findReleaseManifest(
    release: GithubReleaseResponse,
    repository: GithubRepositoryConfig,
  ): Promise<GithubReleaseManifest | null> {
    const manifestAsset = release.assets.find(
      (asset) => asset.name === 'manifest.json',
    );
    if (!manifestAsset) return null;

    const manifest = await this.requestJson<unknown>(
      this.validateGithubAssetUrl(
        manifestAsset.browser_download_url,
        repository,
      ),
    );
    if (!isGithubReleaseManifest(manifest)) {
      throw new BadGatewayException(
        `GitHub release ${release.tag_name} has an invalid manifest.json`,
      );
    }
    return manifest;
  }

  private validateGithubAssetUrl(
    value: string,
    repository: GithubRepositoryConfig,
  ): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new BadGatewayException('GitHub returned an invalid asset URL', {
        cause: error,
      });
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      !url.pathname.startsWith(
        `/${repository.owner}/${repository.repo}/releases/download/`,
      )
    ) {
      throw new BadGatewayException(
        'GitHub returned an unsafe release asset URL',
      );
    }
    return url.toString();
  }
}

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

function mergeProviderMetadata(
  metadata: unknown,
  githubData: Record<string, string | boolean | null>,
): Prisma.InputJsonObject {
  const existing: Prisma.InputJsonObject = isRecord(metadata)
    ? (metadata as Prisma.InputJsonObject)
    : {};
  const providerData: Prisma.InputJsonObject = isRecord(existing.providerData)
    ? (existing.providerData as Prisma.InputJsonObject)
    : {};
  return {
    ...existing,
    providerData: { ...providerData, ...githubData },
  };
}

function mergeAssetMetadata(
  metadata: unknown,
  githubId: number,
): Prisma.InputJsonObject {
  const existing: Prisma.InputJsonObject = isRecord(metadata)
    ? (metadata as Prisma.InputJsonObject)
    : {};
  const webhookToken =
    typeof existing.webhook_token === 'string' && existing.webhook_token
      ? existing.webhook_token
      : randomBytes(32).toString('hex');
  return { ...existing, github_id: githubId, webhook_token: webhookToken };
}

function metadataValue(metadata: unknown, key: string): string | null {
  if (!isRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' && value ? value : null;
}

function secureTokenEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function repositoryGithubId(metadata: unknown): number | null {
  if (!isRecord(metadata)) return null;
  const githubId = metadata.github_id;
  if (
    typeof githubId === 'number' &&
    Number.isSafeInteger(githubId) &&
    githubId > 0
  ) {
    return githubId;
  }
  const providerData = isRecord(metadata.providerData)
    ? metadata.providerData
    : null;
  const legacyGithubId = providerData?.externalId;
  if (
    typeof legacyGithubId === 'string' &&
    /^\d+$/.test(legacyGithubId) &&
    Number.isSafeInteger(Number(legacyGithubId)) &&
    Number(legacyGithubId) > 0
  ) {
    return Number(legacyGithubId);
  }
  return null;
}

function metadataString(metadata: unknown, key: string): string {
  const root = isRecord(metadata) ? metadata : null;
  const providerData =
    root && isRecord(root.providerData) ? root.providerData : null;
  const value = providerData?.[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`GitHub provider metadata is missing "${key}"`);
  }
  return value;
}

/** Reads an optional ISO date from the provider metadata, as epoch ms. */
function metadataDate(metadata: unknown, key: string): number | null {
  const root = isRecord(metadata) ? metadata : null;
  const providerData =
    root && isRecord(root.providerData) ? root.providerData : null;
  const value = providerData?.[key];
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGithubId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid GitHub identifier "${value}"`);
  }
  return id;
}

function releaseChannel(
  release: Pick<GithubReleaseResponse, 'tag_name' | 'prerelease'>,
): 'stable' | 'candidate' | 'nightly' {
  if (!release.prerelease) return 'stable';
  return /(?:^|[-.])nightly(?:[-.\d]|$)/i.test(release.tag_name)
    ? 'nightly'
    : 'candidate';
}

function mimeType(name: string): string {
  return name.toLowerCase().endsWith('.zip')
    ? 'application/zip'
    : 'application/octet-stream';
}

function formatUserRef(reference: string, server: string): string {
  return NoxIdentifier.parse(reference).toString(server);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCachedDates(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : value;
  }
  if (Array.isArray(value)) return value.map(normalizeCachedDates);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeCachedDates(item),
      ]),
    );
  }
  return value;
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isGithubRepository(value: unknown): value is GithubModRepository {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    Number(value.id) > 0 &&
    typeof value.name === 'string' &&
    typeof value.full_name === 'string' &&
    isRecord(value.owner) &&
    typeof value.owner.login === 'string' &&
    typeof value.html_url === 'string' &&
    (value.default_branch === undefined ||
      typeof value.default_branch === 'string') &&
    typeof value.created_at === 'string' &&
    isValidDate(value.created_at) &&
    typeof value.updated_at === 'string' &&
    isValidDate(value.updated_at)
  );
}

function isGithubRepositoryManifest(
  value: unknown,
): value is GithubRepositoryManifest {
  return (
    isRecord(value) &&
    isGithubModManifest(value.manifest) &&
    isGithubRepository(value.repository)
  );
}

function isGithubFile(value: unknown): value is GithubFileResponse {
  return (
    isRecord(value) &&
    value.type === 'file' &&
    value.encoding === 'base64' &&
    typeof value.content === 'string'
  );
}

function isGithubRelease(value: unknown): value is GithubReleaseResponse {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    Number(value.id) > 0 &&
    typeof value.tag_name === 'string' &&
    (typeof value.name === 'string' || value.name === null) &&
    (typeof value.body === 'string' || value.body === null) &&
    typeof value.html_url === 'string' &&
    ((typeof value.published_at === 'string' &&
      isValidDate(value.published_at)) ||
      value.published_at === null) &&
    typeof value.prerelease === 'boolean' &&
    typeof value.draft === 'boolean' &&
    Array.isArray(value.assets) &&
    value.assets.every(
      (asset) =>
        isRecord(asset) &&
        typeof asset.name === 'string' &&
        Number.isSafeInteger(asset.size) &&
        Number(asset.size) >= 0 &&
        typeof asset.content_type === 'string' &&
        typeof asset.browser_download_url === 'string' &&
        (asset.uploader === undefined ||
          asset.uploader === null ||
          (isRecord(asset.uploader) &&
            typeof asset.uploader.login === 'string')),
    )
  );
}

function isGithubReleaseList(value: unknown): value is GithubReleaseResponse[] {
  return Array.isArray(value) && value.every(isGithubRelease);
}

function isGithubReleaseManifest(
  value: unknown,
): value is GithubReleaseManifest {
  return (
    isRecord(value) &&
    typeof value.version === 'string' &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        isRecord(file) &&
        typeof file.url === 'string' &&
        Array.isArray(file.platforms) &&
        file.platforms.every((platform) => typeof platform === 'string') &&
        typeof file.hash === 'string' &&
        /^[a-z0-9_-]+:[a-f0-9]+$/i.test(file.hash) &&
        Number.isSafeInteger(file.size) &&
        Number(file.size) >= 0,
    )
  );
}

function isGithubAssetContext(
  value: unknown,
  githubId: number,
): value is GithubAssetContext {
  if (
    !isRecord(value) ||
    !isGithubModManifest(value.manifest) ||
    !isGithubRepository(value.repository) ||
    value.repository.id !== githubId
  ) {
    return false;
  }
  if (value.latestRelease === null) {
    return value.latestReleaseManifest === null;
  }
  return (
    isGithubRelease(value.latestRelease) &&
    !value.latestRelease.draft &&
    isGithubReleaseManifest(value.latestReleaseManifest)
  );
}

function parseManifest(json: string): GithubModManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch (error) {
    throw new BadGatewayException('GitHub mod manifest contains invalid JSON', {
      cause: error,
    });
  }

  if (!isGithubModManifest(manifest)) {
    throw new BadGatewayException('GitHub mod manifest has an invalid shape');
  }
  return manifest;
}

function isGithubModManifest(value: unknown): value is GithubModManifest {
  return (
    isRecord(value) &&
    value.type === 'mod' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.provides === undefined ||
      (Array.isArray(value.provides) &&
        value.provides.every((item) => typeof item === 'string'))) &&
    typeof value.description === 'string' &&
    (typeof value.icon === 'string' || value.icon === null) &&
    typeof value.license === 'string' &&
    Array.isArray(value.authors) &&
    value.authors.every(
      (author) => isRecord(author) && typeof author.name === 'string',
    ) &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) &&
        value.tags.every((tag) => typeof tag === 'string')))
  );
}
function toTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

function releaseFileName(value: string): string {
  const segment = new URL(value).pathname.split('/').pop();
  if (!segment) {
    throw new BadGatewayException(
      'GitHub returned an invalid release file URL',
    );
  }

  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch (error) {
    throw new BadGatewayException(
      'GitHub returned an invalid release file name',
      {
        cause: error,
      },
    );
  }
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new BadGatewayException(
      'GitHub returned an invalid release file name',
    );
  }
  return name;
}
