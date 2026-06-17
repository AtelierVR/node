import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import type { ICacheProvider } from './cache.interface';

export const CACHE_PROVIDERS = Symbol('CACHE_PROVIDERS');

/**
 * CacheFactory resolves the correct ICacheProvider implementation
 * based on cache.provider config (default: "memory").
 *
 * To add a new cache backend (e.g. Memcached), create a class implementing
 * ICacheProvider and register it in the CACHE_PROVIDERS provider.
 */
@Injectable()
export class CacheFactory {
    private readonly logger = new Logger(CacheFactory.name);
    private readonly providers: Map<string, ICacheProvider>;

    constructor(
        @Inject(CACHE_PROVIDERS) providers: ICacheProvider[],
        private readonly config: AppConfigService,
    ) {
        this.providers = new Map(providers.map(p => [p.name.toLowerCase(), p]));
    }

    /**
     * Get the active cache provider.
     * Controlled by cache.provider config (default: "memory").
     */
    async get(): Promise<ICacheProvider> {
        const name = (await this.config.get<string>('cache.provider')).toLowerCase();
        const provider = this.providers.get(name);
        if (provider) return provider;

        this.logger.warn(`Unknown cache provider "${name}", falling back to memory`);
        return this.providers.get('memory')!;
    }

    /** Return all registered provider names. */
    availableProviders(): string[] {
        return [...this.providers.keys()];
    }
}
