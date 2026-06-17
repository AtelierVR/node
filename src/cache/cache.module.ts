import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { CacheService } from './cache.service';
import { CacheFactory, CACHE_PROVIDERS } from './cache.factory';
import { MemoryCacheProvider } from './providers/memory.provider';
import { RedisCacheProvider } from './providers/redis.provider';

/**
 * CacheModule provides key-value caching with Pub/Sub.
 * Global module — CacheService is available everywhere without importing.
 *
 * Providers are selected at runtime via cache.provider config:
 *   - "memory" (default): in-process Map, no dependencies
 *   - "redis":  Redis-backed, required for multi-node deployments
 */
@Global()
@Module({
    imports: [AppConfigModule],
    providers: [
        MemoryCacheProvider,
        RedisCacheProvider,
        {
            provide: CACHE_PROVIDERS,
            useFactory: (memory: MemoryCacheProvider, redis: RedisCacheProvider) => [memory, redis],
            inject: [MemoryCacheProvider, RedisCacheProvider],
        },
        CacheFactory,
        CacheService,
    ],
    exports: [CacheService],
})
export class CacheModule { }
