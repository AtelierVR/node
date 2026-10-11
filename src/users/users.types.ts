import { ApiAlias } from '@/common/alias.types';
import { $Enums } from 'src/generated/prisma/client';
import { ApiRelationType } from 'src/relations/relations.types';

export interface ApiLink {
  label: string;
  value: string;
}

export interface ApiUserRelations {
  out: ApiRelationType | null;
  in: ApiRelationType | null;
}

export interface IUserPresence {
  status: PresenceStatusApi;
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
  home: string | null;
  avatar: string | null;
  relations: null;
  /**
   * Authentication methods and their status, keyed by method name:
   *   email   → "verified" | "unverified" | "disabled"  (disabled = no email set)
   *   totp    → "enabled"  | "disabled"
   *   passkey → "enabled"  | "disabled"
   */
  methods: Record<string, string>;
}

/** The API presence statuses, in visibility order (least → most visible). */
export const PRESENCE_STATUSES = [
  'offline',
  'dnd',
  'stream',
  'busy',
  'online',
  'event',
  'public',
] as const;

/** Strict string union of the API presence statuses. */
export type PresenceStatusApi = (typeof PRESENCE_STATUSES)[number];

/**
 * Maps the DB enum → the short status string exposed by the API / WebSocket.
 *
 * `DO_NOT_DISTURB` is exposed as `dnd` (the value the DTO validates and the front
 * expects).
 */
export const PRESENCE_TO_API: Record<$Enums.PresenceStatus, PresenceStatusApi> =
  {
    [$Enums.PresenceStatus.OFFLINE]: 'offline',
    [$Enums.PresenceStatus.DO_NOT_DISTURB]: 'dnd',
    [$Enums.PresenceStatus.STREAM]: 'stream',
    [$Enums.PresenceStatus.BUSY]: 'busy',
    [$Enums.PresenceStatus.ONLINE]: 'online',
    [$Enums.PresenceStatus.EVENT]: 'event',
    [$Enums.PresenceStatus.PUBLIC]: 'public',
  };

/**
 * Bit flags describing who may see a user's `presence.locations`.
 *
 * ```
 * 0b00  NONE     — hidden (only the user themself)
 * 0b01  FRIENDS  — mutual follow (viewer follows user AND user follows viewer)
 * 0b10  EVERYONE — anyone, guests included
 * ```
 */
export enum PresenceVisibility {
  NONE = 0b00,
  FRIENDS = 0b01,
  EVERYONE = 0b10,
}

/**
 * Who may see `presence.locations`, per API status.
 *
 * - `online` → mutual-follow friends only
 * - `event` / `public` → everyone (guests included)
 * - `offline` / `dnd` / `stream` / `busy` → hidden
 *
 * A location whose identifier carries a `private` flag (`?private` or
 * `?private=true`) is never revealed to others — only the user themself sees it.
 */
export const PRESENCE_VISIBILITY: Record<string, PresenceVisibility> = {
  offline: PresenceVisibility.NONE,
  dnd: PresenceVisibility.NONE,
  stream: PresenceVisibility.NONE,
  busy: PresenceVisibility.NONE,
  online: PresenceVisibility.FRIENDS,
  event: PresenceVisibility.EVERYONE,
  public: PresenceVisibility.EVERYONE,
};

/** The viewer's relationship bits, used to evaluate {@link PRESENCE_VISIBILITY}. */
export interface PresenceViewer {
  /** Mutual follow (viewer follows the user AND the user follows the viewer). */
  isFriend: boolean;
}

/** Whether `visibility` grants `viewer` access to the user's locations. */
export function canSeeLocation(
  visibility: PresenceVisibility,
  viewer: PresenceViewer,
): boolean {
  if (visibility & PresenceVisibility.EVERYONE) return true;
  return viewer.isFriend && (visibility & PresenceVisibility.FRIENDS) !== 0;
}
