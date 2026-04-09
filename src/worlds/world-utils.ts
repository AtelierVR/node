import { AnalyzedAssetBundle, MonoBehaviourEntry, MonoScriptEntry, Platform } from '../utils/assetbundle';
import { NestLogger } from '../utils/logger';

export { checkValidAssetFile } from '../utils/assetbundle';

const logger = new NestLogger();
const CTX = 'WorldUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorldDescriptorInfo {
    platform: string;
    engine: string;
    descriptorCount: number;
}

const WORLD_DESCRIPTOR_NAMESPACE = 'Nox.CCK.Worlds';
const WORLD_DESCRIPTOR_CLASS = 'WorldDescriptor';

/**
 * Validates the analyzed bundle for a world asset:
 * - Engine must be "unity"
 * - Platform in bundle must match expected platform
 * - Engine in bundle must match expected engine
 * - At least one WorldDescriptor MonoBehaviour must exist
 *
 * Throws with a descriptive message on any mismatch.
 */
export function analyzeWorldAsset(
    data: AnalyzedAssetBundle,
    expectedEngine: string,
    expectedPlatform: string,
): WorldDescriptorInfo {
    logger.debug(`Analyzing world asset — engine: ${data.engine}, platform: ${data.platform}, name: ${data.name}`, CTX);

    if (data.engine !== 'unity')
        throw new Error(`Unsupported engine in bundle: "${data.engine}"`);

    // Build a map of path_id → { namespace, class } from MonoScript entries
    const classMap = new Map<number, { namespace: string; class: string }>();
    for (const mono of data.data.MonoScript ?? []) {
        if (mono.path_id && mono.raw_tree?.m_Namespace && mono.raw_tree?.m_ClassName)
            classMap.set(mono.path_id, {
                namespace: mono.raw_tree.m_Namespace,
                class: mono.raw_tree.m_ClassName,
            });
    }
    logger.debug(`MonoScript class map built — ${classMap.size} entries`, CTX);

    if (classMap.size === 0)
        throw new Error('No MonoScript classes found in asset bundle');

    // Find WorldDescriptor MonoBehaviours
    let descriptorCount = 0;
    for (const mb of data.data.MonoBehaviour ?? []) {
        const scriptPathId = mb.raw_tree?.m_Script?.m_PathID;
        if (scriptPathId == null) continue;
        const cls = classMap.get(scriptPathId);
        if (cls?.namespace === WORLD_DESCRIPTOR_NAMESPACE && cls?.class === WORLD_DESCRIPTOR_CLASS)
            descriptorCount++;
    }
    logger.debug(`WorldDescriptor count: ${descriptorCount}`, CTX);

    if (descriptorCount === 0)
        throw new Error('No WorldDescriptor found in asset bundle');

    // Resolve platform from numeric ID
    const bundlePlatform = Platform[data.platform] ?? null;
    logger.debug(`Platform resolution — id: ${data.platform}, resolved: ${bundlePlatform ?? 'unknown'}`, CTX);

    if (!bundlePlatform)
        throw new Error(`Unknown platform ID in bundle: ${data.platform}`);

    if (bundlePlatform !== expectedPlatform)
        throw new Error(`Platform mismatch: bundle is "${bundlePlatform}", asset expects "${expectedPlatform}"`);

    if (data.engine !== expectedEngine)
        throw new Error(`Engine mismatch: bundle is "${data.engine}", asset expects "${expectedEngine}"`);

    logger.debug(`World asset validated — platform: ${bundlePlatform}, engine: ${data.engine}, descriptors: ${descriptorCount}`, CTX);
    return { platform: bundlePlatform, engine: data.engine, descriptorCount };
}
