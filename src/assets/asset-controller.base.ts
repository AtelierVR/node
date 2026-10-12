import {
  BadRequestException,
  Body,
  DefaultValuePipe,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApiWrappedResponse } from '@/api/swagger';
import { ApiFileDto, ApiFileListDto } from '@/assets/dto/file-response.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { AuthUserGuard, OptionalAuthUserGuard } from '@/auth/auth.guard';
import type {
  OptionalUserAuthenticatedRequest,
  UserAuthenticatedRequest,
} from '@/auth/auth.guard';
import {
  ASSET_ENDPOINT_METADATA,
  ASSET_TYPE_METADATA,
} from '@/assets/asset.constants';
import type { IAssetController } from '@/assets/asset-controller.interface';
import { AssetService } from '@/assets/asset.service';
import type { AssetSearchResult } from '@/assets/asset-provider.interface';
import type {
  AssetAttributeFilter,
  IApiAsset,
  IApiFile,
  IApiRelease,
  ISanitizeOptions,
  ProcessStatus,
} from '@/assets/asset.types';
import { parseStatusFilters, PROCESS_STATUSES } from '@/assets/asset.types';
import {
  CreateUploadAssetDto,
  CreateUploadReleaseDto,
  InitUploadFileDto,
  UpdateUploadAssetDto,
  UpdateUploadReleaseDto,
} from '@/assets/upload/dto/upload.dto';

/** OpenAPI description of the cumulative `?status=` filter. */
const STATUS_QUERY = {
  name: 'status',
  required: false,
  isArray: true,
  enum: [...PROCESS_STATUSES, 'all'],
  description:
    'Statuses to include, cumulative (`?status=awaiting&status=queued`), ' +
    '`all` for everything. Defaults to `completed`, so pending and failed ' +
    'resources stay out of the listing.',
};

/** Query parameters owned by the listings; anything else is an attribute filter. */
const RESERVED_RELEASE_QUERY = new Set([
  'query',
  'limit',
  'offset',
  'full',
  'status',
]);

/** Multer temp storage for asset image uploads (same pattern as avatars/worlds). */
const multerImageTempOpts = {
  storage: diskStorage({
    destination: tmpdir(),
    filename: (_req: any, file: any, cb: any) => {
      const uid = randomBytes(6).toString('hex');
      cb(null, `${Date.now()}-${uid}${extname(file.originalname)}`);
    },
  }),
};

@Injectable()
export abstract class AssetControllerBase implements IAssetController {
  constructor(private readonly assets: AssetService) {}

  get assetType(): string {
    return this.getMetadata(ASSET_TYPE_METADATA);
  }

  get endpoint(): string {
    return this.getMetadata(ASSET_ENDPOINT_METADATA);
  }

  @UseGuards(OptionalAuthUserGuard)
  @Get()
  @ApiQuery({ name: 'query', required: false, description: 'Text search' })
  @ApiQuery(STATUS_QUERY)
  async search(
    @Query('query') query: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('full') full: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Req() request: OptionalUserAuthenticatedRequest,
  ): Promise<AssetSearchResult<IApiAsset>> {
    if (limit < 1 || limit > 100 || offset < 0)
      throw new BadRequestException(
        'Expected limit between 1 and 100 and a non-negative offset',
      );
    const result = await this.assets.search(this.assetType, {
      query,
      statuses: parseStatus(status),
      limit,
      offset,
    });
    return {
      ...result,
      items: await Promise.all(
        result.items.map((asset) =>
          asset.sanitize(request.user ?? undefined, sanitizeOptions(full)),
        ),
      ),
    };
  }

  @UseGuards(OptionalAuthUserGuard)
  @Get(':id')
  async getAsset(
    @Param('id') id: string,
    @Query('full') full: string | undefined,
    @Req() request: OptionalUserAuthenticatedRequest,
  ): Promise<IApiAsset> {
    const asset = await this.assets.getAsset(this.assetType, id);
    return asset.sanitize(request.user ?? undefined, sanitizeOptions(full));
  }

  @Get(':id/webhook')
  @HttpCode(204)
  async webhook(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
  ): Promise<void> {
    await this.processWebhook(id, token);
  }

  /**
   * GitHub — and most webhook providers — deliver events with `POST`.
   * The token is read from the `token` query parameter or from the
   * `X-Nox-Webhook-Token` header. The body is intentionally ignored: the
   * handler only invalidates the provider cache so the next read refreshes it.
   */
  @Post(':id/webhook')
  @HttpCode(204)
  async webhookPost(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Headers('x-nox-webhook-token') headerToken: string | undefined,
  ): Promise<void> {
    await this.processWebhook(id, token ?? headerToken);
  }

  private async processWebhook(
    id: string,
    token: string | undefined,
  ): Promise<void> {
    if (!token) throw new UnauthorizedException('Invalid webhook token');
    await this.assets.notifyWebhook(this.assetType, id, token);
  }

  /**
   * GET /api/:type/:id/releases
   *
   * Besides `query`/`limit`/`offset`/`full`/`status`, any other query parameter
   * is an attribute filter on the release files: `?engine=unity&platform=windows`
   * keeps the releases having a file that declares both attributes. Repeat a
   * parameter to OR its values (`?platform=windows&platform=linux`), leave it
   * empty to only require the key (`?engine=`), or use the explicit
   * `?attribute=key:value` form.
   *
   * By default only the **completed** releases are listed: `?status=` (see
   * {@link parseStatus}) opts into the pending or failed ones.
   */
  @Get(':id/releases')
  @ApiQuery(STATUS_QUERY)
  async listReleases(
    @Param('id') id: string,
    @Query('query') query: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('full') full: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query() queryParams: Record<string, string | string[]> = {},
  ): Promise<AssetSearchResult<IApiRelease>> {
    if (limit < 1 || limit > 100 || offset < 0)
      throw new BadRequestException(
        'Expected limit between 1 and 100 and a non-negative offset',
      );
    const result = await this.assets.listReleases(this.assetType, id, {
      query,
      attributes: parseAttributeFilters(queryParams),
      statuses: parseStatus(status),
      limit,
      offset,
    });
    return {
      ...result,
      items: await Promise.all(
        result.items.map((release) =>
          release.sanitize(undefined, sanitizeOptions(full)),
        ),
      ),
    };
  }

  @Get(':id/releases/:version')
  async getRelease(
    @Param('id') id: string,
    @Param('version') version: string,
    @Query('full') full: string | undefined,
  ): Promise<IApiRelease> {
    const release = await this.assets.getRelease(this.assetType, id, version);
    return release.sanitize(undefined, sanitizeOptions(full));
  }

  /**
   * GET /api/:type/:id/releases/:version/files
   *
   * Paginated files of a release — they are not embedded in the release itself,
   * which may hold a very large number of them. Same query parameters as the
   * release listing: `query` (file name/mime), `limit`, `offset`, `full`,
   * plus the attribute filters (`?platform=windows`, `?attribute=key:value`,
   * `?engine=`…) and the status filter. Only the **completed** files are listed
   * by default: `?status=awaiting`, `?status=all`… opt into the pending ones.
   */
  @Get(':id/releases/:version/files')
  @ApiQuery(STATUS_QUERY)
  @ApiWrappedResponse(ApiFileListDto)
  async listFiles(
    @Param('id') id: string,
    @Param('version') version: string,
    @Query('query') query: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('full') full: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query() queryParams: Record<string, string | string[]> = {},
  ): Promise<AssetSearchResult<IApiFile>> {
    if (limit < 1 || limit > 100 || offset < 0)
      throw new BadRequestException(
        'Expected limit between 1 and 100 and a non-negative offset',
      );
    const result = await this.assets.listFiles(this.assetType, id, version, {
      query,
      attributes: parseAttributeFilters(queryParams),
      statuses: parseStatus(status),
      limit,
      offset,
    });
    return {
      ...result,
      items: await Promise.all(
        result.items.map((file) =>
          file.sanitize(undefined, sanitizeOptions(full)),
        ),
      ),
    };
  }

  @Get(':id/releases/:version/files/:name')
  async getFile(
    @Param('id') id: string,
    @Param('version') version: string,
    @Param('name') name: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    const file = await this.assets.getFile(this.assetType, id, version, name);
    if (file.kind === 'redirect') {
      response.redirect(file.statusCode ?? 302, file.url);
      return;
    }

    if (file.contentType) response.setHeader('Content-Type', file.contentType);
    if (file.contentLength !== undefined)
      response.setHeader('Content-Length', file.contentLength);
    return new StreamableFile(file.stream);
  }

  // ── Upload (SDK / CI-CD) ──────────────────────────────────────────────────────

  /** PUT /api/:type — register a new locally-hosted asset. */
  @ApiOperation({
    summary: 'Create asset',
    description:
      'Register a new asset that will host uploaded files (owner becomes the caller).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Put()
  async createUploadAsset(
    @Req() request: UserAuthenticatedRequest,
    @Body() body: CreateUploadAssetDto,
    @Query('full') full: string | undefined,
  ): Promise<IApiAsset> {
    const asset = await this.assets.createUploadAsset(
      this.assetType,
      body,
      request.user,
    );
    return asset.sanitize(request.user, sanitizeOptions(full));
  }

  /** PUT /api/:type/:id/releases — create an upload target release. */
  @ApiOperation({
    summary: 'Create release',
    description: 'Create a release (upload target) for an asset.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Put(':id/releases')
  async createUploadRelease(
    @Param('id') id: string,
    @Req() request: UserAuthenticatedRequest,
    @Body() body: CreateUploadReleaseDto,
    @Query('full') full: string | undefined,
  ): Promise<IApiRelease> {
    const release = await this.assets.createUploadRelease(
      this.assetType,
      id,
      body,
      request.user,
    );
    return release.sanitize(request.user, sanitizeOptions(full));
  }

  /** POST /api/:type/:id/releases/:releaseId/files — reserve a file slot. */
  @ApiOperation({
    summary: 'Init file upload',
    description:
      'Reserve a file slot and return its signed upload URL (status "awaiting").',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @ApiWrappedResponse(ApiFileDto, HttpStatus.CREATED)
  @Post(':id/releases/:releaseId/files')
  async initUploadFile(
    @Param('id') id: string,
    @Param('releaseId') releaseId: string,
    @Req() request: UserAuthenticatedRequest,
    @Body() body: InitUploadFileDto,
    @Query('full') full: string | undefined,
  ): Promise<IApiFile> {
    const file = await this.assets.initUploadFile(
      this.assetType,
      id,
      releaseId,
      body,
      request.user,
    );
    return file.sanitize(request.user, sanitizeOptions(full));
  }

  /** PUT /api/:type/:id/releases/:releaseId/files/:fileId — receive raw bytes. */
  @ApiOperation({
    summary: 'Upload file bytes',
    description:
      'Stream the raw file content (application/octet-stream). The bytes are verified and the slot is queued for validation (status "queued"); the bundle analysis and the storage write then run in the background ("processing" → "completed", or "failed"). Poll the file until it is stable (no refetch_at). Requires owner/contributor/admin. Optional integrity headers: Content-Hash, Content-Signature, Content-Length, Content-Disposition.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @ApiWrappedResponse(ApiFileDto)
  @Put(':id/releases/:releaseId/files/:fileId')
  async storeUploadFile(
    @Param('id') id: string,
    @Param('releaseId') releaseId: string,
    @Param('fileId') fileId: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-hash') contentHash: string | undefined,
    @Headers('content-signature') contentSignature: string | undefined,
    @Headers('content-length') contentLength: string | undefined,
    @Headers('content-disposition') contentDisposition: string | undefined,
    @Req() request: UserAuthenticatedRequest,
    @Query('full') full: string | undefined,
  ): Promise<IApiFile> {
    const file = await this.assets.storeUploadFile(
      this.assetType,
      id,
      releaseId,
      parseUploadFileId(fileId),
      request,
      contentType,
      {
        hash: contentHash,
        signature: contentSignature,
        length: contentLength,
        disposition: contentDisposition,
      },
      request.user,
    );
    return file.sanitize(request.user, sanitizeOptions(full));
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  /** PATCH /api/:type/:id — update an asset (metadata + preferred release). */
  @ApiOperation({
    summary: 'Update asset',
    description:
      'Update an asset metadata (name, title, description, tags) and/or its preferred release. Send `release: null` to go back to `auto` (latest release).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Patch(':id')
  async updateUploadAsset(
    @Param('id') id: string,
    @Req() request: UserAuthenticatedRequest,
    @Body() body: UpdateUploadAssetDto,
    @Query('full') full: string | undefined,
  ): Promise<IApiAsset> {
    const asset = await this.assets.updateUploadAsset(
      this.assetType,
      id,
      body,
      request.user,
    );
    return asset.sanitize(request.user, sanitizeOptions(full));
  }

  /** PATCH /api/:type/:id/releases/:version — update a release (metadata only). */
  @ApiOperation({
    summary: 'Update release',
    description:
      'Update a release metadata (name, title, changelog, channel). Files are immutable: they can only be created or deleted.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Patch(':id/releases/:version')
  async updateUploadRelease(
    @Param('id') id: string,
    @Param('version') version: string,
    @Req() request: UserAuthenticatedRequest,
    @Body() body: UpdateUploadReleaseDto,
    @Query('full') full: string | undefined,
  ): Promise<IApiRelease> {
    const release = await this.assets.updateUploadRelease(
      this.assetType,
      id,
      version,
      body,
      request.user,
    );
    return release.sanitize(request.user, sanitizeOptions(full));
  }

  /** GET /api/:type/:id/releases/:releaseId/files/:fileRef/status — file status. */
  @ApiOperation({
    summary: 'Get file status',
    description:
      'Return a file slot status (IApiFile) without streaming its bytes. `fileRef` is the file name or its numeric id. Poll it while `refetch_at` is not null.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @ApiWrappedResponse(ApiFileDto)
  @Get(':id/releases/:releaseId/files/:fileRef/status')
  async getUploadFileStatus(
    @Param('id') id: string,
    @Param('releaseId') releaseId: string,
    @Param('fileRef') fileRef: string,
    @Req() request: UserAuthenticatedRequest,
    @Query('full') full: string | undefined,
  ): Promise<IApiFile> {
    const file = await this.assets.getUploadFileStatus(
      this.assetType,
      id,
      releaseId,
      fileRef,
      request.user,
    );
    return file.sanitize(request.user, sanitizeOptions(full));
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  /** DELETE /api/:type/:id — delete an asset (and its releases/files). */
  @ApiOperation({
    summary: 'Delete asset',
    description:
      'Permanently delete an asset and its releases/files (owner, contributor or admin only).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Delete(':id')
  async deleteAsset(
    @Param('id') id: string,
    @Req() request: UserAuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.assets.deleteAsset(this.assetType, id, request.user);
    return { success: true };
  }

  /** DELETE /api/:type/:id/releases/:version — delete a release. */
  @ApiOperation({
    summary: 'Delete release',
    description:
      'Permanently delete a release and its files (owner, contributor or admin only).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Delete(':id/releases/:version')
  async deleteRelease(
    @Param('id') id: string,
    @Param('version') version: string,
    @Req() request: UserAuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.assets.deleteRelease(this.assetType, id, version, request.user);
    return { success: true };
  }

  /** DELETE /api/:type/:id/releases/:version/files/:name — delete a file. */
  @ApiOperation({
    summary: 'Delete file',
    description:
      'Permanently delete a file from a release (owner, contributor or admin only).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Delete(':id/releases/:version/files/:name')
  async deleteFile(
    @Param('id') id: string,
    @Param('version') version: string,
    @Param('name') name: string,
    @Req() request: UserAuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.assets.deleteFile(
      this.assetType,
      id,
      version,
      name,
      request.user,
    );
    return { success: true };
  }

  // ── Images ─────────────────────────────────────────────────────────────────────

  /** POST /api/:type/:id/images — attach an uploaded image. */
  @ApiOperation({
    summary: 'Upload asset image',
    description:
      'Upload an image (multipart/form-data, field: file) and attach it to the asset (owner, contributor or admin only).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @UseInterceptors(FileInterceptor('file', multerImageTempOpts))
  @Post(':id/images')
  async addAssetImage(
    @Param('id') id: string,
    @Req() request: UserAuthenticatedRequest,
    @Query('full') full: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<IApiAsset> {
    if (!file) throw new BadRequestException('file is required');
    if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(file.mimetype))
      throw new BadRequestException(
        'file must be an image (png, jpeg, gif, webp, avif)',
      );
    const asset = await this.assets.addAssetImage(
      this.assetType,
      id,
      { source: file.path, mimetype: file.mimetype },
      request.user,
    );
    return asset.sanitize(request.user, sanitizeOptions(full));
  }

  /** DELETE /api/:type/:id/images/:index — remove an image. */
  @ApiOperation({
    summary: 'Delete asset image',
    description:
      'Remove an asset image by its zero-based index (owner, contributor or admin only).',
  })
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Delete(':id/images/:index')
  async removeAssetImage(
    @Param('id') id: string,
    @Param('index') index: string,
    @Req() request: UserAuthenticatedRequest,
    @Query('full') full: string | undefined,
  ): Promise<IApiAsset> {
    const parsed = Number(index);
    if (!Number.isInteger(parsed) || parsed < 0)
      throw new BadRequestException('index must be a non-negative integer');
    const asset = await this.assets.removeAssetImage(
      this.assetType,
      id,
      parsed,
      request.user,
    );
    return asset.sanitize(request.user, sanitizeOptions(full));
  }

  private getMetadata(key: string): string {
    const value: unknown = Reflect.getMetadata(key, this.constructor);
    if (typeof value !== 'string' || !value)
      throw new Error(`Missing asset controller metadata: ${key}`);
    return value;
  }
}

/** `?full=1` → expanded sanitization (nested objects instead of ids/urls). */
function sanitizeOptions(
  full: string | undefined,
): ISanitizeOptions | undefined {
  return full === '1' ? { expanded: true } : undefined;
}

/**
 * Reads the `?status=` filters of a listing. Repeatable and cumulative, `all`
 * expands to every status, and the default (no parameter) keeps only the
 * completed resources.
 */
function parseStatus(
  value: string | string[] | undefined,
): readonly ProcessStatus[] {
  const statuses = parseStatusFilters(value);
  if (!statuses)
    throw new BadRequestException(
      `Expected status to be ${PROCESS_STATUSES.join(', ')}, or all`,
    );
  return statuses;
}

/**
 * Reads release attribute filters from the raw query string.
 *
 * Every non-reserved parameter becomes a filter (`?engine=unity`); repeated
 * parameters OR their values, and an empty value only requires the key to be
 * present. `?attribute=key:value` (repeatable) is an explicit alternative for
 * keys that collide with a reserved name.
 */
function parseAttributeFilters(
  params: Record<string, string | string[]> | undefined,
): AssetAttributeFilter[] {
  if (!params) return [];
  const collected = new Map<string, string[]>();
  const add = (key: string, value: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    const values = collected.get(trimmed) ?? [];
    if (value && !values.includes(value)) values.push(value);
    collected.set(trimmed, values);
  };

  for (const [rawKey, raw] of Object.entries(params)) {
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (value): value is string => typeof value === 'string',
    );
    const key = rawKey.toLocaleLowerCase();
    if (key === 'attribute' || key === 'attr') {
      for (const entry of values) {
        const separator = entry.indexOf(':');
        if (separator > 0)
          add(entry.slice(0, separator), entry.slice(separator + 1));
      }
      continue;
    }
    if (RESERVED_RELEASE_QUERY.has(key)) continue;
    for (const value of values) add(rawKey, value);
  }

  return [...collected].map(([key, values]) => ({ key, values }));
}

/** Parses a `:fileId` path param, rejecting anything that is not a positive integer. */
function parseUploadFileId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new BadRequestException('fileId must be a positive integer');
  return parsed;
}
