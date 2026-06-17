import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import type { ISearchProvider } from './search.interface';

export const SEARCH_PROVIDERS = Symbol('SEARCH_PROVIDERS');

/**
 * SearchFactory resolves the correct ISearchProvider implementation
 * based on search.provider config (default: "postgres").
 *
 * To add a new search backend (e.g. Elasticsearch), create a class implementing
 * ISearchProvider and register it in the SEARCH_PROVIDERS provider.
 */
@Injectable()
export class SearchFactory {
    private readonly logger = new Logger(SearchFactory.name);
    private readonly providers: Map<string, ISearchProvider>;

    constructor(
        @Inject(SEARCH_PROVIDERS) providers: ISearchProvider[],
        private readonly config: AppConfigService,
    ) {
        this.providers = new Map(providers.map(p => [p.name.toLowerCase(), p]));
    }

    /**
     * Get the active search provider.
     * Controlled by search.provider config (default: "postgres").
     */
    async get(): Promise<ISearchProvider> {
        const name = (await this.config.get<string>('search.provider')).toLowerCase();
        const provider = this.providers.get(name);
        if (provider) return provider;

        this.logger.warn(`Unknown search provider "${name}", falling back to noop`);
        return this.providers.get('noop')!;
    }

    /** Return all registered provider names. */
    availableProviders(): string[] {
        return [...this.providers.keys()];
    }
}
