import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { JobQueueService } from './job-queue.service';
import { JobQueueFactory, JOB_QUEUES } from './job-queue.factory';
import { SyncJobProvider } from './providers/sync-job.provider';
import { BullMqProvider } from './providers/bull-mq.provider';

/**
 * JobQueueModule provides background job processing.
 *
 * Providers are selected at runtime via queue.provider config:
 *   - "sync"  (default): in-process execution, no dependencies
 *   - "bullmq": Redis-backed with retries, scheduling, monitoring
 *
 * Usage in other modules:
 *   imports: [JobQueueModule],
 *   constructor(private readonly jobs: JobQueueService) {}
 */
@Module({
    imports: [AppConfigModule],
    providers: [
        SyncJobProvider,
        BullMqProvider,
        {
            provide: JOB_QUEUES,
            useFactory: (sync: SyncJobProvider, bullmq: BullMqProvider) => [sync, bullmq],
            inject: [SyncJobProvider, BullMqProvider],
        },
        JobQueueFactory,
        JobQueueService,
    ],
    exports: [JobQueueService],
})
export class JobQueueModule { }
