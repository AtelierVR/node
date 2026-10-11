import type { AssetFileModel } from '@/generated/prisma/models/AssetFile';
import type { AssetService } from '@/assets/asset.service';
import type { AssetReleaseWithMethods } from '@/assets/asset-release.model';
import type {
  IApiFile,
  IAnalysed,
  IFile,
  ISanitizeOptions,
  IStatus,
} from '@/assets/asset.types';
import { parseAnalysis, parseProcessStatus } from '@/assets/asset.types';
import type { UserWithMethods } from '@/users/user.model';

export type AssetFileWithMethods = AssetFileModel &
  IFile & {
    manager: AssetService;
    context: any;
    getRelease(): AssetReleaseWithMethods;
    sanitize(
      viewer?: UserWithMethods,
      options?: ISanitizeOptions,
    ): Promise<IApiFile>;
  };

export class AssetFile {
  static attach(
    model: AssetFileModel,
    manager: AssetService,
    context: any,
  ): AssetFileWithMethods {
    const obj = model as unknown as AssetFileWithMethods;
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
    Object.setPrototypeOf(obj, AssetFile.prototype);
    return obj;
  }

  getRelease(this: AssetFileWithMethods): AssetReleaseWithMethods {
    const context = this.context as { release?: AssetReleaseWithMethods };
    const release = context.release;
    if (!release) throw new Error('Asset file context has no parent release');
    return release;
  }

  /**
   * Provider-dependent processing status, read from the file metadata.
   * Returns null when the provider does not track any status (e.g. published
   * files mirrored from an external source).
   */
  get status(): IStatus | null {
    return parseProcessStatus(
      (this as unknown as AssetFileWithMethods).metadata,
    );
  }

  /**
   * Result of the type-specific analysis/validation, read from the file
   * metadata (`metadata.analysis`). Null when the provider has no analyser.
   */
  get analysis(): IAnalysed | null {
    return parseAnalysis((this as unknown as AssetFileWithMethods).metadata);
  }

  sanitize(
    this: AssetFileWithMethods,
    viewer?: UserWithMethods,
    options?: ISanitizeOptions,
  ): Promise<IApiFile> {
    return this.getRelease()
      .getAsset()
      .getProvider()
      .sanitizeFile(this, viewer, options);
  }
}
