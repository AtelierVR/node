import { AvatarAssetModel } from 'src/generated/prisma/models/AvatarAsset';
import type { ApiAvatarAsset } from './avatars.types';
import { AvatarsService } from './avatars.service';
import { NoxIdentifier } from 'src/common/identifier';

export type AvatarAssetWithMethods = AvatarAssetModel & {
    manager: AvatarsService;
    sanitize(): Promise<ApiAvatarAsset>;
    isEmpty(): boolean;
};

export class AvatarAsset {
    static attach(model: AvatarAssetModel, manager: AvatarsService): AvatarAssetWithMethods {
        const obj = model as unknown as AvatarAssetWithMethods;
        obj.manager = manager;
        Object.setPrototypeOf(obj, AvatarAsset.prototype as any);
        return obj;
    }

    isEmpty(this: AvatarAssetWithMethods): boolean {
        return this.hash === null && this.url === null;
    }

    async sanitize(this: AvatarAssetWithMethods): Promise<ApiAvatarAsset> {
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
            mods: [], //this.modRefs.map(ref => NoxIdentifier.parse(ref).toString(address)),
            features: this.features
        };
    }
}
