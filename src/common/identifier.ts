/**
 * Generic Nox identifier parser.
 *
 * Full format:  [<type>:]<id>[?<key>=<value>[&<key>=<value>]][@<server>]
 *
 * Known types:
 *   u  — User   (id = int32 | username)
 *   w  — World  (id = int32, query: v=<ushort> for asset version)
 *   i  — Instance (id = int32 | shortname, query: w=<base64 world>, p=<base64 password>)
 */

export type NoxIdentifierType = 'u' | 'w' | 'i';

export type NoxQuery = Record<string, string>;

export class NoxIdentifier {
  public static readonly LOCALSERVER = '::';
  public static readonly Invalid = new NoxIdentifier(null, '0');

  /** Maximum length of a serialized identifier (mirrors the DTO validator). */
  public static readonly MAX_LENGTH = 256;

  /** Charset for the id part: numeric id, username or world/instance shortname. */
  private static readonly ID_RE = /^[a-zA-Z0-9_.-]+$/;
  /** Charset for the `@server` part (hostname or the `::` local marker). */
  private static readonly SERVER_RE = /^[a-zA-Z0-9.:-]+$/;
  /** Charset for query keys. */
  private static readonly QUERY_KEY_RE = /^[a-zA-Z0-9_-]+$/;
  /** Charset for query values (base64 payloads use `+`, `/` and `=`). */
  private static readonly QUERY_VALUE_RE = /^[a-zA-Z0-9_.+/=-]+$/;

  readonly type: NoxIdentifierType | null;
  /** Raw string id: may be numeric string or alphanumeric name */
  readonly id: string;
  /** Remote server address, undefined means local */
  readonly server: string | undefined;
  readonly query: NoxQuery;

  static type(type: NoxIdentifierType | null, identifier: NoxIdentifier) {
    return new NoxIdentifier(
      type,
      identifier.id,
      identifier.server,
      identifier.query,
    );
  }

  constructor(
    type: NoxIdentifierType | null,
    id: string,
    server?: string,
    query?: NoxQuery,
  ) {
    this.type = type;
    this.id = id;
    this.server = server;
    this.query = query ?? {};
  }

  /**
   * Query flag helper: true when `key` is present with an empty value (`?key`)
   * or the literal `true` (`?key=true`).
   */
  hasFlag(key: string): boolean {
    if (!(key in this.query)) return false;
    const value = this.query[key];
    return value === '' || value === 'true';
  }

  /**
   * True when this identifier is well-formed: non-empty id, hostname-like server
   * (when present) and URL-safe query keys/values, within the length limit.
   *
   * {@link parse} is tolerant (an unknown type prefix is kept in the id), so client
   * input must be checked with this before being stored or re-serialized.
   */
  isValid(): boolean {
    if (!this.id || this.id.length > NoxIdentifier.MAX_LENGTH) return false;
    if (!NoxIdentifier.ID_RE.test(this.id)) return false;
    if (this.server !== undefined && !NoxIdentifier.SERVER_RE.test(this.server))
      return false;
    for (const [key, value] of Object.entries(this.query)) {
      if (!NoxIdentifier.QUERY_KEY_RE.test(key)) return false;
      if (value !== '' && !NoxIdentifier.QUERY_VALUE_RE.test(value))
        return false;
    }
    return this.toString().length <= NoxIdentifier.MAX_LENGTH;
  }

  /**
   * Parse a raw identifier string.
   * Tolerant: unknown type prefixes are kept as part of the id.
   */
  static parse(raw: string): NoxIdentifier {
    // Decode URL-encoded characters (e.g. %40 → @). The browser's fetch()
    // encodes reserved characters in URL paths, so the backend receives
    // e.g. "hactazia%40noxvr.org" instead of "hactazia@noxvr.org".
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* already decoded or malformed */
    }

    // 1. Extract @server suffix (last @ token that looks like a hostname)
    let server: string | undefined;
    const atIdx = raw.lastIndexOf('@');
    if (atIdx !== -1 && atIdx < raw.length - 1) {
      server = raw.slice(atIdx + 1);
      raw = raw.slice(0, atIdx);
    }

    // 2. Extract query string
    const query: NoxQuery = {};
    const qIdx = raw.indexOf('?');
    if (qIdx !== -1) {
      const qs = raw.slice(qIdx + 1);
      raw = raw.slice(0, qIdx);
      for (const pair of qs.split('&')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
          query[pair] = '';
        } else {
          query[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        }
      }
    }

    // 3. Extract type prefix (single char + colon)
    let type: NoxIdentifierType | null = null;
    const colonIdx = raw.indexOf(':');
    if (colonIdx === 1) {
      const prefix = raw[0];
      if (prefix === 'u' || prefix === 'w' || prefix === 'i') {
        type = prefix;
        raw = raw.slice(2);
      }
    }

    return new NoxIdentifier(type, raw, server, query);
  }

  /** Returns the id as a positive integer, or null if it is not a pure integer. */
  get numericId(): number | null {
    if (!/^\d+$/.test(this.id)) return null;
    const n = parseInt(this.id, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** True when no server is specified, or it matches the local address. */
  isLocal(localAddress?: string): boolean {
    return (
      this.server === undefined ||
      this.server === '' ||
      (localAddress !== undefined &&
        this.server === NoxIdentifier.LOCALSERVER) ||
      (localAddress !== undefined && this.server === localAddress)
    );
  }

  toString(fallbackServer: string | null = NoxIdentifier.LOCALSERVER): string {
    let s = '';
    if (this.type) s += `${this.type}:`;
    s += this.id;
    const qs = Object.entries(this.query)
      .map(([k, v]) => (v ? `${k}=${v}` : k))
      .join('&');
    if (qs) s += `?${qs}`;
    if (this.server && this.server !== NoxIdentifier.LOCALSERVER)
      s += `@${this.server}`;
    else if (fallbackServer) s += `@${fallbackServer}`;
    return s;
  }

  /** Returns true when two identifiers represent the same target. Set checkQuery to false to ignore query parameters. */
  equals(other: NoxIdentifier, checkQuery: boolean = true): boolean {
    return (
      this.type === other.type &&
      this.id === other.id &&
      (this.server ?? NoxIdentifier.LOCALSERVER) ===
        (other.server ?? NoxIdentifier.LOCALSERVER) &&
      (!checkQuery || this._queryEquals(other))
    );
  }

  private _queryEquals(other: NoxIdentifier): boolean {
    const keys = Object.keys(this.query);
    if (keys.length !== Object.keys(other.query).length) return false;
    return keys.every((k) => this.query[k] === other.query[k]);
  }
}
