import type { AssetReleaseModel } from '@/generated/prisma/models/AssetRelease';
import type { AssetService } from '@/assets/asset.service';
import type { AssetWithMethods } from '@/assets/asset.model';
import type { AssetFileWithMethods } from '@/assets/asset-file.model';
import type {
  IApiRelease,
  IRelease,
  ISanitizeOptions,
  IStatus,
} from '@/assets/asset.types';
import { parseProcessStatus } from '@/assets/asset.types';
import type { UserWithMethods } from '@/users/user.model';

export type AssetReleaseWithMethods = AssetReleaseModel &
  IRelease & {
    manager: AssetService;
    context: any;
    files: AssetFileWithMethods[];
    getAsset(): AssetWithMethods;
    sanitize(
      viewer?: UserWithMethods,
      options?: ISanitizeOptions,
    ): Promise<IApiRelease>;
  };

export class AssetRelease {
  static attach(
    model: AssetReleaseModel,
    manager: AssetService,
    context: any,
  ): AssetReleaseWithMethods {
    const obj = model as unknown as AssetReleaseWithMethods;
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
    Object.setPrototypeOf(obj, AssetRelease.prototype);
    return obj;
  }

  getAsset(this: AssetReleaseWithMethods): AssetWithMethods {
    const context = this.context as { asset?: AssetWithMethods };
    const asset = context.asset;
    if (!asset) throw new Error('Asset release context has no parent asset');
    return asset;
  }

  /**
   * Provider-dependent build status, read from the release metadata.
   * Returns null when the provider does not track any status (e.g. releases
   * mirrored from an external source that are already published).
   */
  get status(): IStatus | null {
    return parseProcessStatus(
      (this as unknown as AssetReleaseWithMethods).metadata,
    );
  }

  sanitize(
    this: AssetReleaseWithMethods,
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiRelease> {
    return this.getAsset().getProvider().sanitizeRelease(this, viewer, options);
  }
}
