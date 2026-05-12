// ── WebFinger (RFC 7033) ──────────────────────────────────────────────────────

export interface WebFingerLink {
    rel: string;
    type?: string;
    href?: string;
    template?: string;
    titles?: Record<string, string>;
    properties?: Record<string, string | null>;
}

/** JRD document returned by /.well-known/webfinger */
export interface WebFingerDocument {
    subject: string;
    aliases?: string[];
    properties?: Record<string, string | null>;
    links: WebFingerLink[];
}

// ── NodeInfo 2.1 (https://nodeinfo.diaspora.software/ns/schema/2.1) ──────────

export interface NodeInfoSoftware {
    name: string;
    version: string;
    repository?: string;
    homepage?: string;
}

export interface NodeInfoUsage {
    users: {
        total: number;
        activeMonth: number;
        activeHalfyear: number;
    };
    localPosts: number;
    localComments?: number;
}

export interface NodeInfoDocument {
    version: '2.1';
    software: NodeInfoSoftware;
    protocols: string[];
    usage: NodeInfoUsage;
    openRegistrations: boolean;
    metadata?: Record<string, unknown>;
}

/** /.well-known/nodeinfo — links index */
export interface NodeInfoLinks {
    links: Array<{ rel: string; href: string }>;
}

// ── Nox custom well-known ─────────────────────────────────────────────────────
// Mix of /.well-known/nox (instance discovery) and /api/server (server info).
// Reference: https://nox.hactazia.fr/.well-known/nox + https://nox.hactazia.fr/api/server

export interface NoxGateway {
    /** HTTP/HTTPS base URL — e.g. https://example.com */
    web: string;
    /** WebSocket URL — e.g. wss://example.com/api/ws */
    ws: string;
    /** Public REST API base URL — e.g. https://example.com/api/ */
    api: string;
}

export interface NoxEndpoints {
    /** URL of this well-known document */
    wellknown: string;
    /** WebFinger template URL with {uri} placeholder */
    webfinger: string;
    /** NodeInfo links document URL */
    nodeinfo: string;
    /** URL of the server's Configuration */
    configs: string;
    /* Additional endpoints can be added here in the future */
    [key: string]: string;
}

export interface NoxVersions {
    /** Node.js runtime version */
    node: string;
    /** Terms of service document version */
    terms: string;
    /** Privacy policy document version */
    privacy: string;
    /** Rules document version */
    rules: string;
}

export interface NoxSoftware {
    name: string;
    version: string;
}

export type NoxSocials = Record<string, string | string[]>;

/** A field that is either a plain string or a locale→string map. */
export type NoxLocalizedString = string | Record<string, string>;

export interface NoxMetadata {
    title: NoxLocalizedString;
    description: NoxLocalizedString | null;
    /**
     * Instance icon. Either:
     * - `string` — single icon URL
     * - `Record<string, string>` — theme-keyed map, e.g. `{ default: "url", dark: "url" }`
     * - `null` — no icon set
     */
    icon: string | Record<string, string> | null;
    contact: string | null;
    socials: NoxSocials;
}

export interface NoxWellKnown {
    /**
     * Unique identifier for this specific node within a cluster.
     * Multiple nodes can share the same `address` (public domain) behind a load balancer;
     * `id` disambiguates which node actually responded — useful for debugging and monitoring.
     * It is not related to domain migration.
     */
    id: string;
    /* Informations about the server software, e.g. { name: "nox", version: "1.0.0" } */
    software: NoxSoftware;
    /* Status of the instance: "online", "maintenance", or "degraded" (e.g. partial outage) */
    status: 'online' | 'maintenance' | 'degraded';
    /* Unix timestamp (ms) when the instance started */
    started: number;
    /** PEM-encoded RSA public key of this node — used for server-to-server authentication. */
    public: string;
    /** Domain of this instance (without protocol), e.g. "example.com" */
    address: string;
    /** HTTP port the server listens on */
    port: number;
    gateway: NoxGateway;
    endpoints: NoxEndpoints;
    versions: NoxVersions;
    metadata: NoxMetadata;
    /** Enabled feature modules — e.g. ["user", "world", "avatar", "instance", "server"] */
    features: string[];
    /** Federation protocols — e.g. ["activitypub"] */
    capabilities: string[];
    maintenance: string | null;
}
