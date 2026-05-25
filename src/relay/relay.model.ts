import { RelayModel } from 'src/generated/prisma/models/Relay';
import { RelayTokenModel } from 'src/generated/prisma/models/RelayToken';
import type { ApiRelay } from './relay.types';
import { RelayService } from './relay.service';
import { WsGateway } from '../ws/ws.gateway';

export type RelayWithMethods = RelayModel & {
    relayService: RelayService;
    wsGateway: WsGateway;
    serialize(): Promise<ApiRelay>;
    isConnected(): boolean;
    /** The relay token, or null when the model was fetched without the token relation. */
    token: RelayTokenModel | null;
};

export type RelayWithMethodsAndToken = RelayWithMethods & {
    token: RelayTokenModel;
};

export class Relay {
    static attach(model: RelayModel & { token?: RelayTokenModel | null }, relayService: RelayService, wsGateway: WsGateway): RelayWithMethods;
    static attach(model: RelayModel & { token: RelayTokenModel }, relayService: RelayService, wsGateway: WsGateway): RelayWithMethodsAndToken;
    static attach(model: RelayModel & { token?: RelayTokenModel | null }, relayService: RelayService, wsGateway: WsGateway): RelayWithMethods {
        const obj = model as unknown as RelayWithMethods;
        Object.defineProperty(obj, 'relayService', {
            value: relayService,
            enumerable: false,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(obj, 'wsGateway', {
            value: wsGateway,
            enumerable: false,
            configurable: true,
            writable: true,
        });
        Object.setPrototypeOf(obj, Relay.prototype as any);
        return obj;
    }

    /** Returns true when the relay binary is currently connected via WebSocket. */
    isConnected(this: RelayWithMethods): boolean {
        return this.relayService.isRelayConnected(this.id);
    }

    async serialize(this: RelayWithMethods): Promise<ApiRelay> {
        const connected = this.isConnected();
        const t0 = Date.now();
        const status = connected ? await this.wsGateway.requestStatus(this.id) : null;
        const ping = (connected && status) ? Date.now() - t0 : null;
        const details = await this.relayService.getRunnerInfo(this.id).catch(() => null);

        return {
            id: this.id,
            label: this.label ?? null,
            provider: this.provider ?? 'docker',
            provider_id: this.providerId ?? null,
            max_link: this.maxLink,
            tags: this.tags ?? [],
            connected,
            runner: details ? {
                provider_id: details.providerId,
                status: details.status,
                started_at: details.startedAt?.getTime() ?? null,
                meta: details.meta,
                // Prefer relay-reported accessibility (supports quic + exotic protocols);
                // fall back to Docker port bindings when the relay is offline.
                ports: status?.a
                    ? Object.entries(status.a)
                        .filter((entry): entry is [string, string] => entry[1] != null)
                        .flatMap(([proto, addr]) => {
                            const lastColon = addr.lastIndexOf(':');
                            if (lastColon === -1) return [];
                            const host = addr.substring(0, lastColon) || '0.0.0.0';
                            const port = parseInt(addr.substring(lastColon + 1), 10);
                            return isNaN(port) ? [] : [{ protocol: proto, host, port }];
                        })
                    : details.ports,
            } : null,
            created_at: this.createdAt.toISOString(),
            status: status ? {
                instances: {
                    count: status.i,
                    limit: status.m,
                },
                clients: status.c,
                engine: status.e,
                version: status.v,
                protocol: status.p,
                uptime: status.u ?? null,
                ping: ping,
                specs: status.s ? {
                    processor: {
                        used: status.s.c.u,
                        cores: status.s.c.c
                    },
                    memory: {
                        used: status.s.m.u,
                        total: status.s.m.t
                    },
                    upload: {
                        used: status.s.u.u,
                        bandwidth: status.s.u.b,
                        packets: status.s.u.p ?? 0,
                    },
                    download: {
                        used: status.s.d.u,
                        bandwidth: status.s.d.b,
                        packets: status.s.d.p ?? 0,
                    },
                    mtu: status.s.mtu ?? 1452,
                } : null,
            } : null,
        };
    }
}
