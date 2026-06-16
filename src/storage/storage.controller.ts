import { Controller, Get, Param, Query, Res, Headers, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { LocalFileProvider } from './local-file.provider';
import { ImageResizeService } from './image-resize.service';
import { Inject } from '@nestjs/common';
import { ApiException } from 'src/api/api-exception';
import { ApiErrorCode } from 'src/api/api-error.factory';
import { closestAllowedWidth, isResizableMimeType, negotiateImageAccept } from './image-resize.constants';

@ApiTags('Storage')
@Controller('files')
export class StorageController {
    constructor(
        private readonly storage: StorageService,
        @Inject('IStorageProvider') private readonly provider: LocalFileProvider,
        private readonly resizer: ImageResizeService,
    ) { }

    /**
     * GET /api/files/:id
     *
     * Streams a stored file. Supports optional resizing for image types:
     *   ?size=256x256   – resize to closest allowed size (ratio-snapped)
     *   ?unoptimized    – bypass resize and stream the original file
     */
    @ApiOperation({ summary: 'Serve file', description: 'Stream a stored file by its opaque ID. Add ?size=WxH to resize (images only) or ?unoptimized to get the original.' })
    @ApiQuery({ name: 'size', required: false, description: 'Desired output width in pixels (e.g. 256). Snapped down to the closest allowed width.' })
    @ApiQuery({ name: 'unoptimized', required: false, description: 'If present, return the original file without any resizing.' })
    @Get(':id')
    async serveFile(
        @Param('id') id: string,
        @Query('size') sizeParam: string | undefined,
        @Query('unoptimized') unoptimized: string | undefined,
        @Headers('accept') accept: string | undefined,
        @Res() res: Response,
    ) {
        if (!id)
            throw new ApiException(ApiErrorCode.VALIDATION_ERROR, {
                required: ['id']
            }, 'Missing file parameters');

        const { id: key, time, type } = this.provider.fromId(id);

        const baseDir = await this.provider.getBaseDir();
        const fullPath = join(baseDir, key);

        if (!existsSync(fullPath))
            throw new NotFoundException('File not found');

        // Negotiate output MIME from Accept header (images only)
        const negotiatedType = isResizableMimeType(type)
            ? negotiateImageAccept(accept, type)
            : type;

        res.setHeader('Last-Modified', time.toUTCString());
        res.setHeader('ETag', `"${key}-${time.getTime()}"`);

        // ?unoptimized or non-image types → stream original
        const wantsResize = unoptimized === undefined && !!sizeParam && isResizableMimeType(type);

        if (!wantsResize) {
            res.setHeader('Content-Type', negotiatedType);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            createReadStream(fullPath).pipe(res);
            return;
        }

        // Parse and snap the requested width
        const rawW = parseInt(sizeParam as string, 10);
        if (!rawW || rawW <= 0)
            throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { param: 'size' }, 'Invalid size parameter, expected a positive integer (e.g. 256)');

        const snappedWidth = closestAllowedWidth(rawW);
        const cacheDir = join(baseDir, '.resize-cache');
        await this.resizer.streamResized(fullPath, type, snappedWidth, cacheDir, res, negotiatedType);
    }
}
