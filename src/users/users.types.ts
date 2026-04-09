import { $Enums } from "src/generated/prisma/client";
import { ApiRelationType } from "src/relations/relations.types";

export interface ApiLink {
    label: string;
    value: string;
}

export interface ApiAlias {
    key: string;
    value: string;
}

export interface ApiUserRelations {
    out: ApiRelationType | null;
    in: ApiRelationType | null;
}

export interface IUserPresence {
    status: string;
    text: string | null;
}

/**
 * Public user profile as returned by GET /api/users/:id.
 * Mirrors the live Nox API response shape.
 */
export interface ApiUser {
    id: number;
    username: string;
    display: string;
    bio: string | null;
    pronoun: string | null;
    server: string;
    tags: string[];
    thumbnail: string | null;
    banner: string | null;
    links: ApiLink[];
    relations: ApiUserRelations | null;
    /** Compact Ed25519 public key — base64(SPKI DER), ~60 chars */
    public: string;
    followers: number;
    following: number;
    presence: IUserPresence;
    alias: ApiAlias[];
    created_at: number;
}

export interface ApiCurrentUser extends ApiUser {
    email: string | null;
    email_verified: boolean;
    home: string | null;
    avatar: string | null;
    relations: null;
    twofa_enabled: boolean;
}

/** Maps DB enum → API status string */
export const PRESENCE_TO_API: Record<$Enums.PresenceStatus, string> = {
    [$Enums.PresenceStatus.ONLINE]: 'online',
    [$Enums.PresenceStatus.BUSY]: 'busy',
    [$Enums.PresenceStatus.DO_NOT_DISTURB]: 'do_not_disturb',
    [$Enums.PresenceStatus.STREAM]: 'stream',
    [$Enums.PresenceStatus.OFFLINE]: 'offline',
};
