import { Injectable } from '@nestjs/common';
import type {
  IRelayRunner,
  RelayRunnerEvent,
  RelayRunnerInfo,
  RelayRunnerInstance,
  RelayStartConfig,
} from '../runner.interface';

/**
 * External runner — for relays not managed by the node (self-hosted, bare-metal, etc.).
 * All lifecycle operations are no-ops; getInfo() always returns "unknown".
 */
@Injectable()
export class ExternalRunner implements IRelayRunner {
  readonly name = 'external';

  /** Relays are managed outside the node — nothing for the node to discover or control. */
  readonly manages = false;

  /** This provider cannot spawn relays — never selected for creation. */
  async priority(): Promise<number> {
    return -1;
  }

  async start(_cfg: RelayStartConfig): Promise<string> {
    throw new Error('External relays cannot be started by the node');
  }

  async stop(_providerId: string, _kill: boolean): Promise<void> {
    // External relays are managed outside the node — nothing to do
  }

  async remove(_providerId: string, _kill: boolean): Promise<void> {
    // External relays are managed outside the node — nothing to do
  }

  async restart(_providerId: string): Promise<void> {
    // External relays are managed outside the node — nothing to do
  }

  async list(): Promise<RelayRunnerInstance[]> {
    // External relays are managed outside the node — nothing to list
    return [];
  }

  async subscribe(
    _handler: (event: RelayRunnerEvent) => void,
  ): Promise<() => void> {
    // External relays are managed outside the node — no lifecycle events to report
    return () => {
      /* nothing to unsubscribe */
    };
  }

  async getInfo(_providerId: string | null): Promise<RelayRunnerInfo> {
    return {
      providerId: _providerId,
      status: 'unknown',
      startedAt: null,
      meta: {},
      ports: [],
      region: null,
    };
  }

  async isRunning(_providerId: string | null): Promise<boolean> {
    return false;
  }

  async hasCapacity(): Promise<boolean> {
    return false;
  }
}
