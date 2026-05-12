import { Injectable } from '@nestjs/common';
import type { IRelayRunner, RelayRunnerInfo, RelayStartConfig } from '../runner.interface';

/**
 * External runner — for relays not managed by the node (self-hosted, bare-metal, etc.).
 * All lifecycle operations are no-ops; getInfo() always returns "unknown".
 */
@Injectable()
export class ExternalRunner implements IRelayRunner {
    readonly name = 'external';

    async start(_cfg: RelayStartConfig): Promise<string> {
        throw new Error('External relays cannot be started by the node');
    }

    async stop(_providerId: string): Promise<void> {
        // External relays are managed outside the node — nothing to do
    }

    async restart(_providerId: string, _cfg: RelayStartConfig): Promise<string> {
        throw new Error('External relays cannot be restarted by the node');
    }

    async kill(_providerId: string): Promise<void> {
        // No-op
    }

    async getInfo(_providerId: string | null): Promise<RelayRunnerInfo> {
        return { providerId: _providerId, status: 'unknown', startedAt: null, meta: {} };
    }

    async isRunning(_providerId: string | null): Promise<boolean> {
        return false;
    }
}
