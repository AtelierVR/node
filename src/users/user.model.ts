import { UserModel } from 'src/generated/prisma/models/User';
import { UsersService } from './users.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiUser as ApiUser, ApiCurrentUser, ApiUserRelations, PRESENCE_TO_API, PRESENCE_VISIBILITY } from './users.types';
import { ensureImageSize, IMAGE_PRESETS } from '../storage/image-resize.constants';
import type { WebFingerDocument } from '../fediverse/fediverse.types';
import type { APActor } from '../fediverse/activitypub/activitypub.types';
import { AP_CONTEXT } from '../fediverse/activitypub/activitypub.types';
import { createPublicKey } from 'node:crypto';

export type UserWithMethods = UserModel & {
  manager: UsersService;
  sanitize(viewer?: NoxIdentifier | null): Promise<ApiUser>;
  sanitizeCurrent(): Promise<ApiCurrentUser>;
  followers(): Promise<number>;
  following(): Promise<number>;
  relationsWith(viewer: NoxIdentifier): Promise<ApiUserRelations>;
  isHideFollowers(): boolean;
  isHideFollowing(): boolean;
  isAdmin(): boolean;
  identifier(): NoxIdentifier;
  isLocal(): this is UserWithMethods;
  buildWebFinger(): Promise<WebFingerDocument>;
  buildActor(): Promise<APActor>;
};

export class User {
  // Attach methods to a plain UserModel instance and return it as UserWithMethods
  static attach(model: UserModel, manager: UsersService): UserWithMethods {
    const obj = model as unknown as UserWithMethods;
    Object.defineProperty(obj, 'manager', {
      value: manager,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    // Ensure prototype methods are available
    Object.setPrototypeOf(obj, User.prototype as any);
    return obj;
  }

  // Note: `this` will be the underlying model after attach
  async sanitize(this: UserWithMethods, viewer?: NoxIdentifier | null): Promise<ApiUser> {
    const user = this as UserModel;
    const manager = this.manager;
    const tags = user.tags ?? [];

    const makePublic = async (val: string | null, preset?: number) => {
      if (!val) return null;
      try {
        const file = await manager.storage.get(val);
        return preset !== undefined ? ensureImageSize(file.url, preset) : file.url.toString();
      } catch {
        return null;
      }
    };

    // Compute viewer relations once — reused for both `relations` field and location visibility
    const viewerRelations: ApiUserRelations | null = viewer
      ? await this.relationsWith(viewer)
      : null;

    // Determine if this viewer can see the location based on the user's current status
    const status = PRESENCE_TO_API[user.presence] ?? 'online';
    const visibility = PRESENCE_VISIBILITY[status] ?? PRESENCE_VISIBILITY['online'];
    const rawLocations = manager.wsGateway?.getLocationsForUser(user.id) ?? [];
    let visibleLocation: string[] | null = null;

    const isSelf = viewer !== null && viewer !== undefined
      && viewer.id === String(user.id);
    const isAuthenticated = viewer !== null && viewer !== undefined;
    const isFriend = viewerRelations?.out === 'follow' && viewerRelations?.in === 'follow';
    const isFollower = viewerRelations?.out === 'follow';  // viewer follows the user
    const isFollowing = viewerRelations?.in === 'follow';  // the user follows the viewer

    const canSeeLocation =
      isSelf ||
      visibility.visible_everyone ||
      (isAuthenticated && visibility.visible_other) ||
      (isFriend && visibility.visible_friends) ||
      (isFollower && visibility.visible_followers) ||
      (isFollowing && visibility.visible_following);

    if (canSeeLocation) {
      // Return the list (may be empty if user is not in any instance)
      visibleLocation = rawLocations;
    }

    return {
      id: user.id,
      username: user.username,
      display: user.display,
      bio: user.bio ?? null,
      pronoun: user.pronoun ?? null,
      server: await manager.wellKnown.address(),
      tags: tags,
      thumbnail: await makePublic(user.thumbnail ?? null, IMAGE_PRESETS.USER_THUMBNAIL),
      banner: await makePublic(user.banner ?? null, IMAGE_PRESETS.USER_BANNER),
      links: manager.parseLinks(user.links),
      relations: viewerRelations,
      public: manager.compactPublicKey(Buffer.from(user.public)),
      followers: !this.isHideFollowers()
        ? await this.followers()
        : -1,
      following: !this.isHideFollowing()
        ? await this.following()
        : -1,
      presence: {
        status,
        text: user.presenceStatus ?? null,
        locations: visibleLocation, // string[] | null
      },
      alias: [
        { key: 'api', value: `${await manager.wellKnown.apiBaseUrl()}users/${user.id}` },
        { key: 'iid', value: `${user.id}@${await manager.wellKnown.address()}` },
        { key: 'uid', value: `${user.username}@${await manager.wellKnown.address()}` },
      ],
      created_at: user.createdAt.getTime()
    };
  }

  async sanitizeCurrent(this: UserWithMethods): Promise<ApiCurrentUser> {
    const user = this as UserModel;
    var base = await this.sanitize(this.identifier());
    return {
      ...base,
      email: user.email ?? null,
      email_verified: user.emailVerified,
      home: user.homeRef && NoxIdentifier.parse(user.homeRef).toString(base.server),
      avatar: user.avatarRef && NoxIdentifier.parse(user.avatarRef).toString(base.server),
      relations: null,
      twofa_enabled: user.twofaEnabled,
    };
  }

  isAdmin(this: UserWithMethods): boolean {
    return (this.tags ?? []).includes('sys:admin');
  }

  isHideFollowers(this: UserWithMethods): boolean {
    return (this.tags ?? []).includes('usr:hide_followers');
  }

  isHideFollowing(this: UserWithMethods): boolean {
    return (this.tags ?? []).includes('usr:hide_following');
  }

  async followers(this: UserWithMethods): Promise<number> {
    return this.manager.relations.getFollowersCount(this);
  }

  async following(this: UserWithMethods): Promise<number> {
    return this.manager.relations.getFollowingCount(this);
  }

  async relationsWith(this: UserWithMethods, viewer: NoxIdentifier): Promise<ApiUserRelations> {
    return this.manager.relations.getRelationBetween(this, viewer);
  }

  identifier(this: UserWithMethods): NoxIdentifier {
    return new NoxIdentifier(null, String(this.id));
  }

  async buildWebFinger(this: UserWithMethods): Promise<WebFingerDocument> {
    const domain = await this.manager.wellKnown.address();
    const actorUrl = `${await this.manager.wellKnown.activityPubUrl()}u/${this.username}`;
    const profileUrl = `${await this.manager.wellKnown.webBaseUrl()}u/${this.username}`;

    const links: WebFingerDocument['links'] = [
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: profileUrl,
      },
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actorUrl,
      },
    ];

    // Avatar link (same as Mastodon)
    if (this.thumbnail) {
      try {
        const file = await this.manager.storage.get(this.thumbnail);
        links.push({
          rel: 'http://webfinger.net/rel/avatar',
          type: file.mimetype,
          href: file.url.toString(),
        });
      } catch { /* omit */ }
    }

    return {
      subject: `acct:${this.username}@${domain}`,
      aliases: [profileUrl, actorUrl],
      links,
    };
  }

  async buildActor(this: UserWithMethods): Promise<APActor> {
    const actorUrl = `${await this.manager.wellKnown.activityPubUrl()}u/${this.username}`;

    let icon: APActor['icon'];
    if (this.thumbnail) {
      try {
        const file = await this.manager.storage.get(this.thumbnail);
        icon = { type: 'Image', url: file.url.toString(), mediaType: file.mimetype };
      } catch { /* omit */ }
    }

    const publicKeyPem = createPublicKey({
      key: Buffer.from(this.public),
      format: 'der',
      type: 'spki',
    }).export({ format: 'pem', type: 'spki' }) as string;

    return {
      '@context': AP_CONTEXT,
      id: actorUrl,
      type: 'Person',
      preferredUsername: this.username,
      name: this.display ?? this.username,
      summary: this.bio ?? undefined,
      inbox: `${actorUrl}/inbox`,
      outbox: `${actorUrl}/outbox`,
      followers: `${actorUrl}/followers`,
      following: `${actorUrl}/following`,
      url: actorUrl,
      published: this.createdAt?.toISOString(),
      icon,
      publicKey: {
        id: `${actorUrl}#main-key`,
        owner: actorUrl,
        publicKeyPem,
      },
    };
  }

  isLocal(this: UserWithMethods): this is UserWithMethods {
    return true;
  }
}
