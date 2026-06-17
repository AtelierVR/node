import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { SearchService } from './search.service';
import { SearchFactory, SEARCH_PROVIDERS } from './search.factory';
import { PostgresSearchProvider } from './providers/postgres-search.provider';
import { NoopSearchProvider } from './providers/noop-search.provider';
import { PrismaModule } from '../database/prisma.module';
import { PrismaService } from '../database/prisma.service';

/**
 * SearchModule provides full-text search.
 *
 * Providers are selected at runtime via search.provider config:
 *   - "postgres" (default): PostgreSQL tsvector, uses existing DB
 *   - "noop":     always returns empty (useful during bootstrap)
 *   - (future) "elasticsearch", "meilisearch"
 *
 * Usage in other modules:
 *   imports: [SearchModule],
 *   constructor(private readonly search: SearchService) {}
 */
@Module({
    imports: [AppConfigModule, PrismaModule],
    providers: [
        PostgresSearchProvider,
        NoopSearchProvider,
        {
            provide: SEARCH_PROVIDERS,
            useFactory: (postgres: PostgresSearchProvider, noop: NoopSearchProvider) => [postgres, noop],
            inject: [PostgresSearchProvider, NoopSearchProvider],
        },
        SearchFactory,
        SearchService,
    ],
    exports: [SearchService],
})
export class SearchModule {
    constructor(
        postgres: PostgresSearchProvider,
        prisma: PrismaService,
    ) {
        // Wire PrismaService into the Postgres provider (avoids circular deps)
        postgres.setPrisma(prisma);
    }
}
