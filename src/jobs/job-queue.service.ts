import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { JobQueueFactory } from './job-queue.factory';
import type { IJobQueue, JobOptions, JobInfo, JobHandler } from './job-queue.interface';

/**
 * Thin convenience wrapper around JobQueueFactory.
 *
 * Usage:
 *   constructor(private readonly jobs: JobQueueService) {}
 *   await this.jobs.add('fediverse-deliver', { inbox, activity });
 */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(JobQueueService.name);
    private provider!: IJobQueue;

    constructor(private readonly factory: JobQueueFactory) {}

    async onModuleInit(): Promise<void> {
        this.provider = await this.factory.get();
        this.logger.log(`Active queue provider: ${this.provider.name}`);
    }

    async add<T = unknown>(queue: string, data: T, opts?: JobOptions): Promise<string> {
        return this.provider.add(queue, data, opts);
    }

    process<T = unknown>(queue: string, handler: JobHandler<T>): void {
        this.provider.process(queue, handler);
    }

    async get(jobId: string): Promise<JobInfo | null> {
        return this.provider.get(jobId);
    }

    async isHealthy(): Promise<boolean> {
        return this.provider.isHealthy();
    }

    async onModuleDestroy(): Promise<void> {
        await this.provider?.shutdown();
    }
}
