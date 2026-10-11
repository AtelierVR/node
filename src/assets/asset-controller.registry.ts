const assetControllerTypes = new Set<string>();
const assetControllerEndpoints = new Map<string, string>();

export function registerAssetControllerType(
  type: string,
  endpoint?: string,
): void {
  assetControllerTypes.add(type);
  if (endpoint) assetControllerEndpoints.set(type, endpoint);
}

export function getAssetControllerTypes(): string[] {
  return [...assetControllerTypes];
}

/** Route segment (e.g. `mods`) registered for an asset type, or null when unknown. */
export function getAssetEndpoint(type: string): string | null {
  return assetControllerEndpoints.get(type) ?? null;
}
