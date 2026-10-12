const assetControllerTypes = new Set<string>();
const assetControllerEndpoints = new Map<string, string>();
const assetControllerKeys = new Map<string, string>();

/** A registered asset kind: its type, its Nox identifier key and its endpoint. */
export interface AssetRegistration {
  /** Asset type, as used by the asset payloads (`avatar`, `world`, `mod`). */
  type: string;
  /** Nox identifier type letter (`a`, `w`, `m`). */
  key: string;
  /** Route segment of the asset endpoints (`avatars`, `worlds`, `mods`). */
  endpoint: string;
}

export function registerAssetControllerType(
  type: string,
  endpoint?: string,
  key?: string,
): void {
  assetControllerTypes.add(type);
  if (endpoint) assetControllerEndpoints.set(type, endpoint);
  if (key) assetControllerKeys.set(type, key);
}

export function getAssetControllerTypes(): string[] {
  return [...assetControllerTypes];
}

/** Route segment (e.g. `mods`) registered for an asset type, or null when unknown. */
export function getAssetEndpoint(type: string): string | null {
  return assetControllerEndpoints.get(type) ?? null;
}

/** Nox identifier type letter (e.g. `m`) registered for an asset type, or null. */
export function getAssetKey(type: string): string | null {
  return assetControllerKeys.get(type) ?? null;
}

/**
 * Every registered asset kind, in registration order. Types registered without
 * an endpoint or a key (only possible outside `@AssetController`) are skipped.
 */
export function getAssetRegistrations(): AssetRegistration[] {
  const registrations: AssetRegistration[] = [];
  for (const type of assetControllerTypes) {
    const endpoint = assetControllerEndpoints.get(type);
    const key = assetControllerKeys.get(type);
    if (endpoint && key) 
      registrations.push({ type, key, endpoint });
  }
  return registrations;
}
