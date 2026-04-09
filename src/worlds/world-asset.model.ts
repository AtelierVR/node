import { WorldAssetModel } from 'src/generated/prisma/models/WorldAsset';
import type { ApiWorldAsset } from './worlds.types';
import { WorldsService } from './worlds.service';
import { NoxIdentifier } from 'src/common/identifier';

export type WorldAssetWithMethods = WorldAssetModel & {
    manager: WorldsService;
    sanitize(): ApiWorldAsset;
    isEmpty(): boolean;
};

export class WorldAsset {
    static attach(model: WorldAssetModel, manager: WorldsService): WorldAssetWithMethods {
        const obj = model as unknown as WorldAssetWithMethods;
        obj.manager = manager;
        Object.setPrototypeOf(obj, WorldAsset.prototype as any);
        return obj;
    }

    isEmpty(this: WorldAssetWithMethods): boolean {
        return this.hash === null && this.url === null;
    }

    async sanitize(this: WorldAssetWithMethods): Promise<ApiWorldAsset> {
        const address = await this.manager.address();
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
            version: this.version,
            engine: this.engine,
            platform: this.platform,
            is_empty: this.isEmpty(),
            url: await makePublic(this.url),
            hash: this.hash ?? null,
            size: this.size ?? null,
            uploader: this.uploaderRef ? NoxIdentifier.parse(this.uploaderRef).toString(address) : null,
            mods: this.modRefs.map(ref => NoxIdentifier.parse(ref).toString(address)),
            features: this.features ?? []
        };
    }
}
