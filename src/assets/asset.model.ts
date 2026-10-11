import type { AssetModel } from '@/generated/prisma/models/Asset';
import type { AssetService } from '@/assets/asset.service';
import type { IAssetProvider } from '@/assets/asset-provider.interface';
import type { UserWithMethods } from '@/users/user.model';
import type { IApiAsset, ISanitizeOptions } from '@/assets/asset.types';

export type AssetWithMethods = AssetModel & {
  manager: AssetService;
  context: any;
  getProvider(): IAssetProvider;
  sanitize(
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiAsset>;
};

export class Asset {
  static attach(
    model: AssetModel,
    manager: AssetService,
    context: any,
  ): AssetWithMethods {
    const obj = model as unknown as AssetWithMethods;
    Object.defineProperty(obj, 'manager', {
      value: manager,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(obj, 'context', {
      value: context,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.setPrototypeOf(obj, Asset.prototype);
    return obj;
  }

  getProvider(this: AssetWithMethods): IAssetProvider {
    return this.manager.getProviderById(this.provider, this.type);
  }

  sanitize(
    this: AssetWithMethods,
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiAsset> {
    return this.getProvider().sanitizeAsset(this, viewer, options);
  }
}
