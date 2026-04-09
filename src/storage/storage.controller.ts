import { Controller, Get, Param, Query, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { LocalFileProvider } from './local-file.provider';
import { Inject } from '@nestjs/common';
import { ApiException } from 'src/api/api-exception';
import { ApiErrorCode } from 'src/api/api-error.factory';

@ApiTags('Storage')
@Controller('files')
export class StorageController {
    constructor(
        private readonly storage: StorageService,
        @Inject('IStorageProvider') private readonly provider: LocalFileProvider,
    ) { }

    /**
     * GET /api/files/:id
     *
     * Reconstructs the local:// key from path + query params and streams the file.
     */
    @ApiOperation({ summary: 'Serve file', description: 'Stream a stored file by its opaque ID.' })
    @Get(':id')
    async serveFile(
        @Param('id') id: string,
        @Res() res: Response,
    ) {
        if (!id)
            throw new ApiException(ApiErrorCode.VALIDATION_ERROR, {
                required: ['id']
            }, 'Missing file parameters',);

        const { id: key, time, type } = this.provider.fromId(id);

        const baseDir = await this.provider.getBaseDir();
        const fullPath = join(baseDir, key);

        if (!existsSync(fullPath))
            throw new NotFoundException('File not found');

        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Last-Modified', time.toUTCString());
        res.setHeader('ETag', `"${key}-${time.getTime()}"`);

        createReadStream(fullPath).pipe(res);
    }
}
