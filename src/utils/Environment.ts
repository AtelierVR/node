import type { PrismaClient } from "@prisma/client";
import { join } from "path";
import { hash } from "./Utils";
import { cwd } from "process";
import Debug from "./Debug";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Definition of a single configuration entry. */
export interface ConfigDefinition<T = unknown> {
    /** Environment variable name (UPPER_CASE) */
    key: string;
    /** Human-readable label */
    label: string;
    /** Optional longer description */
    description?: string;
    /**
     * Default value (or a zero-argument function that computes it dynamically).
     * Passed through `convert` when neither env nor DB provides a value.
     */
    default: string | (() => string);
    /** Convert a raw string value to the typed value. */
    convert(value: string): T;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Read a raw env var, stripping the `!` force prefix if present.
 * Falls back to `fallback` when the variable is absent or empty.
 * Used inside `default` lambdas to avoid circular type references.
 */
const rawEnv = (key: string, fallback = ''): string => {
    const v = process.env[key];
    if (!v) return fallback;
    return v.startsWith('!') ? v.slice(1) : v;
};

const tryJson =
    <T>(fallback: T) =>
        (v: string): T => {
            if (!v || v.trim() === '') return fallback;
            try {
                return JSON.parse(v) as T;
            } catch {
                Debug.error('[Env] Failed to parse JSON config value:', v);
                return fallback;
            }
        };

const splitList = (v: string): string[] =>
    v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

const toBool = (v: string): boolean => ['1', 'yes', 'on', 'true'].includes(v.toLowerCase());
const toNumber = (v: string): number => parseInt(v, 10);
const toPath = (v: string): string => join(cwd(), v);
const toString = (v: string): string => v;

// ─── Config Definitions ───────────────────────────────────────────────────────

/**
 * Master list of all configuration entries.
 *
 * Each entry describes one environment variable that can optionally be
 * overridden at runtime via the `Config` database table.
 */
export const CONFIG_DEFINITIONS = [
    {
        key: 'ADMIN_ID',
        label: 'Admin User ID',
        description: 'Numeric database ID of the admin user (created on first start).',
        default: '1',
        convert: toNumber,
    },
    {
        key: 'ADMIN_USERNAME',
        label: 'Admin Username',
        default: 'admin',
        convert: toString,
    },
    {
        key: 'ADMIN_DISPLAY',
        label: 'Admin Display Name',
        default: 'Admin',
        convert: toString,
    },
    {
        key: 'ADMIN_PASSWORD',
        label: 'Admin Password',
        description: 'Plain-text password — stored as a SHA-256 hash internally.',
        default: '',
        convert: (v): string | undefined => (v ? hash(v) : undefined),
    },
    {
        key: 'CONTACT',
        label: 'Contact Address',
        description: 'Shown in /.well-known/nox. Defaults to <ADMIN_ID>@<ADDRESS>.',
        default: () => `${rawEnv('ADMIN_ID', '1')}@${rawEnv('ADDRESS', `localhost:${rawEnv('NODE_PORT', '53032')}`)}`,
        convert: toString,
    },
    {
        key: 'CAN_REGISTER',
        label: 'Allow Registration',
        description: 'Set to "true" to allow new users to self-register.',
        default: 'false',
        convert: toBool,
    },
    {
        key: 'HIDE_IP',
        label: 'Hide Client IPs',
        description: 'Set to "true" to redact client IP addresses from logs.',
        default: 'false',
        convert: toBool,
    },
    {
        key: 'CUSTOM_CORS',
        label: 'Custom CORS Configuration',
        description: 'JSON object mapping URL path prefixes to cors() option objects.',
        default: '{}',
        convert: tryJson<Record<string, unknown>>({}),
    },
    {
        key: 'IGNORE_LOG_PATHS',
        label: 'Ignored Log Paths',
        description: 'Comma-separated URL paths to exclude from access logs.',
        default: '',
        convert: splitList,
    },
    {
        key: 'SESSION_EXPIRATION',
        label: 'Session Expiration (ms)',
        description: 'How long a session stays valid, in milliseconds.',
        default: '2592000000',
        convert: toNumber,
    },
    {
        key: 'UPLOAD_TIMEOUT',
        label: 'Upload Timeout (ms)',
        description: 'Maximum duration for a file upload request, in milliseconds.',
        default: '300000',
        convert: toNumber,
    },
    {
        key: 'MAX_FILE_SIZE',
        label: 'Max Upload File Size (bytes)',
        default: '104857600',
        convert: toNumber,
    },
    {
        key: 'MAX_FIELD_SIZE',
        label: 'Max Form Field Size (bytes)',
        default: '1048576',
        convert: toNumber,
    },
    {
        key: 'MAX_FILES',
        label: 'Max Files Per Upload',
        default: '10',
        convert: toNumber,
    },
    {
        key: 'DOCKER_OPTIONS',
        label: 'Docker Connection Options',
        description: 'JSON options passed to the Dockerode constructor.',
        default: '{}',
        convert: tryJson<object>({}),
    },
    {
        key: 'DOCKER_IMAGE',
        label: 'Relay Docker Image',
        default: 'noxrelay',
        convert: toString,
    },
    {
        key: 'DOCKER_NETWORK',
        label: 'Docker Network',
        default: 'nox_default',
        convert: toString,
    },
    {
        key: 'DOCKER_ADDRESS',
        label: 'Docker Gateway Address',
        default: '127.0.0.1',
        convert: toString,
    },
    {
        key: 'RELAY_MAX_COUNT',
        label: 'Max Relay Count',
        default: '10',
        convert: toNumber,
    },
    {
        key: 'RELAY_MIN_PORT',
        label: 'Relay Min Port',
        default: '30000',
        convert: toNumber,
    },
    {
        key: 'RELAY_MAX_PORT',
        label: 'Relay Max Port',
        default: '40000',
        convert: toNumber,
    },
    {
        key: 'NODE_PORT',
        label: 'HTTP Server Port',
        default: '53032',
        convert: toNumber,
    },
    {
        key: 'ADDRESS',
        label: 'Public Address',
        description: 'host:port the server is reachable at. Defaults to localhost:<NODE_PORT>.',
        default: () => `localhost:${rawEnv('NODE_PORT', '53032')}`,
        convert: toString,
    },
    {
        key: 'GATEWAY',
        label: 'API Gateway',
        description: 'host:port for the HTTP API gateway. Defaults to ADDRESS.',
        default: () => rawEnv('ADDRESS', `localhost:${rawEnv('NODE_PORT', '53032')}`),
        convert: toString,
    },
    {
        key: 'WEB_GATEWAY',
        label: 'Web Gateway URL',
        description: 'Full URL of the web front-end. Defaults to http(s)://GATEWAY.',
        default: () => {
            const gw = rawEnv('GATEWAY', rawEnv('ADDRESS', `localhost:${rawEnv('NODE_PORT', '53032')}`));
            return `http${rawEnv('SECURE') === 'true' ? 's' : ''}://${gw}`;
        },
        convert: toString,
    },
    {
        key: 'TITLE',
        label: 'Server Title',
        default: 'Default Reileta Server',
        convert: toString,
    },
    {
        key: 'DESCRIPTION',
        label: 'Server Description',
        default: 'A server AtelierVR',
        convert: toString,
    },
    {
        key: 'ICON_URL',
        label: 'Server Icon URL',
        description: 'Absolute URL to the server icon. Defaults to <WEB_GATEWAY>/icon.png.',
        default: () => {
            const gw = rawEnv('GATEWAY', rawEnv('ADDRESS', `localhost:${rawEnv('NODE_PORT', '53032')}`));
            const wgw = rawEnv('WEB_GATEWAY', `http${rawEnv('SECURE') === 'true' ? 's' : ''}://${gw}`);
            return `${wgw}/icon.png`;
        },
        convert: toString,
    },
    {
        key: 'USE_SSL',
        label: 'Enable SSL / TLS',
        description: 'Set to "true" to serve HTTPS.',
        default: 'false',
        convert: toBool,
    },
    {
        key: 'SECURE',
        label: 'Mark as Secure (HTTPS)',
        description: 'Controls whether URLs are built with https://. Distinct from USE_SSL. Used with Nginx or other reverse proxies that handle TLS termination.',
        default: 'false',
        convert: toBool,
    },
    {
        key: 'PRIVATEKEY_FILE',
        label: 'Private Key File Path',
        default: 'certs/private.pem',
        convert: toPath,
    },
    {
        key: 'CERTIFICATE_FILE',
        label: 'Certificate File Path',
        default: 'certs/cert.pem',
        convert: toPath,
    },
    {
        key: 'DEFAULT_NETUSER_TAGS',
        label: 'Default NetUser Tags',
        description: 'Comma-separated tags assigned to all federated users.',
        default: '',
        convert: splitList,
    },
    {
        key: 'DEFAULT_USER_TAGS',
        label: 'Default User Tags',
        description: 'Comma-separated tags assigned to all local users.',
        default: '',
        convert: splitList,
    },
    {
        key: 'SUPPORTED_WORLD_ASSET_ENGINE',
        label: 'Supported World Asset Engines',
        description: 'Comma-separated list of accepted world-asset engine names.',
        default: '',
        convert: splitList,
    },
    {
        key: 'SUPPORTED_WORLD_ASSET_PLATFORM',
        label: 'Supported World Asset Platforms',
        description: 'Comma-separated list of accepted world-asset platform names.',
        default: '',
        convert: splitList,
    },
] as const satisfies readonly ConfigDefinition[];
/**
 * Union of all valid configuration keys.
 * Derived from `CONFIG_DEFINITIONS` — no manual map required.
 */
export type ConfigKey = (typeof CONFIG_DEFINITIONS)[number]['key'];

/**
 * Resolves the TypeScript type for config key `K` by extracting the
 * return type of its `convert` function.
 */
export type ConfigType<K extends ConfigKey> = ReturnType<
    Extract<(typeof CONFIG_DEFINITIONS)[number], { readonly key: K }>['convert']
>;
// ─── Env class ────────────────────────────────────────────────────────────────

/**
 * Static configuration class.
 *
 * ### Resolution order (for every key)
 * 1. **Forced env** — if `process.env[KEY]` starts with `!`, strip the `!` and
 *    use that value directly, skipping the DB lookup entirely.
 * 2. **DB override** — if a `Config` row exists for the key, use its `value`.
 * 3. **Env var** — if `process.env[KEY]` is a non-empty string, use it.
 * 4. **Default** — use the definition's `default` string.
 *
 * All four paths run through the definition's `convert()` function so the
 * returned type is always consistent.
 *
 * ### DB overrides
 * Call `Env.setDatabase(prismaClient)` after the database is ready.  Until
 * then `Env.get()` silently falls back to env / default (steps 3 / 4).
 *
 * ### Async vs sync
 * | Method | DB-aware | Notes |
 * |---|---|---|
 * | `Env.get('KEY')` | ✅ | async — checks DB row when available |
 * | `Env.sync('KEY')` | ❌ | sync — safe before DB is ready |
 * | `Env.KEY` | ✅ | static async getter, shorthand for `Env.get('KEY')` |
 * | `Env.getXxx()` | ❌ | sync convenience methods — backward compat |
 */
export class Env {
    private static _db: PrismaClient | null = null;

    /** All registered config definitions. */
    static readonly definitions: readonly ConfigDefinition[] = CONFIG_DEFINITIONS;

    // ─── Database injection ───────────────────────────────────────────────────

    /** Inject the Prisma client for DB-aware config resolution. */
    static setDatabase(db: PrismaClient): void {
        Env._db = db;
    }

    /** Remove the Prisma client (e.g. on graceful shutdown). */
    static unsetDatabase(): void {
        Env._db = null;
    }

    // ─── DB overrides ─────────────────────────────────────────────────────────

    /**
     * Persist a DB override for `key`.
     * If `value` is `null`, the override is deleted (falls back to env/default).
     */
    static async set(key: ConfigKey, value: string | null): Promise<void> {
        if (!Env._db) throw new Error('[Env] Database not available');
        if (value === null) {
            await Env._db.config.deleteMany({ where: { key } });
        } else await Env._db.config.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
    }

    /**
     * Delete a DB override for `key`, restoring env/default resolution.
     */
    static async delete(key: ConfigKey): Promise<void> {
        return Env.set(key, null);
    }

    /**
     * Return all current DB override rows.
     */
    static async listOverrides(): Promise<{ key: string; value: string }[]> {
        if (!Env._db) return [];
        return Env._db.config.findMany();
    }

    // ─── Core resolvers ───────────────────────────────────────────────────────

    /**
     * Resolve a config value asynchronously.
     * Checks the `Config` DB table when the database is available.
     */
    static async get<K extends ConfigKey>(key: K): Promise<ConfigType<K>> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const def = Env.definitions.find((d) => d.key === key) as ConfigDefinition<any> | undefined;
        if (!def) throw new Error(`[Env] Unknown config key: "${key}"`);

        const raw = (process.env as Record<string, string | undefined>)[key as string];

        // 1. Forced env — `!` prefix bypasses DB lookup
        if (raw !== undefined && raw.startsWith('!'))
            return def.convert(raw.slice(1)) as ConfigType<K>;

        // 2. DB override
        if (Env._db)
            try {
                const row = await Env._db.config.findUnique({ where: { key } });
                if (row !== null) return def.convert(row.value) as ConfigType<K>;
            } catch {
                // DB not ready or schema mismatch — fall through silently
            }

        // 3. Env var
        if (raw !== undefined && raw !== '')
            return def.convert(raw) as ConfigType<K>;

        // 4. Default
        const defaultValue = typeof def.default === 'function' ? def.default() : def.default;
        return def.convert(defaultValue) as ConfigType<K>;
    }

    /**
     * Resolve a config value **synchronously** from env / default only.
     * Safe to call before the database is available (e.g. during bootstrap).
     */
    static sync<K extends ConfigKey>(key: K): ConfigType<K> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const def = Env.definitions.find((d) => d.key === key) as ConfigDefinition<any> | undefined;
        if (!def) throw new Error(`[Env] Unknown config key: "${key}"`);

        const raw = (process.env as Record<string, string | undefined>)[key as string];
        const value = raw?.startsWith('!') ? raw.slice(1) : (raw !== '' ? raw : undefined);
        const defaultValue = typeof def.default === 'function' ? def.default() : def.default;
        return def.convert(value ?? defaultValue) as ConfigType<K>;
    }
}

export default Env;
