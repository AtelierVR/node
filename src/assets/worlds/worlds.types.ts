import type { IApiAsset } from '@/assets/asset.types';

/**
 * API-facing representation of a world asset.
 *
 * A world is a regular locally-hosted asset (`type: "world"`) that carries a
 * single extra option: its player `capacity`. Everything else (releases, files,
 * images, tags, aliases…) is inherited from {@link IApiAsset}.
 */
export interface IApiWorld extends IApiAsset {
    /** Maximum number of concurrent players (0–65535). */
    capacity: number;
}
