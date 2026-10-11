import type { AnalyzedAssetBundle } from '@/utils/assetbundle';
import type { IAnalysed } from '@/assets/asset.types';
import { analyzeAvatarAsset } from '@/assets/avatars/avatar-utils';
import { analyzeWorldAsset } from '@/assets/worlds/world-utils';

/** Context handed to a per-type validator after the bundle has been analyzed. */
export interface UploadValidationContext {
  /** Asset type being uploaded (e.g. `mod`, `avatar`, `world`). */
  type: string;
  /** Slot attributes as a `key → value` map (e.g. `platform`, `arch`, `engine`). */
  attributes: Record<string, string>;
}

/**
 * Type-specific descriptor validator.
 * Must throw a descriptive `Error` when the analyzed bundle is not acceptable.
 * May return an {@link IAnalysed} result (e.g. avatar performance stats) which
 * is then exposed on the file as `analysis`; `null`/`void` means "no analysis".
 */
export type UploadValidator = (
  analyzed: AnalyzedAssetBundle,
  context: UploadValidationContext,
) => IAnalysed | null | void;

const validators = new Map<string, UploadValidator>();

/** Registers (or replaces) the descriptor validator for an asset type. */
export function registerUploadValidator(
  type: string,
  validator: UploadValidator,
): void {
  validators.set(type, validator);
}

/** Returns the descriptor validator registered for a type, if any. */
export function getUploadValidator(type: string): UploadValidator | undefined {
  return validators.get(type);
}

// ── Built-in type validators ───────────────────────────────────────────────────
// These mirror the checks performed by the avatar/world upload processors. They
// only run their descriptor comparison when the slot advertises an expected
// engine/platform; the generic bundle analysis always runs regardless.

registerUploadValidator('avatar', (analyzed, context) => {
  const engine = context.attributes.engine?.split(':')[0];
  const platform = context.attributes.platform;
  if (!engine || !platform) return null;
  const info = analyzeAvatarAsset(analyzed, engine, platform);
  return {
    engine: info.engine,
    platform: info.platform,
    descriptors: info.descriptorCount,
  };
});

registerUploadValidator('world', (analyzed, context) => {
  const engine = context.attributes.engine?.split(':')[0];
  const platform = context.attributes.platform;
  if (!engine || !platform) return null;
  const info = analyzeWorldAsset(analyzed, engine, platform);
  return {
    engine: info.engine,
    platform: info.platform,
    descriptors: info.descriptorCount,
  };
});
