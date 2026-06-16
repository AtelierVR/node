import { WorldModel } from 'src/generated/prisma/models/World';
import type { ApiWorld, ApiWorldPrivileged } from './worlds.types';
import { WorldsService } from './worlds.service';
import { NoxIdentifier } from 'src/common/identifier';
import { ensureImageSize, IMAGE_PRESETS } from 'src/storage/image-resize.constants';

export type WorldWithMethods = WorldModel & {
    manager: WorldsService;
    sanitize(options?: { privileged?: boolean }): Promise<ApiWorld | ApiWorldPrivileged>;
    isOwner(userRef: string): boolean;
    isContributor(userRef: string): boolean;
    canModify(userRef: string): boolean;
    identifier(): NoxIdentifier;
};

export class World {
    static attach(model: WorldModel, manager: WorldsService): WorldWithMethods {
        const obj = model as unknown as WorldWithMethods;
        Object.defineProperty(obj, 'manager', {
            value: manager,
            enumerable: false,
            configurable: true,
            writable: true,
        });
        
        // Ensure prototype methods are available
        Object.setPrototypeOf(obj, World.prototype as any);
        return obj;
    }

    async sanitize(this: WorldWithMethods, options?: { privileged?: boolean }): Promise<ApiWorld | ApiWorldPrivileged> {
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
            capacity: this.capacity,
            server: address,
            owner: NoxIdentifier.parse(this.ownerRef).toString(address),
            contributors: this.contributorRefs.map(ref => NoxIdentifier.parse(ref).toString(address)),
            alias: [
                { key: 'api', value: `${await this.manager.apiBase()}worlds/${this.id}` },
                { key: 'iid', value: this.identifier().toString(address) },
                ...(this.name ? [{ key: 'nid', value: `${this.name}@${address}` }] : []),
            ],
        };
        if (options?.privileged) {
            return { ...base, release: { value: release, auto: this.release === null } };
        }
        return { ...base, release };
    }

    isOwner(this: WorldWithMethods, userRef: string): boolean {
        return this.ownerRef === userRef;
    }

    isContributor(this: WorldWithMethods, userRef: string): boolean {
        return this.contributorRefs.includes(userRef);
    }

    canModify(this: WorldWithMethods, userRef: string): boolean {
        return this.isOwner(userRef) || this.isContributor(userRef);
    }

    identifier(this: WorldWithMethods): NoxIdentifier {
        return new NoxIdentifier(null, String(this.id));
    }
}
