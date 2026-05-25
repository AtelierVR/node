import { Controller, Get, HttpStatus, Param, Req, UseGuards, Query, Post, Delete, Body, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import type { Request, Express, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiWrappedSuccessResponse, ApiErrorResponse, ApiOptionalBearerAuth, ApiOptionalChallenge } from '../api/swagger';
import { ApiCurrentUserDto, ApiUserDto, ApiRelationDto } from './dto/user-response.dto';
import { UserSearchResponseDto } from './dto/user-search-response.dto';
import { UsersService } from './users.service';
import { UserWithMethods } from './user.model';
import { StorageService } from '../storage/storage.service';
import { RelationsService } from '../relations/relations.service';
import { ExternalServersService } from '../external/external-servers.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { randomBytes } from 'node:crypto';
import { extname } from 'path';
import { NoxIdentifier } from '../common/identifier';
import { ApiErrorCode } from '../api/api-error.factory';
import { ApiException } from 'src/api/api-exception';
import { ApiUser } from './users.types';
import { UserAuthenticatedRequest, AuthUserGuard, OptionalAuthUserGuard, OptionalUserAuthenticatedRequest } from '../auth/auth.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { OptionalServerAsUserAuthenticatedRequest, OptionalServerAsUserGuard } from 'src/auth/server-as-user.guard';

@ApiTags('Users')
@Controller('users')
export class UsersController {
    constructor(
        private readonly users: UsersService,
        private readonly storage: StorageService,
        private readonly relations: RelationsService,
        private readonly externalServers: ExternalServersService,
    ) { }

    /**
     * GET /api/users/@me
     * 
     * Returns the current authenticated user, based on the session cookie or bearer token.
     * Requires authentication.
     * 
     * @param req Request, with user and session added by AuthUserGuard
     * @returns Current user data, sanitized
     */
    @ApiOperation({ summary: 'Get current user', description: 'Return the authenticated user profile.' })
    @ApiWrappedResponse(ApiCurrentUserDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Get('@me')
    async getCurrent(@Req() req: Request & UserAuthenticatedRequest) {
        return await req.user.sanitizeCurrent();
    }

    @ApiOperation({ summary: 'Update current user', description: 'Update profile fields for the authenticated user.' })
    @ApiWrappedResponse(ApiCurrentUserDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.CONFLICT, 'Username or email already taken.')
    @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Post('@me')
    async updateCurrent(@Req() req: Request & UserAuthenticatedRequest, @Body() body: UpdateUserDto) {
        const updated = await this.users.updateUser(req.user.id, body);
        return await updated.sanitizeCurrent();
    }

    @ApiOperation({ summary: 'Upload profile thumbnail', description: 'Upload an image (multipart/form-data, field: file) as the current user thumbnail.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the uploaded thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: tmpdir(),
            filename: (_req, file, cb) => {
                const uid = randomBytes(6).toString('hex');
                const name = `${Date.now()}-${uid}${extname(file.originalname)}`;
                cb(null, name);
            },
        }),
    }))
    @Post('@me/thumbnail')
    async uploadThumbnail(@Req() req: Request & UserAuthenticatedRequest, @UploadedFile() file: Express.Multer.File | undefined, @Res() res: Response) {
        const fn = file ? { thumbnail: [file] } : undefined;
        const updated = await this.users.updateUser(req.user.id, {} as UpdateUserDto, fn);
        const thumb = updated.thumbnail;
        if (!thumb) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        const fileInfo = await this.storage.get(thumb);
        return res.redirect(302, fileInfo.url.toString());
    }

    @ApiOperation({ summary: 'Upload profile banner', description: 'Upload an image (multipart/form-data, field: file) as the current user banner.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the uploaded banner URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: tmpdir(),
            filename: (_req, file, cb) => {
                const uid = randomBytes(6).toString('hex');
                const name = `${Date.now()}-${uid}${extname(file.originalname)}`;
                cb(null, name);
            },
        }),
    }))
    @Post('@me/banner')
    async uploadBanner(@Req() req: Request & UserAuthenticatedRequest, @UploadedFile() file: Express.Multer.File | undefined, @Res() res: Response) {
        const fn = file ? { banner: [file] } : undefined;
        const updated = await this.users.updateUser(req.user.id, {} as UpdateUserDto, fn);
        const banner = updated.banner;
        if (!banner) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Banner');
        const fileInfo = await this.storage.get(banner);
        return res.redirect(302, fileInfo.url.toString());
    }

    /**
     * GET /api/users/@admin
     * 
     * Returns the main admin user (id defined in config, default 1). 
     * This is used by the frontend to display the instance owner in the about page.
     * 
     * @returns Admin user data, sanitized
     */
    @ApiOperation({ summary: 'Get admin user', description: 'Return the main admin user profile (instance owner).' })
    @ApiWrappedResponse(ApiUserDto)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get('@admin')
    async getAdmin() {
        const admin = await this.users.findById(await this.users.mainAdminId());
        if (!admin) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Admin user');
        return await admin.sanitize();
    }

    /**
     * GET /api/users
     *
     * Query params:
     *  - query: free-text search
     *  - limit: page size (default 10, max 100)
     *  - offset: page offset (default 0)
     *  - id: single id or repeated param for id list (numeric or username)
     */
    @ApiOperation({ summary: 'Search users', description: 'Paginated full-text search for users, or fetch by IDs.' })
    @ApiWrappedResponse(UserSearchResponseDto)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get()
    async search(
        @Req() req: Request & OptionalUserAuthenticatedRequest,
        @Query('server') s?: string,
        @Query('query') query?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
        @Query('id') id?: string | string[],
    ) {
        if (s) {
            if (!req.user)
                throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
            if (!req.user.isAdmin() && !req.user.tags.includes('sys:can_external_fetch'))
                throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
            const server = await this.externalServers.findOrDiscover(s);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${s})`);
            const params = new URLSearchParams();
            if (query) params.set('query', query);
            if (limit) params.set('limit', limit);
            if (offset) params.set('offset', offset);
            if (id) (Array.isArray(id) ? id : [id]).forEach(v => params.append('id', v));
            const qs = params.toString();
            const resp = await server.fetch<any>(`/users${qs ? '?' + qs : ''}`, { user: req.user });
            if (resp.error || !resp.data) throw new ApiException(ApiErrorCode.EXTERNAL_SERVER_ERROR, null, `Server (${s})`);
            return resp.data;
        }

        // validate and normalize paging
        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '10';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';
        let ilimit = parseInt(limit, 10);
        let ioffset = parseInt(offset, 10);
        if (ilimit > 100) ilimit = 100;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        // normalize ids
        const idsParam: string[] | undefined = id ? (Array.isArray(id) ? id : [id]) : undefined;
        let ids: Array<number | string> | undefined = undefined;
        if (idsParam && idsParam.length > 0) {
            ids = [];
            for (const raw of idsParam)
                try {
                    const nid = NoxIdentifier.parse(raw);
                    if (!nid.isLocal(await this.users.domain())) continue;
                    if (nid.numericId !== null) ids.push(nid.numericId);
                    else ids.push(nid.id);
                } catch {
                    // ignore malformed identifiers
                }
        }

        const opts = ids && ids.length > 0 ? { ids } : { query: query ?? undefined };
        const results = await this.users.searchUsers(opts, ilimit, ioffset);

        return {
            total: results.total,
            query: query ?? null,
            ids: idsParam || [],
            limit: ilimit,
            offset: ioffset,
            items: await Promise.all(results.users.map((u) => u.sanitize())),
        };
    }

    /** Serve current user's thumbnail (authenticated) */
    @ApiOperation({ summary: 'Get own thumbnail', description: 'Redirect to the current user thumbnail URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Get('@me/thumbnail')
    async serveMyThumbnail(@Req() req: Request & UserAuthenticatedRequest, @Res() res: Response) {
        const thumb = req.user.thumbnail;
        if (!thumb) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        let file = await this.storage.get(thumb);
        return res.redirect(302, file.url.toString());
    }

    /** Serve admin user's thumbnail (public) */
    @ApiOperation({ summary: 'Get admin thumbnail', description: 'Redirect to the admin user thumbnail URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get('@admin/thumbnail')
    async serveAdminThumbnail(@Res() res: Response) {
        const admin = await this.users.findById(await this.users.mainAdminId());
        if (!admin) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Admin user');

        const thumb = admin.thumbnail;
        if (!thumb) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        let file = await this.storage.get(thumb);
        return res.redirect(302, file.url.toString());
    }

    /** Serve a user's thumbnail file (local files) or redirect to external URL */
    @ApiOperation({ summary: 'Get user thumbnail', description: 'Redirect to a user thumbnail URL. Fetches from remote server if the ID is not local.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the thumbnail URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/thumbnail')
    async serveThumbnail(@Param('id') id: string, @Req() req: Request & OptionalUserAuthenticatedRequest, @Res() res: Response) {
        const identifier = NoxIdentifier.parse(id);
        if (!identifier.isLocal(await this.users.domain())) {
            if (!req.user) throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
            if (!req.user.isAdmin() && !req.user.tags.includes('sys:can_external_fetch'))
                throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
            const server = await this.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const wk = await server.wellKnown();
            return res.redirect(302, new URL(`/api/users/${identifier.toString()}/thumbnail`, wk.data.gateway.api).toString());
        }

        const user = await this.users.findByIdentifier(identifier);
        if (!user) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `User (${identifier.toString()})`);

        const thumb = user.thumbnail;
        if (!thumb) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Thumbnail');
        let file = await this.storage.get(thumb);
        return res.redirect(302, file.url.toString());
    }

    @ApiOperation({ summary: 'Get own banner', description: 'Redirect to the current user banner URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the banner URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Get('@me/banner')
    async serveMyBanner(@Req() req: Request & UserAuthenticatedRequest, @Res() res: Response) {
        const banner = req.user.banner;
        if (!banner) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Banner');
        let file = await this.storage.get(banner);
        return res.redirect(302, file.url.toString());
    }

    @ApiOperation({ summary: 'Get admin banner', description: 'Redirect to the admin user banner URL.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the banner URL.' })
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get('@admin/banner')
    async serveAdminBanner(@Res() res: Response) {
        const admin = await this.users.findById(await this.users.mainAdminId());
        if (!admin) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Admin user');

        const banner = admin.banner;
        if (!banner) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Banner');
        let file = await this.storage.get(banner);
        return res.redirect(302, file.url.toString());
    }

    /** Serve a user's banner file (local files) or redirect to external URL */
    @ApiOperation({ summary: 'Get user banner', description: 'Redirect to a user banner URL. Fetches from remote server if the ID is not local.' })
    @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the banner URL.' })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @UseGuards(OptionalAuthUserGuard)
    @Get(':id/banner')
    async serveBanner(@Param('id') id: string, @Req() req: Request & OptionalUserAuthenticatedRequest, @Res() res: Response) {
        const identifier = NoxIdentifier.parse(id);
        if (!identifier.isLocal(await this.users.domain())) {
            if (!req.user) throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
            if (!req.user.isAdmin() && !req.user.tags.includes('sys:can_external_fetch'))
                throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
            const server = await this.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const wk = await server.wellKnown();
            return res.redirect(302, new URL(`/api/users/${identifier.toString()}/banner`, wk.data.gateway.api).toString());
        }

        const user = await this.users.findByIdentifier(identifier);
        if (!user) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `User (${identifier.toString()})`);

        const banner = user.banner;
        if (!banner) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Banner');
        let file = await this.storage.get(banner);
        return res.redirect(302, file.url.toString());
    }

    // ── Relations ─────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get my following', description: 'Return the list of users the current user follows.' })
    @ApiWrappedArrayResponse(ApiRelationDto)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Get('@me/following')
    async getMyFollowing(
        @Req() req: Request & UserAuthenticatedRequest,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const limit = Math.min(Math.max(parseInt(rawLimit ?? '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);
        const relations = await this.relations.getFollowing(req.user, limit, offset);
        return {
            total: await this.relations.getFollowingCount(req.user),
            items: await Promise.all(relations.map(r => r.sanitize()))
        };
    }

    @ApiOperation({ summary: 'Get my followers', description: 'Return the list of users who follow the current user.' })
    @ApiWrappedArrayResponse(ApiRelationDto)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Get('@me/followers')
    async getMyFollowers(
        @Req() req: Request & UserAuthenticatedRequest,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const limit = Math.min(Math.max(parseInt(rawLimit ?? '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);

        const [relations, total] = await Promise.all([
            this.relations.getFollowers(req.user, limit, offset),
            this.relations.getFollowersCount(req.user),
        ]);

        return {
            total,
            items: await Promise.all(relations.map(r => r.sanitize()))
        };
    }

    @ApiOperation({ summary: 'Get my friends', description: 'Return a paginated list of mutual follows (friends) for the current user.' })
    @ApiWrappedResponse(UserSearchResponseDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Get('@me/friends')
    async getMyFriends(
        @Req() req: Request & UserAuthenticatedRequest,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const limit = Math.min(Math.max(parseInt(rawLimit ?? '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);

        const { total, refs } = await this.relations.getFriends(req.user, limit, offset);

        const domain = await this.users.domain();
        const localRefs: NoxIdentifier[] = [];
        const externalGroups = new Map<string, NoxIdentifier[]>();

        for (const ref of refs) {
            const id = NoxIdentifier.parse(ref);
            if (id.isLocal(domain)) {
                localRefs.push(id);
            } else {
                const server = id.server!;
                if (!externalGroups.has(server))
                    externalGroups.set(server, []);
                externalGroups.get(server)!.push(id);
            }
        }

        // Resolve local users
        const localUsers = (await Promise.allSettled(localRefs.map(id => this.users.findByIdentifier(id))))
            .filter((r): r is PromiseFulfilledResult<UserWithMethods | null> => r.status === 'fulfilled')
            .map(r => r.value)
            .filter((u): u is UserWithMethods => u !== null);

        const localItems = await Promise.all(localUsers.map(u => u.sanitize(req.user.identifier())));

        // Batch-fetch external users grouped by server
        const externalItems: ApiUser[] = (await Promise.allSettled(
            Array.from(externalGroups.entries()).map(async ([serverAddr, ids]) => {
                const server = await this.externalServers.findOrDiscover(serverAddr);
                if (!server) return [] as ApiUser[];
                const qs = ids.map(id => `id=${encodeURIComponent(id.id)}`).join('&');
                const resp = await server.fetch<{ items: ApiUser[] }>(`/users?${qs}`, { user: req.user });
                if (resp.error || !resp.data) return [] as ApiUser[];
                // Annotate with known mutual relation
                return resp.data.items.map((u): ApiUser => ({
                    ...u,
                    relations: { out: 'follow', in: 'follow' },
                }));
            }),
        ))
            .filter((r): r is PromiseFulfilledResult<ApiUser[]> => r.status === 'fulfilled')
            .flatMap(r => r.value);

        // Build ref → original order map: key is "id@server" (empty server = local)
        const refOrder = new Map<string, number>();
        for (let i = 0; i < refs.length; i++) {
            const parsed = NoxIdentifier.parse(refs[i]);
            const serverKey = parsed.isLocal(domain) ? '' : (parsed.server ?? '');
            refOrder.set(`${parsed.id}@${serverKey}`, i);
        }
        const itemSortKey = (item: ApiUser) => `${item.id}@${item.server === domain ? '' : item.server}`;

        const combined = [...localItems, ...externalItems]
            .sort((a, b) => (refOrder.get(itemSortKey(a)) ?? Infinity) - (refOrder.get(itemSortKey(b)) ?? Infinity));

        return {
            total,
            limit,
            offset,
            items: combined,
        };
    }

    @ApiOperation({ summary: 'Get user following', description: "Return the list of users that a given user follows (hidden if user set hide_following)." })
    @ApiWrappedArrayResponse(ApiRelationDto)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get(':id/following')
    async getFollowing(
        @Param('id') id: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const identifier = NoxIdentifier.parse(id);
        const user = await this.users.findByIdentifier(identifier);
        if (!user)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `User (${identifier.toString()})`);

        if (user.isHideFollowing())
            return { total: 0, items: [] };

        const limit = Math.min(Math.max(parseInt(rawLimit ?? '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);

        const [relations, total] = await Promise.all([
            this.relations.getFollowing(user, limit, offset),
            this.relations.getFollowingCount(user),
        ]);

        return {
            total,
            items: await Promise.all(relations.map(r => r.sanitize()))
        };
    }

    @ApiOperation({ summary: 'Get user followers', description: "Return the list of users who follow a given user (hidden if user set hide_followers)." })
    @ApiWrappedArrayResponse(ApiRelationDto)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get(':id/followers')
    async getFollowers(
        @Param('id') id: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const identifier = NoxIdentifier.parse(id);
        const user = await this.users.findByIdentifier(identifier);
        if (!user)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `User (${identifier.toString()})`);

        if (user.isHideFollowers())
            return { total: 0, items: [] };

        const limit = Math.min(Math.max(parseInt(rawLimit ?? '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);

        const [relations, total] = await Promise.all([
            this.relations.getFollowers(user, limit, offset),
            this.relations.getFollowersCount(user),
        ]);

        return {
            total,
            items: await Promise.all(relations.map(r => r.sanitize()))
        };
    }

    @ApiOperation({ summary: 'Follow user', description: 'Follow a user or send a follow request if the user requires approval.' })
    @ApiWrappedResponse(ApiRelationDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Post(':id/follow')
    async follow(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
    ) {
        const target = NoxIdentifier.parse(id);
        const rel = await this.relations.follow(req.user, target);
        return await rel.sanitize();
    }

    @ApiOperation({ summary: 'Unfollow user', description: 'Remove an existing follow or follow request.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Post(':id/unfollow')
    async unfollow(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
    ) {
        const target = NoxIdentifier.parse(id);
        await this.relations.unfollow(req.user, target);
        return { success: true };
    }

    @ApiOperation({ summary: 'Unfollow user (DELETE)', description: 'Remove an existing follow or follow request (REST alias for POST :id/unfollow).' })
    @ApiWrappedSuccessResponse(HttpStatus.OK)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Delete(':id/follow')
    async unfollowDelete(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
    ) {
        const target = NoxIdentifier.parse(id);
        await this.relations.unfollow(req.user, target);
        return { success: true };
    }

    @ApiOperation({ summary: 'Respond to follow request', description: 'Accept or reject a pending follow request from another user.' })
    @ApiWrappedResponse(ApiRelationDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Post(':id/request')
    async respondToRequest(
        @Param('id') id: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Body('type') type: string,
    ) {
        if (type !== 'accept' && type !== 'reject')
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, '"type" must be "accept" or "reject"');

        const initiator = NoxIdentifier.parse(id);
        const rel = await this.relations.respondToRequest(req.user, initiator, type === 'accept');
        return await rel.sanitize();
    }

    /**
     * GET /api/users/:id
     *
     * :id supports the full Nox identifier format:
     *   [u:]<int32|username>[@server]
     *
     * Examples:
     *   /api/users/1
     *   /api/users/hactazia
     *   /api/users/u:42
     *   /api/users/hactazia@example.com  → remote (not yet fetched, 501)
     * 
     * Currently only supports local users (server matching instance domain). 
     * Remote users return 501 Not Implemented until federation is implemented.
     * 
     * Returns sanitized user data, or 404 if not found.
     * 
     * @param id User identifier in Nox format (e.g. "1", "hactazia", "u:42", "hactazia@example.com")
     * @returns User data, sanitized
     */
    @ApiOperation({ summary: 'Get user', description: 'Return a single user by NoxIdentifier. Fetches from remote server if the ID is not local.' })
    @ApiWrappedResponse(ApiUserDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiOptionalBearerAuth()
    @ApiOptionalChallenge()
    @ApiSecurity('nox-as')
    @UseGuards(OptionalAuthUserGuard)
    @UseGuards(OptionalServerAsUserGuard)
    @Get(':id')
    async getUser(
        @Param('id') id: string,
        @Req() req: Request & (OptionalUserAuthenticatedRequest | OptionalServerAsUserAuthenticatedRequest),
    ): Promise<ApiUser> {
        const identifier = NoxIdentifier.parse(id);

        if (!identifier.isLocal(await this.users.domain())) {
            const user = req.user as OptionalUserAuthenticatedRequest['user'];
            if (!user) throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required for remote fetch');
            if (!user.isAdmin() && !user.tags.includes('sys:can_external_fetch'))
                throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'external fetch');
            const server = await this.externalServers.findOrDiscover(identifier.server!);
            if (!server) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Server (${identifier.server})`);
            const resp = await server.fetch<ApiUser>(`/users/${identifier.toString()}`);
            if (resp.error || !resp.data) {
                this.users.logger.error(`Failed to fetch user ${identifier.toString()} from server ${identifier.server}:`, resp.error?.code, resp.error?.message);
                throw new ApiException(ApiErrorCode.NOT_FOUND, null, `User (${id})`);
            }
            return resp.data;
        }

        const user = await this.users.findByIdentifier(identifier);
        if (!user)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `User (${identifier.toString()})`);

        const viewer = await req.user?.identifier() ?? null;
        return user.sanitize(viewer);
    }
}
