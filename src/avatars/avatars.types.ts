import type { ApiAlias } from '../users/users.types';

export const SUPPORTED_ENGINES = ['unity'] as const;
export type AvatarEngine = typeof SUPPORTED_ENGINES[number];

export const SUPPORTED_PLATFORMS = ['windows', 'linux', 'macos', 'android', 'ios', 'visionos'] as const;
export type AvatarPlatform = typeof SUPPORTED_PLATFORMS[number];

export interface ApiAvatar {
    id: number;
    /** Short unique name [a-z0-9-_.]{3,8} or null */
    name: string | null;
    title: string;
    description: string | null;
    thumbnail: string | null;
    tags: string[];
    /** Release version info: resolved = actual version used, raw = -1 when auto/latest. */
    release: { resolved: number; raw: number };
    server: string;
    /** NoxIdentifier string of the owner */
    owner: string;
    /** NoxIdentifier strings of contributors */
    contributors: string[];
    alias: ApiAlias[];
}

export interface ApiAvatarAsset {
    id: number;
    version: number;
    engine: string;
    platform: string;
    is_empty: boolean;
    url: string | null;
    hash: string | null;
    size: number | null;
    mods: string[];
    uploader: string | null;
    features: string[];
}
