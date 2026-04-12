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
import { ApiAvatarDto, ApiAvatarAssetDto } from './dto/avatar-response.dto';
import { ApiAssetJobStatusDto } from '../storage/dto/storage-response.dto';
import { AvatarsService } from './avatars.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { AuthUserGuard, UserAuthenticatedRequest, OptionalAuthUserGuard, OptionalUserAuthenticatedRequest } from '../auth/auth.guard';
import { CreateAvatarDto } from './dto/create-avatar.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { CreateAvatarAssetDto } from './dto/create-avatar-asset.dto';
import { userInfo } from 'node:os';

const multerTempOpts = {
    storage: diskStorage({
        destination: tmpdir(),
        filename: (_req: any, file: any, cb: any) => {
            const uid = randomBytes(6).toString('hex');
            cb(null, `${Date.now()}-${uid}${extname(file.originalname)}`);
        },
    }),
};

@ApiTags('Avatars')
@Controller('avatars')
export class AvatarsController {
    constructor(private readonly avatars: AvatarsService) { }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private parsePaging(rawLimit?: string, rawOffset?: string, defaultLimit = 10) {
        let limit = parseInt(rawLimit ?? String(defaultLimit), 10);
        let offset = parseInt(rawOffset ?? '0', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
        if (limit > 100) limit = 100;
        if (!Number.isFinite(offset) || offset < 0) offset = 0;
        return { limit, offset };
    }

    private async resolveLocalAvatar(id: string) {
        const identifier = NoxIdentifier.parse(id);
        if (!identifier.isLocal(await this.avatars.address()))
            throw new ApiException(ApiErrorCode.NOT_IMPLEMENTED, null, `Fetch remote avatar (${identifier.toString()})`);
        const numericId = identifier.numericId;
        if (numericId === null)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Avatar ID must be numeric');
        const avatar = await this.avatars.findById(numericId);
        if (!avatar) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Avatar (${id})`);
        return avatar;
    }

    private async resolveAvatarOrRemote(id: string) {
        const identifier = NoxIdentifier.parse(id);
        if (identifier.isLocal(await this.avatars.address())) {
            const numericId = identifier.numericId;
            if (numericId === null)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Avatar ID must be numeric');
            const avatar = await this.avatars.findById(numericId);
            if (!avatar) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Avatar (${id})`);
            return { avatar, identifier, remote: false as const };
        }
        return { avatar: null, identifier, remote: true as const };
    }

    private requireExternalFetch(req: Request & OptionalUserAuthenticatedRequest) {
        if (!req.user)
            throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
        if (!this.avatars.canExternalFetch(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
    }

    // ── Search ───────────────────────────────────────────────────────────────────

    /** GET /api/avatars */
    @ApiOperation({ summary: 'Search avatars', description: 'Paginated full-text search for avatars, or fetch by IDs.' })
    @ApiWrappedArrayResponse(ApiAvatarDto)
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
            const domain = await this.avatars.address();
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
        const result = await this.avatars.searchAvatars(opts, limit, offset);
        return {
            total: result.total,
            limit,
            offset,
            items: await Promise.all(result.avatars.map(a => a.sanitize())),
        };
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    /** PUT /api/avatars */
    @ApiOperation({ summary: 'Create avatar', description: 'Create a new avatar owned by the authenticated user.' })
    @ApiWrappedResponse(ApiAvatarDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Put()
    async create(@Req() req: Request & UserAuthenticatedRequest, @Body() body: CreateAvatarDto) {
        if (!this.avatars.canCreateAvatar(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'create avatar');
        const avatar = await this.avatars.createAvatar(body, req.user);
        return avatar.sanitize();
    }

    // ── Single avatar ─────────────────────────────────────────────────────────────

    /** GET /api/avatars/:id */
    @ApiOperation({ summary: 'Get avatar', description: 'Return a single avatar by NoxIdentifier. Fetches from remote server if the ID is not local.' })
    @ApiWrappedResponse(ApiAvatarDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id')
    async getAvatar(@Param('id') id: string, @Req() req: Request & OptionalUserAuthenticatedRequest) {
        const { avatar, identifier, remote } = await this.resolveAvatarOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.avatars.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const resp = await server.fetch<any>(`/api/avatars/${identifier.toString()}`);
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Avatar (${id})`);
            return resp.data;
        }
        return avatar!.sanitize();
    }

    /** POST /api/avatars/:id */
    @ApiOperation({ summary: 'Update avatar', description: 'Update avatar metadata (owner or admin only).' })
    @ApiWrappedResponse(ApiAvatarDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Post(':id')
    async updateAvatar(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Body() body: UpdateAvatarDto,
    ) {
        const avatar = await this.resolveLocalAvatar(id);
        const domain = await this.avatars.address();
        if (!avatar.isOwner(await req.user.identifier()) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'modify avatar');

        const updated = await this.avatars.updateAvatar(avatar.id, body);
        return updated.sanitize();
    }

    /** DELETE /api/avatars/:id — owner only */
    @ApiOperation({ summary: 'Delete avatar', description: 'Permanently delete an avatar and all its assets (owner or admin only).' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Delete(':id')
    async deleteAvatar(@Param('id') id: string, @Req() req: Request & UserAuthenticatedRequest) {
        const avatar = await this.resolveLocalAvatar(id);
        if (!avatar.isOwner(await req.user.identifier()) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'delete avatar');

        await this.avatars.deleteAvatar(avatar.id);
        return { success: true };
    }

    // ── Thumbnail ─────────────────────────────────────────────────────────────────

    /** GET /api/avatars/:id/thumbnail */
    @ApiOperation({ summary: 'Get avatar thumbnail', description: 'Redirect to the avatar thumbnail URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/thumbnail')
    async getThumbnail(@Param('id') id: string, @Req() req: Request & OptionalUserAuthenticatedRequest, @Res() res: Response) {
        const { avatar, identifier, remote } = await this.resolveAvatarOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.avatars.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const wk = await server.wellKnown();
            return res.redirect(302, new URL(`/api/avatars/${identifier.toString()}/thumbnail`, wk.data.gateway.api).toString());
        }
        if (!avatar!.thumbnail)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        const file = await this.avatars.storage.get(avatar!.thumbnail);
        return res.redirect(302, file.url.toString());
    }

    /** POST /api/avatars/:id/thumbnail */
    @ApiOperation({ summary: 'Upload avatar thumbnail', description: 'Upload an image (multipart/form-data, field: file) as the avatar thumbnail.' })
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
        const avatar = await this.resolveLocalAvatar(id);

        if (!avatar.isOwner(await req.user.identifier()) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'modify avatar');
        if (!this.avatars.canUploadFile(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload file');

        if (!file) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file');
        if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file must be an image (png, jpeg, gif, webp)');

        const updated = await this.avatars.updateAvatar(avatar.id, {} as UpdateAvatarDto, file);
        const thumb = updated.thumbnail;
        if (!thumb) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        const stored = await this.avatars.storage.get(thumb);
        return res.redirect(302, stored.url.toString());
    }

    // ── Assets ────────────────────────────────────────────────────────────────────

    /**
     * GET /api/avatars/:id/assets
     * Query: version (repeated), engine (repeated), platform (repeated), empty, limit, offset
     */
    @ApiOperation({ summary: 'List avatar assets', description: 'Paginated list of assets for an avatar, filterable by version/engine/platform.' })
    @ApiWrappedArrayResponse(ApiAvatarAssetDto)
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
        const { avatar, identifier, remote } = await this.resolveAvatarOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.avatars.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const params = new URLSearchParams();
            if (version) (Array.isArray(version) ? version : [version]).forEach(v => params.append('version', v));
            if (engine) (Array.isArray(engine) ? engine : [engine]).forEach(v => params.append('engine', v));
            if (platform) (Array.isArray(platform) ? platform : [platform]).forEach(v => params.append('platform', v));
            if (showEmpty !== undefined) params.set('empty', showEmpty);
            if (rawLimit) params.set('limit', rawLimit);
            if (rawOffset) params.set('offset', rawOffset);
            const qs = params.toString();
            const resp = await server.fetch<any>(`/api/avatars/${identifier.toString()}/assets${qs ? '?' + qs : ''}`);
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Avatar (${id})`);
            return resp.data;
        }
        const { limit, offset } = this.parsePaging(rawLimit, rawOffset, 50);

        const parseInts = (v?: string | string[]) =>
            v ? (Array.isArray(v) ? v : [v]).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n)) : undefined;
        const parseStrings = (v?: string | string[]) =>
            v ? (Array.isArray(v) ? v : [v]) : undefined;

        const result = await this.avatars.findAssetsByAvatarId(avatar!.id, {
            versions: parseInts(version),
            engines: parseStrings(engine),
            platforms: parseStrings(platform),
            showEmpty: showEmpty !== undefined && showEmpty !== 'false',
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

    /** PUT /api/avatars/:id/assets — create an asset slot */
    @ApiOperation({ summary: 'Create avatar asset', description: 'Register a new asset slot for an avatar. Optionally provide an external URL; otherwise upload a file to the returned slot.' })
    @ApiWrappedResponse(ApiAvatarAssetDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Put(':id/assets')
    async createAsset(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Body() body: CreateAvatarAssetDto,
    ) {
        const avatar = await this.resolveLocalAvatar(id);

        if (!avatar.isOwner(await req.user.identifier()) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'create asset');

        const asset = await this.avatars.createAsset(avatar.id, body);
        return asset.sanitize();
    }

    /** POST /api/avatars/:id/assets/:asset_id/file — enqueue asset file for async processing */
    @ApiOperation({ summary: 'Upload avatar asset file', description: 'Upload a file (multipart/form-data, field: file) for async processing. Returns 202 Accepted with queue position.' })
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
        const avatar = await this.resolveLocalAvatar(id);
        const domain = await this.avatars.address();
        if (!avatar.isOwner(await req.user.identifier()) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload asset');
        if (!this.avatars.canUploadFile(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload file');

        if (!file) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file');

        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.avatars.findAssetById(aid);
        if (!asset || asset.avatarId !== avatar.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);

        const expectedHash = (req as any).headers?.['x-file-hash'] as string | undefined;
        const job = await this.avatars.enqueueAssetFile(aid, file, req.user, expectedHash);

        return {
            status: job.status,
            progress: job.progress,
            message: job.message,
            queue_position: this.avatars.queue.queuePosition(aid),
        };
    }

    /** GET /api/avatars/:id/assets/:asset_id/status — poll processing status */
    @ApiOperation({ summary: 'Get asset processing status', description: 'Poll the processing status of an uploaded asset file.' })
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
        const { avatar, identifier, remote } = await this.resolveAvatarOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.avatars.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const resp = await server.fetch<any>(`/api/avatars/${identifier.toString()}/assets/${assetId}/status`);
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);
            return resp.data;
        }
        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.avatars.findAssetById(aid);
        if (!asset || asset.avatarId !== avatar!.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);

        const job = this.avatars.getJobStatus(aid);

        if (!job) {
            if (asset.isEmpty()) return { status: 'empty' };
            return { status: 'completed', hash: asset.hash, size: asset.size };
        }

        switch (job.status) {
            case 'pending':
                return {
                    status: 'pending',
                    progress: job.progress,
                    message: job.message,
                    queue_position: this.avatars.queue.queuePosition(aid),
                };
            case 'processing':
                return { status: 'processing', progress: job.progress, message: job.message };
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

    /** GET /api/avatars/:id/assets/:asset_id/file — redirect to asset file */
    @ApiOperation({ summary: 'Get avatar asset file', description: 'Redirect to the download URL of the asset file.' })
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
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
        const { avatar, identifier, remote } = await this.resolveAvatarOrRemote(id);
        if (remote) {
            this.requireExternalFetch(req);
            const server = await this.avatars.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const wk = await server.wellKnown();
            return res.redirect(302, new URL(`/api/avatars/${identifier.toString()}/assets/${assetId}/file`, wk.data.gateway.api).toString());
        }
        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.avatars.findAssetById(aid);
        if (!asset || asset.avatarId !== avatar!.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);
        if (asset.isEmpty())
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Asset file');

        const file = await this.avatars.storage.get(asset.url!);
        return res.redirect(302, file.url.toString());
    }

    /** DELETE /api/avatars/:id/assets/:asset_id */
    @ApiOperation({ summary: 'Delete avatar asset', description: 'Permanently delete an asset slot and its associated file (owner or admin only).' })
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
        const avatar = await this.resolveLocalAvatar(id);

        if (!avatar.isOwner(await req.user.identifier()) && !req.user.isAdmin())
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'delete asset');

        const aid = parseInt(assetId, 10);
        if (!Number.isFinite(aid))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'asset_id must be numeric');

        const asset = await this.avatars.findAssetById(aid);
        if (!asset || asset.avatarId !== avatar.id)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Asset (${assetId})`);

        await this.avatars.deleteAsset(aid);
        return { success: true };
    }
}
