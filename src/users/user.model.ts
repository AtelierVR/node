import { UserModel } from 'src/generated/prisma/models/User';
import { UsersService } from './users.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiUser as ApiUser, ApiCurrentUser, ApiUserRelations, PRESENCE_TO_API } from './users.types';

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

    const makePublic = async (val: string | null) => {
      if (!val) return null;
      try {
        const file = await manager.storage.get(val);
        return file.url.toString();
      } catch {
        return null;
      }
    };

    return {
      id: user.id,
      username: user.username,
      display: user.display,
      bio: user.bio ?? null,
      pronoun: user.pronoun ?? null,
      server: await manager.wellKnown.address(),
      tags: tags,
      thumbnail: await makePublic(user.thumbnail ?? null),
      banner: await makePublic(user.banner ?? null),
      links: manager.parseLinks(user.links),
      relations: viewer
        ? await this.relationsWith(viewer)
        : null,
      public: manager.compactPublicKey(Buffer.from(user.public)),
      followers: !this.isHideFollowers()
        ? await this.followers()
        : -1,
      following: !this.isHideFollowing()
        ? await this.following()
        : -1,
      presence: {
        status: PRESENCE_TO_API[user.presence] ?? 'online',
        text: user.presenceStatus ?? null,
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
    var base = await this.sanitize();
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

  isLocal(this: UserWithMethods): this is UserWithMethods {
    return true;
  }
}
