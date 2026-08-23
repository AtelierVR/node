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
    const sorted = [...ALLOWED_WIDTHS].sort((a, b) => a - b); // croissant
    return sorted.find(w => w >= requested) ?? sorted[sorted.length - 1];
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
        options: { animated: true, pages: -1 },
        encode: (_, p) => p.png({ compressionLevel: 8 })
    },
    'image/apng': {
        options: { animated: true, pages: -1 },
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

/** List of image MIME types the server can produce (encoder keys minus 'default'). */
export const SUPPORTED_IMAGE_TYPES: ReadonlyArray<string> =
    Object.keys(IMAGE_ENCODERS).filter(k => k !== 'default');

/**
 * Parse the Accept header and return the first image MIME type the client
 * accepts that the server can produce. Falls back to `sourceMime`.
 *
 * When the source is animated (its encoder has `animated: true`), only
 * animated-compatible output formats are considered — static-only formats
 * like AVIF/JPEG are skipped.
 */
export function negotiateImageAccept(
    acceptHeader: string | undefined,
    sourceMime: string,
): string {
    if (!acceptHeader) return sourceMime;

    const lowerSource = sourceMime.toLowerCase();
    const sourceAnimated = IMAGE_ENCODERS[lowerSource]?.options?.animated === true;

    const types = acceptHeader
        .split(',')
        .map(part => {
            const [type, qParam] = part.trim().split(';');
            const q = qParam?.trim().startsWith('q=')
                ? parseFloat(qParam.trim().slice(2))
                : 1.0;
            return { type: type.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1.0 };
        })
        .sort((a, b) => b.q - a.q);

    for (const { type } of types) {
        if (type === '*/*' || type === 'image/*') return sourceMime;
        if (!SUPPORTED_IMAGE_TYPES.includes(type)) continue;
        // Skip static-only output formats when the source is animated
        if (sourceAnimated && !IMAGE_ENCODERS[type]?.options?.animated) continue;
        return type;
    }

    return sourceMime;
}