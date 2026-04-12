import { AvatarModel } from 'src/generated/prisma/models/Avatar';
import type { ApiAvatar } from './avatars.types';
import type { AvatarsService } from './avatars.service';
import { NoxIdentifier } from 'src/common/identifier';

export type AvatarWithMethods = AvatarModel & {
    manager: AvatarsService;
    sanitize(): Promise<ApiAvatar>;
    isOwner(userRef: NoxIdentifier): boolean;
    isContributor(userRef: NoxIdentifier): boolean;
    canModify(userRef: NoxIdentifier): boolean;
};

export class Avatar {
    static attach(model: AvatarModel, manager: AvatarsService): AvatarWithMethods {
        const obj = model as unknown as AvatarWithMethods;
        Object.defineProperty(obj, 'manager', {
            value: manager,
            enumerable: false,
            configurable: true,
            writable: true,
        });
        Object.setPrototypeOf(obj, Avatar.prototype as any);
        return obj;
    }

    async sanitize(this: AvatarWithMethods): Promise<ApiAvatar> {
        const domain = await this.manager.address();
        const makePublic = async (val: string | null) => {
            if (!val) return null;
            try {
                const file = await this.manager.storage.get(val);
                return file.url.toString();
            } catch {
                return null;
            }
        };
        return {
            id: this.id,
            name: this.name ?? null,
            title: this.title,
            description: this.description ?? null,
            thumbnail: await makePublic(this.thumbnail ?? null),
            tags: this.tags ?? [],
            release: await this.manager.resolveRelease(this.id, this.release),
            server: domain,
            owner: NoxIdentifier.parse(this.ownerRef).toString(domain),
            contributors: this.contributorRefs.map(ref => NoxIdentifier.parse(ref).toString(domain)),
            alias: [
                { key: 'api', value: `${await this.manager.apiBase()}avatars/${this.id}` },
                { key: 'iid', value: `a:${this.id}@${domain}` },
            ],
        };
    }

    isOwner(this: AvatarWithMethods, user: NoxIdentifier): boolean {
        return this.ownerRef === user.toString();
    }

    isContributor(this: AvatarWithMethods, user: NoxIdentifier): boolean {
        return this.contributorRefs.includes(user.toString());
    }

    canModify(this: AvatarWithMethods, user: NoxIdentifier): boolean {
        return this.isOwner(user) || this.isContributor(user);
    }
}
