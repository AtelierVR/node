import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import type { ICacheProvider, AtomicOps, CacheSubscriber } from '../cache.interface';

/**
 * Redis-backed cache provider.
 *
 * Full Pub/Sub across processes, atomic counters, key expiry managed by Redis.
 * Required for multi-node deployments where in-process memory is insufficient.
 *
 * Dependencies: ioredis (install separately when enabling this provider)
 */
@Injectable()
export class RedisCacheProvider implements ICacheProvider {
    readonly name = 'redis';

    private readonly logger = new Logger(RedisCacheProvider.name);
    private client: any = null;     // IORedis
    private subscriber: any = null; // Dedicated subscriber connection
    private initialized = false;

    constructor(private readonly config: AppConfigService) {}

    readonly atomic: AtomicOps = {
        incr: async (key, amount = 1) => {
            await this.ensureInit();
            return amount === 1
                ? await this.client.incr(key)
                : await this.client.incrby(key, amount);
        },
        decr: async (key, amount = 1) => {
            await this.ensureInit();
            return amount === 1
                ? await this.client.decr(key)
                : await this.client.decrby(key, amount);
        },
        setNX: async (key, value, ttlSeconds) => {
            await this.ensureInit();
            const serialized = JSON.stringify(value);
            if (ttlSeconds) {
                const result = await this.client.set(key, serialized, 'EX', ttlSeconds, 'NX');
                return result === 'OK';
            }
            const result = await this.client.setnx(key, serialized);
            return result === 1;
        },
    };

    private async ensureInit(): Promise<void> {
        if (this.initialized) return;

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const IORedis = require('ioredis').default || require('ioredis');
            const redisUrl = await this.config.get<string>('redis.url');

            this.client = new IORedis(redisUrl);
            this.subscriber = new IORedis(redisUrl);

            this.initialized = true;
            this.logger.log(`Redis connected to ${redisUrl}`);
        } catch (err) {
            this.logger.error('Failed to initialize Redis. Install ioredis, or set CACHE_PROVIDER=memory', err);
            throw err;
        }
    }

    /** ISO 8601 date string pattern (e.g. "2026-04-24T18:17:19.214Z") */
    private static readonly ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

    /**
     * JSON reviver that reconstructs Buffer and Date objects lost during
     * `JSON.stringify` → `JSON.parse` round-trip through Redis.
     */
    private static jsonReviver(_key: string, value: unknown): unknown {
        // ── Dates: ISO 8601 strings → Date ──────────────────────────────
        if (typeof value === 'string' && RedisCacheProvider.ISO_DATE_RE.test(value)) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) return d;
        }

        if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

        // ── Standard Node.js Buffer JSON: { type: 'Buffer', data: [...] } ──
        if ((value as any).type === 'Buffer' && Array.isArray((value as any).data))
            return Buffer.from((value as any).data);

        // ── Prisma byte-array format: { "0": 48, "1": 42, ... } ──────────
        const keys = Object.keys(value);
        if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
            const indices = keys.map(Number).sort((a, b) => a - b);
            if (indices[0] === 0 && indices[indices.length - 1] === indices.length - 1)
                return Buffer.from(indices.map(i => (value as Record<string, number>)[String(i)]));
        }

        return value;
    }

    async get<T = unknown>(key: string): Promise<T | null> {
        await this.ensureInit();
        const raw = await this.client.get(key);
        if (raw === null) return null;
        try { return JSON.parse(raw, RedisCacheProvider.jsonReviver) as T; } 
        catch { return raw as T; }
    }

    async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        await this.ensureInit();
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
            await this.client.setex(key, ttlSeconds, serialized);
        } else {
            await this.client.set(key, serialized);
        }
    }

    async del(...keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await this.ensureInit();
        await this.client.del(...keys);
    }

    async exists(key: string): Promise<boolean> {
        await this.ensureInit();
        return (await this.client.exists(key)) === 1;
    }

    async ttl(key: string): Promise<number> {
        await this.ensureInit();
        return await this.client.ttl(key);
    }

    async clearPattern(pattern: string): Promise<void> {
        await this.ensureInit();
        let cursor = '0';
        do {
            const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) await this.client.del(...keys);
        } while (cursor !== '0');
    }

    async publish(channel: string, data: unknown): Promise<void> {
        await this.ensureInit();
        await this.client.publish(channel, JSON.stringify(data));
    }

    async subscribe(channel: string, handler: CacheSubscriber): Promise<() => void> {
        await this.ensureInit();
        await this.subscriber.subscribe(channel);

        const listener = (rawChannel: string, rawMessage: string) => {
            if (rawChannel !== channel) return;
            try {
                const data = JSON.parse(rawMessage);
                handler({ channel, data, timestamp: Date.now() });
            } catch {
                handler({ channel, data: rawMessage, timestamp: Date.now() });
            }
        };

        this.subscriber.on('message', listener);

        return async () => {
            this.subscriber.off('message', listener);
            await this.subscriber.unsubscribe(channel);
        };
    }

    async isHealthy(): Promise<boolean> {
        try {
            await this.ensureInit();
            return this.client?.status === 'ready';
        } catch {
            return false;
        }
    }

    async shutdown(): Promise<void> {
        if (this.subscriber) await this.subscriber.quit();
        if (this.client) await this.client.quit();
        this.initialized = false;
        this.logger.log('Redis cache provider shut down');
    }
}
