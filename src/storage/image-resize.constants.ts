import type { Sharp } from 'sharp';


/** Allowed output widths. Height is always derived from the caller's ratio. */
export const ALLOWED_WIDTHS: ReadonlyArray<number> = [64, 128, 256, 512, 1024, 1280, 1920];

/** Default output widths for each image context. */
export const IMAGE_PRESETS = {
    /** User profile picture (square, 1:1) */
    USER_THUMBNAIL: 256,
    /** User banner (4:3) */
    USER_BANNER: 256,
    /** World / instance thumbnail (4:3) */
    OTHER_THUMBNAIL: 256,
} as const satisfies Record<string, number>;

/**
 * Returns the largest allowed width that is ≤ the requested width.
 * Falls back to the smallest allowed width if the request is smaller than all entries.
 */
export function closestAllowedWidth(requested: number): number {
    const sorted = [...ALLOWED_WIDTHS].sort((a, b) => b - a); // descending
    return sorted.find(w => w <= requested) ?? sorted[sorted.length - 1];
}

/**
 * Build a safe redirect URL for a stored image.
 *
 * @param url         Original file URL (may already carry query params)
 * @param size        Requested width override; snapped to closest allowed. `undefined` → use `defaultSize`
 * @param unoptimized When `true`, adds `?unoptimized` and strips `?size`
 * @param defaultSize Fallback width when `size` is not provided (use an `IMAGE_PRESETS` value)
 */
export function ensureImageSize(
    url: URL | string,
    defaultSize: number,
    size?: string | number,
    unoptimized?: string,
): string {
    const u = new URL(url.toString());
    if (unoptimized !== undefined) {
        u.searchParams.delete('size');
        u.searchParams.set('unoptimized', '');
    } else {
        u.searchParams.delete('unoptimized');
        const rawW = size !== undefined ? Number(size) : NaN;
        const w = Number.isFinite(rawW) && rawW > 0 ? closestAllowedWidth(rawW) : defaultSize;
        u.searchParams.set('size', String(w));
    }
    return u.toString();
}

export type Encoder = (mime: string, pipeline: Sharp) => Sharp;

export interface ImageEncoder {
    /** Options passed to the sharp() constructor (e.g. { animated: true } for GIF/WebP/APNG). */
    options?: import('sharp').SharpOptions;
    /** Encode the pipeline to the target output format. */
    encode: Encoder;
}

/** Per-MIME encoder configs. Falls back to 'default' for unmatched types. */
export const IMAGE_ENCODERS: Record<string, ImageEncoder> = {
    'image/gif': {
        options: { animated: true },
        encode: (_, p) => p.gif({ effort: 10 })
    },
    'image/webp': {
        options: { animated: true },
        encode: (_, p) => p.webp({ quality: 80 })
    },
    'image/png': {
        options: { animated: true },
        encode: (_, p) => p.png({ compressionLevel: 8 })
    },
    'image/avif': {
        encode: (_, p) => p.avif({ quality: 60 })
    },
    'image/jpeg': {
        encode: (_, p) => p.webp({ quality: 80 })
    },
    'image/jpg': {
        encode: (_, p) => p.webp({ quality: 80 })
    },
    'default': {
        encode: (_, p) => p
    },
};


/** MIME types that support resizing */
export function isResizableMimeType(mimetype: string): boolean {
    if (!mimetype || mimetype === 'default') return false;
    return Object.keys(IMAGE_ENCODERS).includes(mimetype.toLowerCase());
}