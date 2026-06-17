import { Injectable, Logger } from '@nestjs/common';
import type { ISearchProvider, SearchOptions, SearchResult, SearchSchema } from '../search.interface';

/**
 * PostgreSQL full-text search provider.
 *
 * Uses native tsvector / ts_query. Creates a GIN-indexed table per search index.
 * No external dependencies — works out of the box with the existing PostgreSQL.
 */
@Injectable()
export class PostgresSearchProvider implements ISearchProvider {
    readonly name = 'postgres';

    private readonly logger = new Logger(PostgresSearchProvider.name);
    // Injected lazily to avoid circular dependency
    private prisma: any = null;
    private initialized = false;

    /** Set by the module — injected as the PrismaService */
    setPrisma(prisma: any): void {
        this.prisma = prisma;
    }

    private get pg(): any {
        if (!this.prisma) throw new Error('PostgresSearchProvider: prisma not set. Inject PrismaService.');
        return this.prisma;
    }

    /** Sanitize index name to a valid PostgreSQL table name. */
    private tableName(index: string): string {
        return `search_${index.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
    }

    async createIndex(schema: SearchSchema): Promise<void> {
        const table = this.tableName(schema.name);

        await this.pg.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${table}" (
                id      TEXT PRIMARY KEY,
                body    JSONB NOT NULL,
                tsv     TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector('simple', ${schema.textFields.map(f => `COALESCE(body->>'${f}', '')`).join(" || ' ' || ")})
                ) STORED
            )
        `);

        await this.pg.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "${table}_tsv_idx" ON "${table}" USING GIN (tsv)
        `);

        this.initialized = true;
        this.logger.debug(`Search index "${schema.name}" → table "${table}" ready`);
    }

    async index(index: string, id: string, body: Record<string, unknown>): Promise<void> {
        const table = this.tableName(index);
        const json = JSON.stringify(body);

        await this.pg.$executeRawUnsafe(
            `INSERT INTO "${table}" (id, body) VALUES ($1, $2::jsonb)
             ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
            id, json,
        );
    }

    async bulkIndex(index: string, docs: Array<{ id: string; body: Record<string, unknown> }>): Promise<void> {
        if (docs.length === 0) return;
        const table = this.tableName(index);

        // Build a multi-row INSERT ... ON CONFLICT
        const values: string[] = [];
        const params: unknown[] = [];
        let i = 0;
        for (const doc of docs) {
            values.push(`($${++i}, $${++i}::jsonb)`);
            params.push(doc.id, JSON.stringify(doc.body));
        }

        await this.pg.$executeRawUnsafe(
            `INSERT INTO "${table}" (id, body) VALUES ${values.join(', ')}
             ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
            ...params,
        );
    }

    async search(index: string, query: string, opts?: SearchOptions): Promise<SearchResult> {
        const table = this.tableName(index);
        const limit = opts?.limit ?? 20;
        const offset = opts?.offset ?? 0;
        const lang = opts?.language ?? 'simple';

        const t0 = Date.now();

        // Build WHERE filters
        const conditions: string[] = [`tsv @@ plainto_tsquery('${lang}', $1)`];
        const params: unknown[] = [query];
        let paramIdx = 1;

        if (opts?.filters) {
            for (const [key, value] of Object.entries(opts.filters)) {
                paramIdx++;
                conditions.push(`body->>'${key}' = $${paramIdx}`);
                params.push(String(value));
            }
        }

        const where = conditions.join(' AND ');

        // Count total
        const countResult: any[] = await this.pg.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM "${table}" WHERE ${where}`,
            ...params,
        );
        const total = Number(countResult[0]?.cnt ?? 0);

        // Fetch hits
        const rows: any[] = await this.pg.$queryRawUnsafe(
            `SELECT id, ts_rank(tsv, plainto_tsquery('${lang}', $1)) as score, body
             FROM "${table}"
             WHERE ${where}
             ORDER BY score DESC
             LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
            ...params, limit, offset,
        );

        const hits = rows.map(r => ({
            id: r.id,
            score: Number(r.score),
            fields: r.body as Record<string, unknown>,
        }));

        return { hits, total, tookMs: Date.now() - t0 };
    }

    async remove(index: string, id: string): Promise<void> {
        const table = this.tableName(index);
        await this.pg.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id = $1`, id);
    }

    async dropIndex(index: string): Promise<void> {
        const table = this.tableName(index);
        await this.pg.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        this.logger.debug(`Dropped search index "${index}"`);
    }

    async isHealthy(): Promise<boolean> {
        try {
            await this.pg.$queryRawUnsafe('SELECT 1');
            return true;
        } catch {
            return false;
        }
    }
}
