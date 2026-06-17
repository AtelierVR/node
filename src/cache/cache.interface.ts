/**
 * Cache abstraction layer.
 *
 * Provides key-value storage with optional TTL and Pub/Sub messaging.
 * Used for: session caching, timeline precomputation, rate limiting,
 * cross-process WebSocket coordination.
 *
 * Implementations:
 *   - MemoryCacheProvider  — in-process Map (single-node dev)
 *   - RedisCacheProvider   — Redis-backed (multi-node production)
 *   - (future) MemcachedProvider, …
 */

// ── Pub/Sub message ──────────────────────────────────────────────────────────

export interface CacheMessage {
    channel: string;
    data: unknown;
    timestamp: number;
}

export type CacheSubscriber = (message: CacheMessage) => void;

// ── Atomic operations ────────────────────────────────────────────────────────

export interface AtomicOps {
    /** Increment a counter and return the new value. */
    incr(key: string, amount?: number): Promise<number>;
    /** Decrement a counter and return the new value. */
    decr(key: string, amount?: number): Promise<number>;
    /** Set key only if it does not already exist. Returns true if set. */
    setNX(key: string, value: unknown, ttlSeconds?: number): Promise<boolean>;
}

// ── The provider interface ───────────────────────────────────────────────────

export interface ICacheProvider {
    /** Provider name (e.g. "memory", "redis") */
    readonly name: string;

    /** Get a cached value, or null if not found / expired. */
    get<T = unknown>(key: string): Promise<T | null>;

    /** Set a key with optional TTL in seconds. */
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;

    /** Delete one or more keys. */
    del(...keys: string[]): Promise<void>;

    /** Check if a key exists and is not expired. */
    exists(key: string): Promise<boolean>;

    /** Get the remaining TTL in seconds, -1 if no TTL, -2 if not found. */
    ttl(key: string): Promise<number>;

    /** Delete all keys matching a glob pattern. */
    clearPattern(pattern: string): Promise<void>;

    /** Publish a message to a channel. */
    publish(channel: string, data: unknown): Promise<void>;

    /** Subscribe to a channel. Returns an unsubscribe function. */
    subscribe(channel: string, handler: CacheSubscriber): Promise<() => void>;

    /** Atomic counter / lock operations. */
    atomic: AtomicOps;

    /** Check backend connectivity. */
    isHealthy(): Promise<boolean>;

    /** Gracefully shut down. */
    shutdown(): Promise<void>;
}
