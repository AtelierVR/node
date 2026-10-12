import type { ReleaseUploadRules } from '@/assets/asset.types';
import { getAssetRegistrations } from '@/assets/asset-controller.registry';
import { uploadRules } from '@/assets/upload/upload-rules';

/**
 * Public description of an asset kind, published by the instance config
 * (`GET /configs`, `assets`): what the kind is called in the payloads, how it is
 * addressed as a Nox identifier, which route serves it, and the upload rules its
 * files are held to.
 */
export interface AssetConfig {
  /** Asset type, as used by the asset payloads (`avatar`, `world`, `mod`). */
  type: string;
  /** Nox identifier type letter (`a`, `w`, `m`). */
  key: string;
  /** Route segment of the asset endpoints (`avatars`, `worlds`, `mods`). */
  endpoint: string;
  /** Rules enforced on the files of this kind; `{}` when it accepts anything. */
  rules: ReleaseUploadRules;
}

/**
 * Every registered asset kind, in registration order (`@AssetController`), with
 * the rules its uploads are held to.
 */
export function assetConfigs(): AssetConfig[] {
  return getAssetRegistrations().map((registration) => ({
    ...registration,
    rules: uploadRules(registration.type),
  }));
}
