import {
    Controller, Get, Put, Post, Patch, Delete, Param, Req, Res, Query, Body,
    UseGuards, HttpCode, HttpStatus, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { randomBytes } from 'node:crypto';
import { extname } from 'path';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiWrappedSuccessResponse, ApiErrorResponse, ApiOptionalBearerAuth } from '../api/swagger';
import { ApiInstanceDto } from './dto/instance-response.dto';
import { InstancesService } from './instances.service';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';
import { AuthUserGuard, UserAuthenticatedRequest, OptionalAuthUserGuard } from '../auth/auth.guard';
import type { OptionalUserAuthenticatedRequest } from '../auth/auth.guard';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { NoxIdentifier } from '../common/identifier';
import { ExternalServersService } from '../external/external-servers.service';

const multerTempOpts = {
    storage: diskStorage({
        destination: tmpdir(),
        filename: (_req: any, file: any, cb: any) => {
            const uid = randomBytes(6).toString('hex');
            cb(null, `${Date.now()}-${uid}${extname(file.originalname)}`);
        },
    }),
};

@ApiTags('Instances')
@Controller('instances')
export class InstancesController {
    constructor(
        private readonly instances: InstancesService,
        private readonly externalServers: ExternalServersService,
    ) { }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    private parsePaging(rawLimit?: string, rawOffset?: string, def = 10) {
        let limit = parseInt(rawLimit ?? String(def), 10);
        let offset = parseInt(rawOffset ?? '0', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = def;
        if (limit > 100) limit = 100;
        if (!Number.isFinite(offset) || offset < 0) offset = 0;
        return { limit, offset };
    }

    // ── Search ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Search instances', description: 'Paginated search for running instances, optionally filtered by world or owner.' })
    @ApiWrappedArrayResponse(ApiInstanceDto)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get()

    async search(
        @Req() req: Request & OptionalUserAuthenticatedRequest,
        @Query('server') s?: string,
        @Query('q') query?: string,
        @Query('world') world?: string,
        @Query('owner') owner?: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        if (s) {
            if (!req.user)
                throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
            if (!req.user.isAdmin() && !req.user.tags.includes('sys:can_external_fetch'))
                throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
            const server = await this.externalServers.findOrDiscover(s);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${s})`);
            const params = new URLSearchParams();
            if (query) params.set('q', query);
            if (world) params.set('world', world);
            if (owner) params.set('owner', owner);
            if (rawLimit) params.set('limit', rawLimit);
            if (rawOffset) params.set('offset', rawOffset);
            const qs = params.toString();
            const resp = await server.fetch<any>(`/instances${qs ? '?' + qs : ''}`, { user: req.user });
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.EXTERNAL_SERVER_ERROR, null, `Server (${s})`);
            return resp.data;
        }

        const { limit, offset } = this.parsePaging(rawLimit, rawOffset);
        
        // Normalize world identifier (convert local domain to ::)
        let normalizedWorld: string | undefined;
        if (world) {
            const domain = await this.instances.domain();
            let worldIdentifier = NoxIdentifier.type(null, NoxIdentifier.parse(world));
            if (worldIdentifier.isLocal(domain)) 
                worldIdentifier = new NoxIdentifier(null, worldIdentifier.id, undefined, worldIdentifier.query);
            normalizedWorld = worldIdentifier.toString();
        }
        
        // Normalize owner identifier (convert local domain to ::)
        let normalizedOwner: string | undefined;
        if (owner) {
            const domain = await this.instances.domain();
            let ownerIdentifier = NoxIdentifier.type(null, NoxIdentifier.parse(owner));
            if (ownerIdentifier.isLocal(domain)) 
                ownerIdentifier = new NoxIdentifier(null, ownerIdentifier.id, undefined, ownerIdentifier.query);
            normalizedOwner = ownerIdentifier.toString();
        }
        
        const { items, total } = await this.instances.search({ 
            query, 
            world: normalizedWorld, 
            owner: normalizedOwner 
        }, limit, offset);

        const serialized = await Promise.all(items.map(i => this.instances.serialize(i)));
        return { items: serialized, total, limit, offset };
    }

    // ── Get single ────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get instance', description: 'Return a single instance by numeric ID or slug name.' })
    @ApiWrappedResponse(ApiInstanceDto)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id')
    async getOne(@Param('id') idOrName: string) {
        let instance = idOrName.startsWith('#')
            ? await this.instances.findByName(idOrName.slice(1))
            : /^\d+$/.test(idOrName)
                ? await this.instances.findById(parseInt(idOrName, 10))
                : await this.instances.findByName(idOrName);

        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${idOrName})`);
        return this.instances.serialize(instance);
    }

    // ── Create ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Create instance', description: 'Create a new instance for the given world (authenticated).' })
    @ApiWrappedResponse(ApiInstanceDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Put()
    async create(@Req() req: Request & UserAuthenticatedRequest, @Body() body: CreateInstanceDto) {
        if (!this.instances.canCreate(req.user))
            throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'create instance');

        const instance = await this.instances.create({
            name:          body.name,
            title:         body.title          ?? null,
            description:   body.description    ?? null,
            capacity:      body.capacity,
            worldRef:      NoxIdentifier.type(null, NoxIdentifier.parse(body.world)).toString(),
            ownerRef:      req.user.identifier().toString(),
            tags:          body.tags           ?? [],
            thumbnail:     body.thumbnail      ?? null,
            useWhitelist:  body.use_whitelist  ?? false,
            whitelistRefs: (body.whitelist_refs ?? []).map(ref => NoxIdentifier.type(null, NoxIdentifier.parse(ref)).toString()),
            usePassword:   body.use_password   ?? false,
            password:      body.password       ?? null,
        });

        return this.instances.serialize(instance);
    }

    // ── Update ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Update instance', description: 'Update instance metadata (owner or admin only).' })
    @ApiWrappedResponse(ApiInstanceDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Patch(':id')
    async update(@Req() req: Request & UserAuthenticatedRequest, @Param('id') rawId: string, @Body() body: UpdateInstanceDto) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid instance ID');

        const instance = await this.instances.findById(id);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${id})`);

        if (!this.instances.canManage(req.user, instance))
            throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'edit instance');

        const updated = await this.instances.update(id, {
            ...(body.title          !== undefined && { title:         body.title }),
            ...(body.description    !== undefined && { description:   body.description }),
            ...(body.capacity       !== undefined && { capacity:      body.capacity }),
            ...(body.tags           !== undefined && { tags:          body.tags }),
            ...(body.thumbnail      !== undefined && { thumbnail:     body.thumbnail }),
            ...(body.use_whitelist  !== undefined && { useWhitelist:  body.use_whitelist }),
            ...(body.whitelist_refs !== undefined && { whitelistRefs: body.whitelist_refs.map(ref => NoxIdentifier.type(null, NoxIdentifier.parse(ref)).toString()) }),
            ...(body.use_password   !== undefined && { usePassword:   body.use_password }),
            ...(body.password       !== undefined && { password:      body.password }),
        });

        return this.instances.serialize(updated);
    }

    // ── Thumbnail ─────────────────────────────────────────────────────────────────

    /** GET /api/instances/:id/thumbnail */
    @ApiOperation({ summary: 'Get instance thumbnail', description: 'Redirect to the instance thumbnail URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get(':id/thumbnail')
    async getThumbnail(@Param('id') rawId: string, @Res() res: Response) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid instance ID');
        const instance = await this.instances.findById(id);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${id})`);
        if (!instance.thumbnail) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        const file = await this.instances.storage.get(instance.thumbnail);
        return res.redirect(302, file.url.toString());
    }

    /** POST /api/instances/:id/thumbnail */
    @ApiOperation({ summary: 'Upload instance thumbnail', description: 'Upload an image (multipart/form-data, field: file) as the instance thumbnail.' })
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
        @Param('id') rawId: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Res() res: Response,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid instance ID');
        const instance = await this.instances.findById(id);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${id})`);
        if (!this.instances.canManage(req.user, instance))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'modify instance');
        if (!this.instances.canUploadFile(req.user))
            throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'upload file');
        if (!file) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file');
        if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'file must be an image (png, jpeg, gif, webp)');
        const f = file as Express.Multer.File & { path?: string };
        const stored = await this.instances.storage.store({ source: f.path!, mimetype: f.mimetype });
        const oldThumb = instance.thumbnail;
        const updated = await this.instances.update(id, { thumbnail: stored.key });
        if (oldThumb && oldThumb !== stored.key)
            await this.instances.storage.delete(oldThumb);
        const storedFile = await this.instances.storage.get(updated.thumbnail!);
        return res.redirect(302, storedFile.url.toString());
    }

    // ── Delete ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Delete instance', description: 'Delete an instance (owner or admin only).' })
    @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Instance deleted successfully.' })
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    async remove(@Req() req: Request & UserAuthenticatedRequest, @Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid instance ID');

        const instance = await this.instances.findById(id);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${id})`);

        if (!this.instances.canManage(req.user, instance))
            throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'delete instance');

        await this.instances.delete(id);
    }
}
