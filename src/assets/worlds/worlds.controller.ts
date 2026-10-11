import { Body, Param, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AssetController } from '@/assets/asset-controller.decorator';
import { AssetControllerBase } from '@/assets/asset-controller.base';
import { AssetService } from '@/assets/asset.service';
import type { ISanitizeOptions } from '@/assets/asset.types';
import { AuthUserGuard } from '@/auth/auth.guard';
import type { UserAuthenticatedRequest } from '@/auth/auth.guard';
import {
    CreateWorldAssetDto,
    UpdateWorldAssetDto,
} from '@/assets/worlds/dto/world-asset.dto';
import { WORLD_ASSET_TYPE } from '@/assets/worlds/worlds.provider';
import type { IApiWorld } from '@/assets/worlds/worlds.types';

/**
 * World asset controller.
 *
 * A world is served like any other asset type (`GET /api/worlds`,
 * `GET /api/worlds/:id`, releases, files, images, webhooks…) through
 * {@link AssetControllerBase}. Only the create/update entry points are
 * overridden to accept the world-specific `capacity` option.
 */
@AssetController(WORLD_ASSET_TYPE, 'worlds')
export class WorldsController extends AssetControllerBase {
    constructor(private readonly worldsAssets: AssetService) {
        super(worldsAssets);
    }

    /** PUT /api/worlds — register a new world asset (with optional `capacity`). */
    @ApiOperation({
        summary: 'Create world',
        description:
            'Register a new world asset owned by the caller. Optional `capacity` (0–65535) defaults to 32.',
    })
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Put()
    override async createUploadAsset(
        @Req() request: UserAuthenticatedRequest,
        @Body() body: CreateWorldAssetDto,
        @Query('full') full: string | undefined,
    ): Promise<IApiWorld> {
        const asset = await this.worldsAssets.createUploadAsset(
            this.assetType,
            body,
            request.user,
        );
        return (await asset.sanitize(
            request.user,
            sanitizeOptions(full),
        )) as IApiWorld;
    }

    /** PATCH /api/worlds/:id — update world metadata and/or `capacity`. */
    @ApiOperation({
        summary: 'Update world',
        description:
            'Update a world asset metadata (name, title, description, tags, preferred release) and/or its `capacity` (0–65535).',
    })
    @ApiBearerAuth()
    @UseGuards(AuthUserGuard)
    @Patch(':id')
    override async updateUploadAsset(
        @Param('id') id: string,
        @Req() request: UserAuthenticatedRequest,
        @Body() body: UpdateWorldAssetDto,
        @Query('full') full: string | undefined,
    ): Promise<IApiWorld> {
        const asset = await this.worldsAssets.updateUploadAsset(
            this.assetType,
            id,
            body,
            request.user,
        );
        return (await asset.sanitize(
            request.user,
            sanitizeOptions(full),
        )) as IApiWorld;
    }
}

/** `?full=1` → expanded sanitization (nested objects instead of ids/urls). */
function sanitizeOptions(
    full: string | undefined,
): ISanitizeOptions | undefined {
    return full === '1' ? { expanded: true } : undefined;
}
