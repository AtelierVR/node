import { Injectable } from '@nestjs/common';
import type { ISearchProvider, SearchOptions, SearchResult, SearchSchema } from '../search.interface';

/**
 * No-op search provider — always returns empty results.
 *
 * Used as fallback when no search provider is configured, or during
 * bootstrap before the real provider is ready.
 */
@Injectable()
export class NoopSearchProvider implements ISearchProvider {
    readonly name = 'noop';

    async createIndex(_schema: SearchSchema): Promise<void> { /* noop */ }

    async index(_index: string, _id: string, _body: Record<string, unknown>): Promise<void> { /* noop */ }

    async bulkIndex(_index: string, _docs: Array<{ id: string; body: Record<string, unknown> }>): Promise<void> { /* noop */ }

    async search(_index: string, _query: string, _opts?: SearchOptions): Promise<SearchResult> {
        return { hits: [], total: 0, tookMs: 0 };
    }

    async remove(_index: string, _id: string): Promise<void> { /* noop */ }

    async dropIndex(_index: string): Promise<void> { /* noop */ }

    async isHealthy(): Promise<boolean> {
        return true;
    }
}
