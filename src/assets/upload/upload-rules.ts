import type { ReleaseUploadRules } from '@/assets/asset.types';

/**
 * Upload rules: what a release accepts.
 *
 * The rules are declared **per asset type**, in code — see the defaults at the
 * bottom of this file — and enforced by the server: `UploadProvider` checks them
 * when a slot is reserved (`POST …/files`) and again when its bytes are stored
 * (`PUT …/files/{id}`), throwing a `400` on a missing `required` attribute or on
 * a `unique` group already held by another file.
 *
 * They are not part of the asset/release payloads: clients discover them through
 * the public instance config (`GET /configs`, `assets[].rules`).
 */

const defaults = new Map<string, ReleaseUploadRules>();

/** Declares the default rules of an asset type (replaces the previous ones). */
export function registerUploadRules(
  type: string,
  rules: ReleaseUploadRules,
): void {
  defaults.set(type, normalizeUploadRules(rules));
}

/** Default rules of an asset type, if it declares any. */
export function defaultUploadRules(type: string): ReleaseUploadRules | null {
  return defaults.get(type) ?? null;
}

/** Attribute keys are compared trimmed and lower-cased. */
function normalizeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLocaleLowerCase();
  return key.length > 0 ? key : null;
}

/** Drops the empty entries of a rule set, so `{}` means "no restriction". */
export function normalizeUploadRules(
  rules: ReleaseUploadRules,
): ReleaseUploadRules {
  const required = (rules.required ?? [])
    .map(normalizeKey)
    .filter((key): key is string => key !== null);
  const unique = (rules.unique ?? [])
    .map((group) =>
      (Array.isArray(group) ? group : [])
        .map(normalizeKey)
        .filter((key): key is string => key !== null),
    )
    .filter((group) => group.length > 0);
  return {
    ...(required.length > 0 ? { required } : {}),
    ...(unique.length > 0 ? { unique } : {}),
  };
}

/** Rules in effect for an asset type; `{}` when the type accepts anything. */
export function uploadRules(type: string): ReleaseUploadRules {
  return defaults.get(type) ?? {};
}


/** True when the rule set restricts nothing. */
export function isUploadRulesEmpty(rules: ReleaseUploadRules): boolean {
  return !rules.required?.length && !rules.unique?.length;
}

/** Required attribute keys the file does not declare, in declaration order. */
export function missingAttributes(
  rules: ReleaseUploadRules,
  attributes: ReadonlyMap<string, string>,
): string[] {
  return (rules.required ?? []).filter((key) => !attributes.has(key));
}

/**
 * Attribute values of the `group` that a file must share to be a duplicate:
 * every key of the group has to be declared, with the same value
 * (case-insensitively, like the attribute filters).
 */
export function duplicateAttributes(
  group: readonly string[],
  attributes: ReadonlyMap<string, string>,
): Array<{ key: string; value: string }> | null {
  const pairs: Array<{ key: string; value: string }> = [];
  for (const key of group) {
    const value = attributes.get(key);
    if (value === undefined) return null;
    pairs.push({ key, value });
  }
  return pairs;
}

/** `key → value` map of a slot's attributes, keys lower-cased and trimmed. */
export function attributeMap(
  attributes: readonly { key: string; value: unknown }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const attribute of attributes) {
    const key = normalizeKey(attribute.key);
    if (key && typeof attribute.value === 'string')
      map.set(key, attribute.value.trim());
  }
  return map;
}

/** Human-readable summary of an attribute list (`platform=windows, engine=unity`). */
export function describeAttributes(
  attributes: readonly { key: string; value: string }[],
): string {
  return attributes.map(({ key, value }) => `${key}=${value}`).join(', ');
}

// ── Defaults ───────────────────────────────────────────────────────────────────
// A mod, an avatar and a world all ship **one bundle per platform+engine pair**:
// both attributes are required, and the pair stays unique within a release.

/** One file per `platform`+`engine` pair, both attributes mandatory. */
const BUNDLE_RULES: ReleaseUploadRules = {
  required: ['platform', 'engine'],
  unique: [['platform', 'engine']],
};

registerUploadRules('mod', BUNDLE_RULES);
registerUploadRules('avatar', BUNDLE_RULES);
registerUploadRules('world', BUNDLE_RULES);
