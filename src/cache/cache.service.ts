import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { CacheFactory } from './cache.factory';
import type { ICacheProvider, AtomicOps, CacheSubscriber } from './cache.interface';

/**
 * Thin convenience wrapper around CacheFactory.
 *
 * Usage:
 *   constructor(private readonly cache: CacheService) {}
 *   await this.cache.set('user:42', user, 300);
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CacheService.name);
    private provider!: ICacheProvider;

    constructor(private readonly factory: CacheFactory) {}

    async onModuleInit(): Promise<void> {
        this.provider = await this.factory.get();
        this.logger.log(`Active cache provider: ${this.provider.name}`);
    }

    get<T = unknown>(key: string): Promise<T | null> { return this.provider.get(key); }
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> { return this.provider.set(key, value, ttlSeconds); }
    del(...keys: string[]): Promise<void> { return this.provider.del(...keys); }
    exists(key: string): Promise<boolean> { return this.provider.exists(key); }
    ttl(key: string): Promise<number> { return this.provider.ttl(key); }
    clearPattern(pattern: string): Promise<void> { return this.provider.clearPattern(pattern); }
    publish(channel: string, data: unknown): Promise<void> { return this.provider.publish(channel, data); }
    subscribe(channel: string, handler: CacheSubscriber): Promise<() => void> { return this.provider.subscribe(channel, handler); }
    get atomic(): AtomicOps { return this.provider.atomic; }
    isHealthy(): Promise<boolean> { return this.provider.isHealthy(); }

    async onModuleDestroy(): Promise<void> {
        await this.provider?.shutdown();
    }
}
