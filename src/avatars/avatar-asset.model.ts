import { AvatarAssetModel } from 'src/generated/prisma/models/AvatarAsset';
import type { ApiAvatarAsset } from './avatars.types';

export type AvatarAssetWithMethods = AvatarAssetModel & {
    sanitize(): ApiAvatarAsset;
    isEmpty(): boolean;
};

export class AvatarAsset {
    static attach(model: AvatarAssetModel): AvatarAssetWithMethods {
        const obj = model as unknown as AvatarAssetWithMethods;
        Object.setPrototypeOf(obj, AvatarAsset.prototype as any);
        return obj;
    }

    isEmpty(this: AvatarAssetWithMethods): boolean {
        return this.hash === null && this.url === null;
    }

    sanitize(this: AvatarAssetWithMethods): ApiAvatarAsset {
        return {
            id: this.id,
            version: this.version,
            engine: this.engine,
            platform: this.platform,
            is_empty: this.isEmpty(),
            url: this.url ?? null,
            hash: this.hash ?? null,
            size: this.size ?? null,
            features: this.features ?? [],
        };
    }
}
