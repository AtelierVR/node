import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import type { IJobQueue, JobInfo, JobOptions, JobHandler } from '../job-queue.interface';

/**
 * Redis-backed job queue using BullMQ.
 *
 * Requires a Redis connection. Jobs are persisted, retried with exponential
 * backoff, and can be scheduled or delayed. This is the recommended provider
 * for production deployments, especially multi-node.
 *
 * Dependencies: bullmq, ioredis (install separately when enabling this provider)
 */
@Injectable()
export class BullMqProvider implements IJobQueue {
    readonly name = 'bullmq';

    private readonly logger = new Logger(BullMqProvider.name);

    // Lazy-loaded BullMQ imports — avoids requiring bullmq as a hard dependency
    private queues!: Map<string, any>;   // Map<string, Queue>
    private workers!: Map<string, any>;  // Map<string, Worker>
    private connection: any = null;      // IORedis connection
    private initialized = false;

    constructor(private readonly config: AppConfigService) {}

    private async ensureInit(): Promise<void> {
        if (this.initialized) return;

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const IORedis = require('ioredis').default || require('ioredis');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Queue, Worker } = require('bullmq');

            const redisUrl = await this.config.get<string>('redis.url');
            this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

            // Store constructors for lazy queue/worker creation
            (this as any)._Queue = Queue;
            (this as any)._Worker = Worker;

            this.queues = new Map();
            this.workers = new Map();
            this.initialized = true;

            this.logger.log(`BullMQ connected to ${redisUrl}`);
        } catch (err) {
            this.logger.error('Failed to initialize BullMQ. Install bullmq + ioredis, or set QUEUE_PROVIDER=sync', err);
            throw err;
        }
    }

    private getQueue(name: string): any {
        if (!this.queues!.has(name)) {
            this.queues!.set(name, new (this as any)._Queue(name, { connection: this.connection }));
        }
        return this.queues!.get(name);
    }

    async add<T = unknown>(queue: string, data: T, opts?: JobOptions): Promise<string> {
        await this.ensureInit();
        const q = this.getQueue(queue);
        const job = await q.add(queue, data, {
            attempts: opts?.attempts ?? 3,
            backoff: opts?.backoff ? { type: 'exponential', delay: opts.backoff } : undefined,
            removeOnComplete: opts?.removeOnComplete ?? false,
            delay: opts?.delay,
            priority: opts?.priority,
        });
        return job.id!;
    }

    process<T = unknown>(queue: string, handler: JobHandler<T>): void {
        // Defer worker creation to after ensureInit
        const lazyInit = async () => {
            await this.ensureInit();
            if (this.workers!.has(queue)) {
                this.logger.warn(`Worker for queue "${queue}" is being replaced`);
                await this.workers!.get(queue).close();
            }
            const worker = new (this as any)._Worker(queue, async (job: any) => {
                await handler(job.data);
            }, { connection: this.connection, concurrency: 5 });
            this.workers!.set(queue, worker);
            this.logger.debug(`BullMQ worker started for queue "${queue}"`);
        };
        lazyInit().catch(err => this.logger.error(`Failed to start worker for "${queue}"`, err));
    }

    async get(jobId: string): Promise<JobInfo | null> {
        await this.ensureInit();
        // Job ID format is typically "{queue}:{id}" — try each known queue
        for (const q of this.queues!.values()) {
            const job = await q.getJob(jobId);
            if (job) {
                return {
                    id: job.id!,
                    queue: job.queueName,
                    status: (await job.getState()) as JobInfo['status'],
                    attemptsMade: job.attemptsMade,
                    failedReason: job.failedReason ?? null,
                    createdAt: new Date(job.timestamp),
                    processedAt: job.processedOn ? new Date(job.processedOn) : null,
                    completedAt: job.finishedOn ? new Date(job.finishedOn) : null,
                };
            }
        }
        return null;
    }

    async isHealthy(): Promise<boolean> {
        try {
            await this.ensureInit();
            return this.connection?.status === 'ready';
        } catch {
            return false;
        }
    }

    async shutdown(): Promise<void> {
        for (const w of this.workers?.values() ?? []) await w.close();
        for (const q of this.queues?.values() ?? []) await q.close();
        if (this.connection) await this.connection.quit();
        this.initialized = false;
        this.logger.log('BullMQ provider shut down');
    }
}
