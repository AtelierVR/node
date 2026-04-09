import {
    Controller, Get, Put, Post, Delete, Param, Req, Res,
    UseGuards, Query, Body, UseInterceptors, UploadedFile, HttpCode, HttpStatus,
} from '@nestjs/common';
import type { Request, Response, Express } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { randomBytes } from 'node:crypto';
import { extname } from 'path';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiWrappedSuccessResponse, ApiErrorResponse, ApiOptionalBearerAuth } from '../api/swagger';
import { ApiWorldDto, ApiWorldAssetDto } from './dto/world-response.dto';
import { ApiAssetJobStatusDto } from '../storage/dto/storage-response.dto';
import { WorldsService } from './worlds.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { AuthUserGuard, UserAuthenticatedRequest, OptionalAuthUserGuard, OptionalUserAuthenticatedRequest } from '../auth/auth.guard';
import { AuthOrServerAsUserGuard } from '../auth/auth-or-server-as-user.guard';
import { ServerAsUserAuthenticatedRequest } from '../auth/server-as-user.guard';
import { CreateWorldDto } from './dto/create-world.dto';
import { UpdateWorldDto } from './dto/update-world.dto';
import { CreateAssetDto } from './dto/create-asset.dto';

const multerTempOpts = {
    storage: diskStorage({
        destination: tmpdir(),
        filename: (_req: any, file: any, cb: any) => {
            const uid = randomBytes(6).toString('hex');
            cb(null, `${Date.now()}-${uid}${extname(file.originalname)}`);
        },
    }),
};

@ApiTags('Worlds')
@Controller('worlds')
export class WorldsController {
    constructor(private readonly worlds: WorldsService) { }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private parsePaging(rawLimit?: string, rawOffset?: string, defaultLimit = 10) {
        let limit = parseInt(rawLimit ?? String(defaultLimit), 10);
        let offset = parseInt(rawOffset ?? '0', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
        if (limit > 100) limit = 100;
        if (!Number.isFinite(offset) || offset < 0) offset = 0;
        return { limit, offset };
    }

    private async resolveLocalWorld(id: string) {
        const identifier = NoxIdentifier.parse(id);
        if (!identifier.isLocal(await this.worlds.address()))
            throw new ApiException(ApiErrorCode.NOT_IMPLEMENTED, null, `Fetch remote world (${identifier.toString()})`);
        const numericId = identifier.numericId;
        if (numericId === null)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `World ID must be numeric`);
        const world = await this.worlds.findById(numericId);
        if (!world) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `World (${id})`);
        return world;
    }

    private async resolveWorldOrRemote(id: string) {
        const identifier = NoxIdentifier.parse(id);
        if (identifier.isLocal(await this.worlds.address())) {
            const numericId = identifier.numericId;
            if (numericId === null)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `World ID must be numeric`);
            const world = await this.worlds.findById(numericId);
            if (!world) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `World (${id})`);
            return { world, identifier, remote: false as const };
        }
        return { world: null, identifier, remote: true as const };
    }

    private requireExternalFetch(req: Request & OptionalUserAuthenticatedRequest) {
        if (!req.user)
            throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
        if (!this.worlds.canExternalFetch(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
    }

    // ── Search ───────────────────────────────────────────────────────────────────

    /**
     * GET /api/worlds
     * Query: query, ids (repeated), limit, offset
     */
    @ApiOperation({ summary: 'Search worlds', description: 'Paginated full-text search for worlds, or fetch by IDs.' })
    @ApiWrappedArrayResponse(ApiWorldDto)
    @Get()
    async search(
        @Query('query') query?: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
        @Query('id') id?: string | string[],
    ) {
        const { limit, offset } = this.parsePaging(rawLimit, rawOffset);

        let ids: number[] | undefined;
        if (id) {
            const idsParam = Array.isArray(id) ? id : [id];
            const domain = await this.worlds.address();
            ids = [];
            for (const raw of idsParam) {
                try {
                    const ni = NoxIdentifier.parse(raw);
                    if (!ni.isLocal(domain)) continue;
                    if (ni.numericId !== null) ids.push(ni.numericId);
                } catch { /* ignore */ }
            }
        }

        const opts = ids && ids.length > 0 ? { ids } : { query: query ?? undefined };
        const result = await this.worlds.searchWorlds(opts, limit, offset);
        return {
            total: result.total,
            limit,
            offset,
            items: await Promise.all(result.worlds.map(w => w.sanitize())),
        };
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    /** PUT /api/worlds */
    @ApiOperation({ summary: 'Create world', description: 'Create a new world owned by the authenticated user (local or federated).' })
    @ApiWrappedResponse(ApiWorldDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiBearerAuth()
    @UseGuards(AuthOrServerAsUserGuard)
    @Put()
    async create(
        @Req() req: Request & (UserAuthenticatedRequest | ServerAsUserAuthenticatedRequest),
        @Body() body: CreateWorldDto,
    ) {
        const user = req.user;
        if (!this.worlds.canCreateWorld(user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'create world');


        const world = await this.worlds.createWorld(body, user);
        return await world.sanitize();
    }

    // ── Single world ─────────────────────────────────────────────────────────────

    /** GET /api/worlds/:id */
    @ApiOperation({ summary: 'Get world', description: 'Return a single world by NoxIdentifier. Fetches from remote server if the ID is not local.' })
    @ApiWrappedResponse(ApiWorldDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id')
    async getWorld(@Param('id') id: string, @Req() req: Request & OptionalUserAuthenticatedRequest) {
        const { world, identifier, remote } = await this.resolveWorldOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.worlds.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const resp = await server.fetch<any>(`/api/worlds/${identifier.toString()}`);
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `World (${id})`);
            return resp.data;
        }
        return await world!.sanitize();
    }

    /** POST /api/worlds/:id */
    @ApiOperation({ summary: 'Update world', description: 'Update world metadata (owner/contributor or admin only).' })
    @ApiWrappedResponse(ApiWorldDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Post(':id')
    async updateWorld(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Body() body: UpdateWorldDto,
    ) {
        const world = await this.resolveLocalWorld(id);
        const domain = await this.worlds.address();
        const userRef = `${req.user.id}@${domain}`;
        if (!world.canModify(userRef) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'modify world');

        const updated = await this.worlds.updateWorld(world.id, body);
        return await updated.sanitize();
    }

    /** DELETE /api/worlds/:id — owner only */
    @ApiOperation({ summary: 'Delete world', description: 'Permanently delete a world and all its assets (owner or admin only).' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Delete(':id')
    async deleteWorld(@Param('id') id: string, @Req() req: Request & UserAuthenticatedRequest) {
        const world = await this.resolveLocalWorld(id);
        const domain = await this.worlds.address();
        const userRef = `${req.user.id}@${domain}`;
        if (!world.isOwner(userRef) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'delete world');

        await this.worlds.deleteWorld(world.id);
        return { success: true };
    }

    // ── Thumbnail ─────────────────────────────────────────────────────────────────

    /** GET /api/worlds/:id/thumbnail */
    @ApiOperation({ summary: 'Get world thumbnail', description: 'Redirect to the world thumbnail URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/thumbnail')
    async getThumbnail(@Param('id') id: string, @Req() req: Request & OptionalUserAuthenticatedRequest, @Res() res: Response) {
        const { world, identifier, remote } = await this.resolveWorldOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.worlds.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const wk = await server.wellKnown();
            return res.redirect(302, new URL(`/api/worlds/${identifier.toString()}/thumbnail`, wk.data.gateway.api).toString());
        }
        if (!world!.thumbnail)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        const file = await this.worlds.storage.get(world!.thumbnail);
        return res.redirect(302, file.url.toString());
    }

    /** POST /api/worlds/:id/thumbnail */
    @ApiOperation({ summary: 'Upload world thumbnail', description: 'Upload an image (multipart/form-data, field: file) as the world thumbnail.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the uploaded thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @UseInterceptors(FileInterceptor('file', multerTempOpts))
    @Post(':id/thumbnail')
    async uploadThumbnail(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Res() res: Response,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        const world = await this.resolveLocalWorld(id);
        const domain = await this.worlds.address();
        const userRef = `${req.user.id}@${domain}`;
        if (!world.canModify(userRef) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'modify world');
        if (!this.worlds.canUploadFile(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload file');

        if (!file) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file');
        if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file must be an image (png, jpeg, gif, webp)');

        const updated = await this.worlds.updateWorld(world.id, {} as UpdateWorldDto, file);
        const thumb = updated.thumbnail;
        if (!thumb) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        const stored = await this.worlds.storage.get(thumb);
        return res.redirect(302, stored.url.toString());
    }

    // ── Assets ────────────────────────────────────────────────────────────────────

    /**
     * GET /api/worlds/:id/assets
     * Query: version (repeated), engine (repeated), platform (repeated), empty, limit, offset
     */
    @ApiOperation({ summary: 'List world assets', description: 'Paginated list of assets for a world, filterable by version/engine/platform.' })
    @ApiWrappedArrayResponse(ApiWorldAssetDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/assets')
    async listAssets(
        @Param('id') id: string,
        @Req() req: Request & OptionalUserAuthenticatedRequest,
        @Query('version') version?: string | string[],
        @Query('engine') engine?: string | string[],
        @Query('platform') platform?: string | string[],
        @Query('empty') showEmpty?: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const { world, identifier, remote } = await this.resolveWorldOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.worlds.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const params = new URLSearchParams();
            if (version) (Array.isArray(version) ? version : [version]).forEach(v => params.append('version', v));
            if (engine) (Array.isArray(engine) ? engine : [engine]).forEach(v => params.append('engine', v));
            if (platform) (Array.isArray(platform) ? platform : [platform]).forEach(v => params.append('platform', v));
            if (showEmpty !== undefined) params.set('empty', showEmpty);
            if (rawLimit) params.set('limit', rawLimit);
            if (rawOffset) params.set('offset', rawOffset);
            const qs = params.toString();
            const resp = await server.fetch<any>(`/api/worlds/${identifier.toString()}/assets${qs ? '?' + qs : ''}`);
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `World (${id})`);
            return resp.data;
        }
        const { limit, offset } = this.parsePaging(rawLimit, rawOffset, 50);

        const parseInts = (v?: string | string[]) =>
            v ? (Array.isArray(v) ? v : [v]).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)) : undefined;
        const parseStrings = (v?: string | string[]) =>
            v ? (Array.isArray(v) ? v : [v]) : undefined;

        const result = await this.worlds.findAssetsByWorldId(world!.id, {
            versions: parseInts(version),
            engines: parseStrings(engine),
            platforms: parseStrings(platform),
            showEmpty: showEmpty === undefined ? undefined : showEmpty !== 'false',
            limit,
            offset,
        });

        return {
            total: result.total,
            limit,
            offset,
            items: await Promise.all(result.assets.map(a => a.sanitize())),
        };
    }

    /** PUT /api/worlds/:id/assets — create an asset slot */
    @ApiOperation({ summary: 'Create world asset', description: 'Register a new asset slot for a world. Optionally provide an external URL; otherwise upload a file to the returned slot.' })
    @ApiWrappedResponse(ApiWorldAssetDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Put(':id/assets')
    async createAsset(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Body() body: CreateAssetDto,
    ) {
        const world = await this.resolveLocalWorld(id);
        const domain = await this.worlds.address();
        const userRef = `${req.user.id}@${domain}`;
        if (!world.canModify(userRef) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'create asset');

        const asset = await this.worlds.createAsset(world.id, body);
        return await asset.sanitize();
    }

    /** POST /api/worlds/:id/assets/:asset_id/file — enqueue asset file for async processing */
    @ApiOperation({ summary: 'Upload world asset file', description: 'Upload a file (multipart/form-data, field: file) for async processing. Returns 202 Accepted with queue position.' })
    @ApiWrappedResponse(ApiAssetJobStatusDto, HttpStatus.ACCEPTED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @UseInterceptors(FileInterceptor('file', multerTempOpts))
    @HttpCode(HttpStatus.ACCEPTED)
    @Post(':id/assets/:asset_id/file')
    async uploadAssetFile(
        @Param('id') id: string,
        @Param('asset_id') assetId: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        const world = await this.resolveLocalWorld(id);
        const domain = await this.worlds.address();
        const userRef = `${req.user.id}@${domain}`;
        if (!world.canModify(userRef) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload asset');
        if (!this.worlds.canUploadFile(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload file');

        if (!file) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file');

        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.worlds.findAssetById(aid);
        if (!asset || asset.worldId !== world.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);

        const expectedHash = (req as any).headers?.['x-file-hash'] as string | undefined;
        const job = this.worlds.enqueueAssetFile(aid, file, userRef, expectedHash);

        return {
            status: job.status,
            progress: job.progress,
            message: job.message,
            queue_position: this.worlds.queue.queuePosition(aid),
        };
    }

    /** GET /api/worlds/:id/assets/:asset_id/status — poll processing status */
    @ApiOperation({ summary: 'Get asset processing status', description: 'Poll the processing status of an uploaded world asset file.' })
    @ApiWrappedResponse(ApiAssetJobStatusDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/assets/:asset_id/status')
    async getAssetStatus(
        @Param('id') id: string,
        @Param('asset_id') assetId: string,
        @Req() req: Request & OptionalUserAuthenticatedRequest,
    ) {
        const { world, identifier, remote } = await this.resolveWorldOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.worlds.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const resp = await server.fetch<any>(`/api/worlds/${identifier.toString()}/assets/${assetId}/status`);
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);
            return resp.data;
        }
        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.worlds.findAssetById(aid);
        if (!asset || asset.worldId !== world!.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);

        const job = this.worlds.getJobStatus(aid);

        if (!job) {
            if (asset.isEmpty()) return { status: 'empty' };
            // Asset has a file but no active job — previously completed
            return { status: 'completed', hash: asset.hash, size: asset.size };
        }

        switch (job.status) {
            case 'pending':
                return {
                    status: 'pending',
                    progress: job.progress,
                    message: job.message,
                    queue_position: this.worlds.queue.queuePosition(aid),
                };
            case 'processing':
                return {
                    status: 'processing',
                    progress: job.progress,
                    message: job.message,
                };
            case 'completed':
                return {
                    status: 'completed',
                    hash: job.context.hash,
                    size: job.context.fileSize,
                    done_at: job.doneAt,
                };
            case 'failed':
                return { status: 'failed', error: job.error };
        }
    }

    /** GET /api/worlds/:id/assets/:asset_id/file — redirect to asset file */
    @ApiOperation({ summary: 'Get world asset file', description: 'Redirect to the download URL of the world asset file.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the asset file URL.' })
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/assets/:asset_id/file')
    async getAssetFile(
        @Param('id') id: string,
        @Param('asset_id') assetId: string,
        @Req() req: Request & OptionalUserAuthenticatedRequest,
        @Res() res: Response,
    ) {
        const { world, identifier, remote } = await this.resolveWorldOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.worlds.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const wk = await server.wellKnown();
            return res.redirect(302, new URL(`/api/worlds/${identifier.toString()}/assets/${assetId}/file`, wk.data.gateway.api).toString());
        }
        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.worlds.findAssetById(aid);
        if (!asset || asset.worldId !== world!.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);
        if (asset.isEmpty())
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Asset file');

        const file = await this.worlds.storage.get(asset.url!);
        return res.redirect(302, file.url.toString());
    }

    /** DELETE /api/worlds/:id/assets/:asset_id */
    @ApiOperation({ summary: 'Delete world asset', description: 'Permanently delete a world asset slot and its associated file (owner or admin only).' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Delete(':id/assets/:asset_id')
    async deleteAsset(
        @Param('id') id: string,
        @Param('asset_id') assetId: string,
        @Req() req: Request & UserAuthenticatedRequest,
    ) {
        const world = await this.resolveLocalWorld(id);
        const domain = await this.worlds.address();
        const userRef = `${req.user.id}@${domain}`;
        if (!world.canModify(userRef) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'delete asset');

        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.worlds.findAssetById(aid);
        if (!asset || asset.worldId !== world.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);

        await this.worlds.deleteAsset(aid);
        return { success: true };
    }
}
