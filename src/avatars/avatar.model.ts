import { AvatarModel } from 'src/generated/prisma/models/Avatar';
import type { ApiAvatar, ApiAvatarPrivileged } from './avatars.types';
import type { AvatarsService } from './avatars.service';
import { NoxIdentifier } from 'src/common/identifier';
import { ensureImageSize, IMAGE_PRESETS } from 'src/storage/image-resize.constants';

export type AvatarWithMethods = AvatarModel & {
    manager: AvatarsService;
    sanitize(options?: { privileged?: boolean }): Promise<ApiAvatar | ApiAvatarPrivileged>;
    isOwner(userRef: NoxIdentifier): boolean;
    isContributor(userRef: NoxIdentifier): boolean;
    canModify(userRef: NoxIdentifier): boolean;
    identifier(): NoxIdentifier;
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

    async sanitize(this: AvatarWithMethods, options?: { privileged?: boolean }): Promise<ApiAvatar | ApiAvatarPrivileged> {
        const address = await this.manager.address();
        const makePublic = async (val: string | null, preset?: number) => {
            if (!val) return null;
            try {
                const file = await this.manager.storage.get(val);
                return preset !== undefined ? ensureImageSize(file.url, preset) : file.url.toString();
            } catch {
                return null;
            }
        };
        const release = await this.manager.resolveRelease(this.id, this.release);
        const base = {
            id: this.id,
            name: this.name ?? null,
            title: this.title,
            description: this.description ?? null,
            thumbnail: await makePublic(this.thumbnail ?? null, IMAGE_PRESETS.OTHER_THUMBNAIL),
            tags: this.tags ?? [],
            server: address,
            owner: NoxIdentifier.parse(this.ownerRef).toString(address),
            contributors: this.contributorRefs.map(ref => NoxIdentifier.parse(ref).toString(address)),
            alias: [
                { key: 'api', value: `${await this.manager.apiBase()}avatars/${this.id}` },
                { key: 'iid', value: this.identifier().toString(address) },
                ...(this.name ? [{ key: 'nid', value: `${this.name}@${address}` }] : []),
            ],
        };
        if (options?.privileged) {
            return { ...base, release: { value: release, auto: this.release === null } };
        }
        return { ...base, release };
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

    identifier(this: AvatarWithMethods): NoxIdentifier {
        return new NoxIdentifier(null, String(this.id));
    }
}
