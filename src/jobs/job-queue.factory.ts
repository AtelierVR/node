import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import type { IJobQueue } from './job-queue.interface';

export const JOB_QUEUES = Symbol('JOB_QUEUES');

/**
 * JobQueueFactory resolves the correct IJobQueue implementation
 * based on queue.provider config (default: "sync").
 *
 * To add a new queue provider (e.g. SQS), create a class implementing
 * IJobQueue and register it in the JOB_QUEUES provider.
 */
@Injectable()
export class JobQueueFactory {
    private readonly logger = new Logger(JobQueueFactory.name);
    private readonly providers: Map<string, IJobQueue>;

    constructor(
        @Inject(JOB_QUEUES) providers: IJobQueue[],
        private readonly config: AppConfigService,
    ) {
        this.providers = new Map(providers.map(p => [p.name.toLowerCase(), p]));
    }

    /**
     * Get the active queue provider.
     * Controlled by queue.provider config (default: "sync").
     */
    async get(): Promise<IJobQueue> {
        const name = (await this.config.get<string>('queue.provider')).toLowerCase();
        const provider = this.providers.get(name);
        if (provider) return provider;

        this.logger.warn(`Unknown queue provider "${name}", falling back to sync`);
        return this.providers.get('sync')!;
    }

    /** Return all registered provider names. */
    availableProviders(): string[] {
        return [...this.providers.keys()];
    }
}
