import { Injectable, Logger } from '@nestjs/common';
import type { ICacheProvider, AtomicOps, CacheSubscriber } from '../cache.interface';

/**
 * In-process memory cache.
 *
 * Uses a plain Map with manual TTL checks. Pub/Sub is local to the process
 * via EventEmitter. Suitable for development and single-node deployments.
 */
@Injectable()
export class MemoryCacheProvider implements ICacheProvider {
    readonly name = 'memory';

    private readonly logger = new Logger(MemoryCacheProvider.name);
    private readonly store = new Map<string, { value: unknown; expiresAt: number | null }>();
    private readonly subscribers = new Map<string, Set<CacheSubscriber>>();

    readonly atomic: AtomicOps = {
        incr: async (key: string, amount = 1) => {
            const entry = this.store.get(key);
            const current = typeof entry?.value === 'number' ? entry.value : 0;
            const next = current + amount;
            this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
            return next;
        },
        decr: async (key: string, amount = 1) => {
            const entry = this.store.get(key);
            const current = typeof entry?.value === 'number' ? entry.value : 0;
            const next = current - amount;
            this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
            return next;
        },
        setNX: async (key: string, value: unknown, ttlSeconds?: number) => {
            if (this.store.has(key)) return false;
            this.store.set(key, {
                value,
                expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
            });
            return true;
        },
    };

    private isExpired(entry: { value: unknown; expiresAt: number | null }): boolean {
        return entry.expiresAt !== null && Date.now() > entry.expiresAt;
    }

    async get<T = unknown>(key: string): Promise<T | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (this.isExpired(entry)) {
            this.store.delete(key);
            return null;
        }
        return entry.value as T;
    }

    async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
        });
    }

    async del(...keys: string[]): Promise<void> {
        for (const key of keys) this.store.delete(key);
    }

    async exists(key: string): Promise<boolean> {
        const entry = this.store.get(key);
        if (!entry) return false;
        if (this.isExpired(entry)) {
            this.store.delete(key);
            return false;
        }
        return true;
    }

    async ttl(key: string): Promise<number> {
        const entry = this.store.get(key);
        if (!entry) return -2;
        if (entry.expiresAt === null) return -1;
        const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
        if (remaining <= 0) {
            this.store.delete(key);
            return -2;
        }
        return remaining;
    }

    async clearPattern(pattern: string): Promise<void> {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        for (const key of this.store.keys()) {
            if (regex.test(key)) this.store.delete(key);
        }
    }

    async publish(channel: string, data: unknown): Promise<void> {
        const subs = this.subscribers.get(channel);
        if (!subs) return;
        const msg = { channel, data, timestamp: Date.now() };
        for (const handler of subs) {
            try {
                handler(msg);
            } catch (err) {
                this.logger.error(`Subscriber error on channel "${channel}"`, err);
            }
        }
    }

    async subscribe(channel: string, handler: CacheSubscriber): Promise<() => void> {
        if (!this.subscribers.has(channel)) {
            this.subscribers.set(channel, new Set());
        }
        this.subscribers.get(channel)!.add(handler);

        return () => {
            this.subscribers.get(channel)?.delete(handler);
        };
    }

    async isHealthy(): Promise<boolean> {
        return true;
    }

    async shutdown(): Promise<void> {
        this.store.clear();
        this.subscribers.clear();
        this.logger.log('Memory cache provider shut down');
    }
}
