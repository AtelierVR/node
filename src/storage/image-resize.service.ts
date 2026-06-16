import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import { stat, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import type { Response } from 'express';
import sharp from 'sharp';
import { IMAGE_ENCODERS, isResizableMimeType } from './image-resize.constants';

/** A single in-flight resize operation keyed by `${fileId}-${w}x${h}` */
type ResizePromise = Promise<string>;

@Injectable()
export class ImageResizeService {
    private readonly logger = new Logger(ImageResizeService.name);

    /** In-flight resizes: key → promise that resolves to the cached file path */
    private readonly inFlight = new Map<string, ResizePromise>();

    /**
     * Stream a resized image to the response.
     *
     * @param sourceFilePath  Absolute path to the original file on disk
     * @param mimetype        Original MIME type
     * @param size            Target { width, height }
     * @param cacheDir        Directory where resized files are cached
     * @param res             Express response to pipe into
     */
    async streamResized(
        sourceFilePath: string,
        mimetype: string,
        size: number,
        cacheDir: string,
        res: Response,
        targetMime?: string,
    ): Promise<void> {
        if (!isResizableMimeType(mimetype)) {
            // Non-resizable: fall back to streaming the original
            res.setHeader('Content-Type', mimetype);
            createReadStream(sourceFilePath).pipe(res);
            return;
        }

        const outputMime = targetMime ?? this.outputMime(mimetype);
        const cachedPath = this.cachedPath(cacheDir, sourceFilePath, size, outputMime);

        if (!existsSync(cachedPath))
            await this.ensureResized(sourceFilePath, mimetype, size, cachedPath, outputMime);

        res.setHeader('Content-Type', outputMime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        try {
            const info = await stat(cachedPath);
            res.setHeader('Content-Length', info.size);
        } catch { /* not fatal */ }

        createReadStream(cachedPath).pipe(res);
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    private async ensureResized(
        sourceFilePath: string,
        mimetype: string,
        size: number,
        cachedPath: string,
        targetMime?: string,
    ): Promise<void> {
        const key = cachedPath;

        let promise = this.inFlight.get(key);
        if (!promise) {
            promise = this.doResize(sourceFilePath, mimetype, size, cachedPath, targetMime)
                .finally(() => this.inFlight.delete(key));
            this.inFlight.set(key, promise);
        }

        await promise;
    }

    private async doResize(
        sourceFilePath: string,
        mimetype: string,
        size: number,
        cachedPath: string,
        targetMime?: string,
    ): Promise<string> {
        const dir = join(cachedPath, '..');
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });

        const encodeMime = (targetMime ?? mimetype).toLowerCase();
        const encoder = IMAGE_ENCODERS[encodeMime] ?? IMAGE_ENCODERS['default'];

        const pipeline = encoder.encode(
            encodeMime,
            sharp(sourceFilePath, encoder.options ?? {})
                .resize(size, undefined, {
                    withoutEnlargement: true,
                }),
        );

        const buffer = await pipeline.toBuffer();
        await writeFile(cachedPath, buffer);

        this.logger.debug(`Resized → ${cachedPath} (w=${size})`);
        return cachedPath;
    }

    /** Deterministic cache path: <cacheDir>/<fmt>/<sizeKey>/<hash>.bin */
    private cachedPath(cacheDir: string, sourceFilePath: string, size: number, fmt: string): string {
        const hash = createHash('sha1').update(sourceFilePath).digest('hex');
        return join(cacheDir, fmt.replace('/', '_'), `${size}`, hash);
    }

    /** Output MIME type for a given source MIME type */
    private outputMime(sourceMime: string): string {
        const lower = sourceMime.toLowerCase();
        if (lower === 'image/png') return 'image/png';
        if (lower === 'image/apng') return 'image/apng';
        if (lower === 'image/gif') return 'image/gif';
        if (lower === 'image/avif') return 'image/avif';
        return 'image/webp';
    }
}
