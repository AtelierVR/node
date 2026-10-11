/**
 * Static helpers and constants for working with Nox tags.
 *
 * A tag is always `"<prefix>:<value>"` — the prefix is exactly 3 lowercase letters
 * and the value is a non-empty lowercase snake_case token (e.g. `sys:persistent`,
 * `usr:developer`, `sys:can_external_fetch`). There is no such thing as a bare
 * (prefix-less) tag.
 */
export class Tags {
  /** Separator between a tag prefix (namespace) and its value. */
  static readonly SEPARATOR = ':';

  // ── Prefixes (namespaces) ───────────────────────────────────────────────

  /** User-owned tags (`usr:*`). */
  static readonly USER = 'usr';
  /** System tags (`sys:*`). */
  static readonly SYSTEM = 'sys';
  /** Default-namespace tags (`dft:*`). */
  static readonly DEFAULT = 'dft';
  /** Admin tags (`adm:*`). */
  static readonly ADMIN = 'adm';

  // ── Groups ──────────────────────────────────────────────────────────────

  /** Every known prefix. */
  static readonly ALL: readonly string[] = [
    Tags.USER,
    Tags.SYSTEM,
    Tags.DEFAULT,
    Tags.ADMIN,
  ];

  /** Moderation prefixes — admin, system and default. */
  static readonly MODERATION: readonly string[] = [
    Tags.ADMIN,
    Tags.SYSTEM,
    Tags.DEFAULT,
  ];

  /**
   * Prefixes reserved for the system — clients must never be able to set these
   * (e.g. `sys:unlimited`, `adm:ban`), otherwise they could spoof internal flags
   * or grant themselves permissions.
   */
  static readonly RESERVED_PREFIXES: readonly string[] = Tags.MODERATION;

  /**
   * Canonical tag shape: exactly 3 lowercase letters, a separator, then a non-empty
   * lowercase snake_case value.
   */
  static readonly PATTERN = /^[a-z]{3}:[a-z_]+$/;

  /** True when `tag` matches the canonical `<prefix>:<value>` shape. */
  static isValid(tag: unknown): tag is string {
    return typeof tag === 'string' && Tags.PATTERN.test(tag);
  }

  /** Split a *valid* tag into `{ prefix, value }` — does not validate. */
  private static split(tag: string): { prefix: string; value: string } {
    const idx = tag.indexOf(Tags.SEPARATOR);
    return { prefix: tag.slice(0, idx), value: tag.slice(idx + 1) };
  }

  /**
   * Split a tag into `{ prefix, value }`.
   *
   * @throws {Error} when `tag` does not match {@link Tags.PATTERN}.
   */
  static parse(tag: string): { prefix: string; value: string } {
    if (!Tags.isValid(tag)) throw new Error(`Invalid tag: "${tag}"`);
    return Tags.split(tag);
  }

  /** Build `"<prefix>:<value>"`. */
  static build(prefix: string, value: string): string {
    return `${prefix}${Tags.SEPARATOR}${value}`;
  }

  /**
   * Normalise the `prefixes` argument into a list of prefixes. An empty list means
   * "no restriction" (any prefix) — this is what an omitted argument resolves to.
   */
  private static toList(
    prefixes?: string | readonly string[] | null,
  ): string[] {
    if (prefixes == null) return [];
    return typeof prefixes === 'string' ? [prefixes] : [...prefixes];
  }

  /**
   * True when `tag` has the given `value`, optionally restricted to one of `prefixes`.
   *
   * - `prefixes` omitted / `[]` → any prefix.
   * - `prefixes` non-empty      → only those prefixes (a group works too).
   *
   * Invalid tags never match (no throw).
   *
   * @example
   *   Tags.is('sys:persistent', Tags.SYSTEM, 'persistent')     // true
   *   Tags.is('usr:persistent', Tags.SYSTEM, 'persistent')     // false
   *   Tags.is('adm:persistent', Tags.MODERATION, 'persistent') // true
   *   Tags.is('usr:persistent', Tags.ALL, 'persistent')        // true
   */
  static is(
    tag: string,
    prefixes: string | readonly string[] | null | undefined,
    value: string,
  ): boolean {
    if (!Tags.isValid(tag)) return false;

    const { prefix, value: parsedValue } = Tags.split(tag);
    if (parsedValue !== value) return false;

    const list = Tags.toList(prefixes);
    if (list.length === 0) return true;
    return list.includes(prefix);
  }

  /**
   * True when any tag in `tags` satisfies {@link Tags.is}.
   *
   * Accepts a single prefix, a list of prefixes, or one of the groups
   * ({@link Tags.ALL}, {@link Tags.MODERATION}).
   *
   * @example
   *   Tags.has(['usr:pvp', 'sys:persistent'], Tags.SYSTEM, 'persistent') // true
   *   Tags.has(['usr:pvp', 'adm:ban'],       Tags.MODERATION, 'ban')     // true
   *   Tags.has(['usr:hide_followers'],       Tags.ALL, 'hide_followers') // true
   */
  static has(
    tags: readonly string[] | null | undefined,
    prefixes: string | readonly string[] | null | undefined,
    value: string,
  ): boolean {
    return (tags ?? []).some((t) => Tags.is(t, prefixes, value));
  }

  /** True when the tag belongs to a system-reserved prefix. */
  static isReserved(tag: string): boolean {
    return (
      Tags.isValid(tag) &&
      Tags.RESERVED_PREFIXES.includes(Tags.split(tag).prefix)
    );
  }

  /** Keep only the valid tags whose prefix is in `prefixes`. */
  static withPrefix(
    tags: readonly string[] | null | undefined,
    prefixes: string | readonly string[] | null | undefined,
  ): string[] {
    const list = Tags.toList(prefixes);
    return (tags ?? []).filter(
      (t) => Tags.isValid(t) && list.includes(Tags.split(t).prefix),
    );
  }

  /** Drop the tags whose prefix is in `prefixes` (invalid tags are kept). */
  static withoutPrefix(
    tags: readonly string[] | null | undefined,
    prefixes: string | readonly string[] | null | undefined,
  ): string[] {
    const list = Tags.toList(prefixes);
    return (tags ?? []).filter(
      (t) => !Tags.isValid(t) || !list.includes(Tags.split(t).prefix),
    );
  }
}
