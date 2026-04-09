import type { ApiLink, ApiAlias } from '../users/users.types';

export const SUPPORTED_ENGINES = ['unity'] as const;
export type WorldEngine = typeof SUPPORTED_ENGINES[number];

export const SUPPORTED_PLATFORMS = ['windows', 'linux', 'macos', 'android', 'ios', 'visionos'] as const;
export type WorldPlatform = typeof SUPPORTED_PLATFORMS[number];

export interface ApiWorld {
    id: number;
    title: string;
    description: string | null;
    thumbnail: string | null;
    tags: string[];
    capacity: number;
    /** Recommended version to download. -1 means no uploaded version found. */
    release: number;
    server: string;
    /** NoxIdentifier string of the owner */
    owner: string;
    /** NoxIdentifier strings of contributors */
    contributors: string[];
    alias: ApiAlias[];
}

export interface ApiWorldAsset {
    id: number;
    version: number;
    engine: string;
    platform: string;
    is_empty: boolean;
    url: string | null;
    hash: string | null;
    size: number | null;
    mods: string[];
    features: string[];
    /** NoxIdentifier of the user who last uploaded the file, or null */
    uploader: string | null;
}
