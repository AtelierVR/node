/**
 * Search abstraction layer.
 *
 * Provides full-text search across documents (users, worlds, instances, posts).
 * The default provider uses PostgreSQL tsvector — no extra infrastructure needed.
 *
 * Implementations:
 *   - PostgresSearchProvider — built-in PostgreSQL full-text search
 *   - NoopSearchProvider    — always returns empty results
 *   - (future) ElasticsearchProvider, MeilisearchProvider, …
 */

// ── Search types ─────────────────────────────────────────────────────────────

export interface SearchOptions {
    /** Maximum results to return (default: 20) */
    limit?: number;
    /** Zero-based offset for pagination */
    offset?: number;
    /** ISO 639-1 language code for stemming (e.g. "en", "fr") */
    language?: string;
    /** Filter results to these fields only */
    fields?: string[];
    /** Arbitrary filter: key → value */
    filters?: Record<string, string | number | boolean>;
}

export interface SearchHit {
    id: string;
    score: number;
    fields: Record<string, unknown>;
}

export interface SearchResult {
    hits: SearchHit[];
    total: number;
    tookMs: number;
}

export interface SearchSchema {
    /** Index name */
    name: string;
    /** Fields to index for full-text search */
    textFields: string[];
    /** Fields available for filtering */
    filterFields?: string[];
}

// ── The provider interface ───────────────────────────────────────────────────

export interface ISearchProvider {
    /** Provider name (e.g. "postgres", "elasticsearch") */
    readonly name: string;

    /**
     * Initialize the index. Idempotent — creates tables/indices if missing.
     */
    createIndex(schema: SearchSchema): Promise<void>;

    /**
     * Index a document. Upserts if `id` already exists.
     */
    index(index: string, id: string, body: Record<string, unknown>): Promise<void>;

    /**
     * Bulk index multiple documents. More efficient than individual calls.
     */
    bulkIndex(index: string, docs: Array<{ id: string; body: Record<string, unknown> }>): Promise<void>;

    /**
     * Search across an index.
     */
    search(index: string, query: string, opts?: SearchOptions): Promise<SearchResult>;

    /**
     * Remove a document from an index.
     */
    remove(index: string, id: string): Promise<void>;

    /**
     * Drop an entire index.
     */
    dropIndex(index: string): Promise<void>;

    /**
     * Check backend connectivity.
     */
    isHealthy(): Promise<boolean>;
}
