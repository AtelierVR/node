import { Injectable, Logger } from '@nestjs/common';
import type { IRelayRunner } from './runner.interface';
import { DockerRunner } from './docker/docker.runner';
import { ExternalRunner } from './external/external.runner';

/**
 * RunnerFactory resolves the correct IRelayRunner implementation
 * for a given provider name stored in `Relay.provider`.
 *
 * To add a new provider (e.g. Kubernetes), create a new runner class
 * implementing IRelayRunner and register it here.
 */
@Injectable()
export class RunnerFactory {
    private readonly logger = new Logger(RunnerFactory.name);
    private readonly runners: Map<string, IRelayRunner>;

    constructor(
        private readonly docker: DockerRunner,
        private readonly external: ExternalRunner,
    ) {
        this.runners = new Map<string, IRelayRunner>([
            [this.docker.name, this.docker],
            [this.external.name, this.external],
        ]);
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
