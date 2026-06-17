import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SearchFactory } from './search.factory';
import type { ISearchProvider, SearchOptions, SearchResult, SearchSchema } from './search.interface';

/**
 * Thin convenience wrapper around SearchFactory.
 *
 * Usage:
 *   constructor(private readonly search: SearchService) {}
 *   await this.search.index('users', '42', { username: 'alice', display: 'Alice' });
 *   const result = await this.search.search('users', 'alice');
 */
@Injectable()
export class SearchService implements OnModuleInit {
    private readonly logger = new Logger(SearchService.name);
    private provider!: ISearchProvider;

    constructor(private readonly factory: SearchFactory) {}

    async onModuleInit(): Promise<void> {
        this.provider = await this.factory.get();
        this.logger.log(`Active search provider: ${this.provider.name}`);
    }

    createIndex(schema: SearchSchema): Promise<void> { return this.provider.createIndex(schema); }
    index(index: string, id: string, body: Record<string, unknown>): Promise<void> { return this.provider.index(index, id, body); }
    bulkIndex(index: string, docs: Array<{ id: string; body: Record<string, unknown> }>): Promise<void> { return this.provider.bulkIndex(index, docs); }
    search(index: string, query: string, opts?: SearchOptions): Promise<SearchResult> { return this.provider.search(index, query, opts); }
    remove(index: string, id: string): Promise<void> { return this.provider.remove(index, id); }
    dropIndex(index: string): Promise<void> { return this.provider.dropIndex(index); }
    isHealthy(): Promise<boolean> { return this.provider.isHealthy(); }
}
