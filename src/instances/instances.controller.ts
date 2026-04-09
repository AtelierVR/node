import {
    Controller, Get, Put, Patch, Delete, Param, Req, Query, Body,
    UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
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

@ApiTags('Instances')
@Controller('instances')
export class InstancesController {
    constructor(private readonly instances: InstancesService) { }

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
        @Query('q') query?: string,
        @Query('world') world?: string,
        @Query('owner') owner?: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const { limit, offset } = this.parsePaging(rawLimit, rawOffset);
        const { items, total } = await this.instances.search({ query, world, owner }, limit, offset);

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

        const domain = await this.instances.domain();
        const instance = await this.instances.create({
            name:          body.name,
            title:         body.title          ?? null,
            description:   body.description    ?? null,
            capacity:      body.capacity,
            worldRef:      body.world,
            ownerRef:      `u:${req.user.id}@${domain}`,
            tags:          body.tags           ?? [],
            thumbnail:     body.thumbnail      ?? null,
            useWhitelist:  body.use_whitelist  ?? false,
            whitelistRefs: body.whitelist_refs ?? [],
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
            ...(body.whitelist_refs !== undefined && { whitelistRefs: body.whitelist_refs }),
            ...(body.use_password   !== undefined && { usePassword:   body.use_password }),
            ...(body.password       !== undefined && { password:      body.password }),
        });

        return this.instances.serialize(updated);
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
