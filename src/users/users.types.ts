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
    /**
     * List of instance iids the user is currently in (e.g. ["42@example.com"]),
     * or null when the viewer has no permission to see the user's locations.
     * An empty array means the viewer can see the field but the user
     * is not in any instance.
     */
    locations: string[] | null;
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

/**
 * Visibility rules for the `location` field per presence status.
 *
 * - `visible_everyone`  : anyone, including unauthenticated viewers
 * - `visible_other`     : any authenticated viewer (no relation required)
 * - `visible_friends`   : mutual follow (viewer follows user AND user follows viewer)
 * - `visible_followers` : viewers who follow the user
 * - `visible_following` : viewers the user follows back
 */
export interface PresenceStatusVisibility {
    visible_everyone: boolean;
    visible_friends: boolean;
    visible_following: boolean;
    visible_followers: boolean;
    visible_other: boolean;
}

export const PRESENCE_VISIBILITY: Record<string, PresenceStatusVisibility> = {
    //                         everyone  friends  following  followers  other
    online: { visible_everyone: false, visible_friends: true, visible_following: true, visible_followers: true, visible_other: false },
    busy: { visible_everyone: false, visible_friends: true, visible_following: false, visible_followers: false, visible_other: false },
    do_not_disturb: { visible_everyone: false, visible_friends: false, visible_following: false, visible_followers: false, visible_other: false },
    stream: { visible_everyone: true, visible_friends: true, visible_following: true, visible_followers: true, visible_other: true },
    offline: { visible_everyone: false, visible_friends: false, visible_following: false, visible_followers: false, visible_other: false },
};
