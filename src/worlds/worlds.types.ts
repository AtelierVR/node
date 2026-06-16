import type { ApiLink, ApiAlias } from '../users/users.types';

export const SUPPORTED_ENGINES = ['unity'] as const;
export type WorldEngine = typeof SUPPORTED_ENGINES[number];

export const SUPPORTED_PLATFORMS = ['windows', 'linux', 'macos', 'android', 'ios', 'visionos'] as const;
export type WorldPlatform = typeof SUPPORTED_PLATFORMS[number];

export interface ApiWorld {
    id: number;
    name: string | null;
    title: string;
    description: string | null;
    thumbnail: string | null;
    tags: string[];
    capacity: number;
    /** Recommended asset version to download. -1 = none available. */
    release: number;
    server: string;
    /** NoxIdentifier string of the owner */
    owner: string;
    /** NoxIdentifier strings of contributors */
    contributors: string[];
    alias: ApiAlias[];
}

/** Privileged view of a world for owners and contributors — includes release auto-detection flag. */
export interface ApiWorldPrivileged extends Omit<ApiWorld, 'release'> {
    /** Release version info: value = actual version used (-1 if none), auto = was auto-detected (latest). */
    release: { value: number; auto: boolean };
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
