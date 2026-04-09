import { WorldAssetModel } from 'src/generated/prisma/models/WorldAsset';
import type { ApiWorldAsset } from './worlds.types';

export type WorldAssetWithMethods = WorldAssetModel & {
    sanitize(): ApiWorldAsset;
    isEmpty(): boolean;
};

export class WorldAsset {
    static attach(model: WorldAssetModel): WorldAssetWithMethods {
        const obj = model as unknown as WorldAssetWithMethods;
        Object.setPrototypeOf(obj, WorldAsset.prototype as any);
        return obj;
    }

    isEmpty(this: WorldAssetWithMethods): boolean {
        return this.hash === null && this.url === null;
    }

    sanitize(this: WorldAssetWithMethods): ApiWorldAsset {
        return {
            id: this.id,
            version: this.version,
            engine: this.engine,
            platform: this.platform,
            is_empty: this.isEmpty(),
            url: this.url ?? null,
            hash: this.hash ?? null,
            size: this.size ?? null,
            mods: this.modRefs ?? [],
            features: this.features ?? [],
            uploader: this.uploaderRef ?? null,
        };
    }
}
