import { Injectable, Logger } from '@nestjs/common';
import type { IJobQueue, JobInfo, JobOptions, JobHandler } from '../job-queue.interface';

/**
 * In-process synchronous job provider.
 *
 * Executes jobs immediately in the same Node.js process — no persistence,
 * no retries, no scheduling. Ideal for development and single-node setups
 * where Redis is undesirable.
 */
@Injectable()
export class SyncJobProvider implements IJobQueue {
    readonly name = 'sync';

    private readonly logger = new Logger(SyncJobProvider.name);
    private readonly handlers = new Map<string, JobHandler>();
    private counter = 0;

    async add<T = unknown>(queue: string, data: T, _opts?: JobOptions): Promise<string> {
        const id = `sync:${queue}:${++this.counter}`;
        const handler = this.handlers.get(queue);

        if (!handler) {
            this.logger.warn(`No handler registered for queue "${queue}", job ${id} discarded`);
            return id;
        }

        // Fire-and-forget — non-blocking microtask
        Promise.resolve()
            .then(() => handler(data))
            .catch(err => this.logger.error(`Sync job ${id} (${queue}) failed`, err?.stack ?? err));

        return id;
    }

    process<T = unknown>(queue: string, handler: JobHandler<T>): void {
        if (this.handlers.has(queue)) {
            this.logger.warn(`Handler for queue "${queue}" is being overwritten`);
        }
        this.handlers.set(queue, handler as JobHandler);
        this.logger.debug(`Registered handler for queue "${queue}"`);
    }

    async get(_jobId: string): Promise<JobInfo | null> {
        // Sync provider does not persist jobs
        return null;
    }

    async isHealthy(): Promise<boolean> {
        return true;
    }

    async shutdown(): Promise<void> {
        this.handlers.clear();
        this.logger.log('Sync job provider shut down');
    }
}
