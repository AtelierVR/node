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
    this.runners = new Map(runners.map((r) => [r.name.toLowerCase(), r]));
  }

  /**
   * Get the runner for a provider type.
   * Falls back to ExternalRunner with a warning if the provider is unknown.
   */
  get(provider: string): IRelayRunner {
    const runner = this.runners.get(provider.toLowerCase());
    if (runner) return runner;
    this.logger.warn(
      `Unknown relay provider "${provider}", falling back to ExternalRunner`,
    );
    return this.external;
  }
  /** Every registered runner. */
  all(): IRelayRunner[] {
    return [...this.runners.values()];
  }

  /**
   * Runners whose relay processes the node can discover and control
   * (i.e. `manages === true`). Excludes providers managed outside the node.
   */
  managed(): IRelayRunner[] {
    return this.all().filter((r) => r.manages);
  }

  /**
   * Pick the provider to use for a **new** relay: the available runner with the highest
   * {@link IRelayRunner.priority} (`-1` = cannot create, never selected).
   *
   * @returns the runner to use, or null when no provider can create a relay right now.
   */
  async best(): Promise<IRelayRunner | null> {
    let best: IRelayRunner | null = null;
    let bestPriority = -1;

    for (const runner of this.all()) {
      const priority = await runner.priority().catch(() => -1);
      if (priority > bestPriority) {
        best = runner;
        bestPriority = priority;
      }
    }

    if (!best)
      this.logger.warn('No relay provider can create a relay right now');
    return best;
  }

  /** Return all registered provider names. */
  availableProviders(): string[] {
    return [...this.runners.keys()];
  }
}
