import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IRelayRunner } from './runner.interface';
import { ExternalRunner } from './external/external.runner';

export const RELAY_RUNNERS = Symbol('RELAY_RUNNERS');

/**
 * RunnerFactory resolves the correct IRelayRunner implementation
 * for a given provider name stored in `Relay.provider`.
 *
 * To add a new provider (e.g. Kubernetes), create a new runner class
 * implementing IRelayRunner and register it in the RELAY_RUNNERS provider.
 */
@Injectable()
export class RunnerFactory {
    private readonly logger = new Logger(RunnerFactory.name);
    private readonly runners: Map<string, IRelayRunner>;

    constructor(
        @Inject(RELAY_RUNNERS) runners: IRelayRunner[],
        private readonly external: ExternalRunner,
    ) {
        this.runners = new Map(runners.map(r => [r.name.toLowerCase(), r]));
    }

    /**
     * Get the runner for a provider type.
     * Falls back to ExternalRunner with a warning if the provider is unknown.
     */
    get(provider: string): IRelayRunner {
        const runner = this.runners.get(provider.toLowerCase());
        if (runner) return runner;
        this.logger.warn(`Unknown relay provider "${provider}", falling back to ExternalRunner`);
        return this.external;
    }

    /** Return all registered provider names. */
    availableProviders(): string[] {
        return [...this.runners.keys()];
    }
}
