import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Docker from 'dockerode';
import { AppConfigService } from '../../../config/config.service';
import type { IRelayRunner, RelayRunnerInfo, RelayStartConfig } from '../runner.interface';

/** Label applied to every relay container so we can filter them. */
const RELAY_LABEL = 'nox.relay.id';
/** Label used to scope relay containers to a specific Nox instance. */
const GROUP_LABEL = 'nox.relay.group';

@Injectable()
export class DockerRunner implements IRelayRunner {
    readonly name = 'docker';

    private readonly logger = new Logger(DockerRunner.name);
    private docker!: Docker;

    private async group(): Promise<string> {
        return this.config.get<string>('relay.group');
    }

    constructor(private readonly config: AppConfigService) {
        // Docker options can be overridden via config: relay.docker_options
        // e.g. { socketPath: '/var/run/docker.sock' } or { host, port }
        this.config.getOptional<string | object>('relay.docker_options').then(opts => {
            if (typeof opts === 'string') {
                try { opts = JSON.parse(opts); } catch { opts = {}; }
            }
            this.docker = new Docker(opts as Docker.DockerOptions ?? {});
        }).catch(() => {
            this.docker = new Docker();
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Find a container by its `nox.relay.id` label value. */
    private async findContainer(relayId: string): Promise<Docker.ContainerInfo | null> {
        const all = await this.docker.listContainers({
            all: true,
            filters: {
                label: [
                    `${RELAY_LABEL}=${relayId}`,
                    `${GROUP_LABEL}=${await this.group()}`
                ]
            },
        });
        return all[0] ?? null;
    }

    /** Find the first UDP port that isn't in use by another relay container. */
    private async findFreePort(min: number, max: number): Promise<number | null> {
        const used = new Set<number>();
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [
                    `${RELAY_LABEL}`,
                    `${GROUP_LABEL}=${await this.group()}`
                ]
            },
        });

        for (const c of containers)
            for (const p of c.Ports ?? [])
                if (p.PublicPort) used.add(p.PublicPort);

        for (let port = min; port <= max; port++)
            if (!used.has(port))
                return port;

        return null;
    }

    // ── IRelayRunner ──────────────────────────────────────────────────────────

    async start(cfg: RelayStartConfig): Promise<string> {
        const image = await this.config.getOptional<string>('relay.docker_image') ?? 'nox-relay:latest';
        const network = await this.config.getOptional<string>('relay.docker_network') ?? 'bridge';
        const dockerAddress = await this.config.getOptional<string>('relay.docker_address') ?? '127.0.0.1';
        const minPort = Number(await this.config.getOptional<number>('relay.min_port') ?? 23000);
        const maxPort = Number(await this.config.getOptional<number>('relay.max_port') ?? 24000);

        const port = await this.findFreePort(minPort, maxPort);
        if (port === null)
            throw new Error('No free UDP port available in the configured range');

        const suffix = randomBytes(4).toString('hex');
        const containerName = `relay_${cfg.relayId}_${suffix}`;

        this.logger.log(`Starting relay #${cfg.relayId} on port ${port} (image: ${image})`);

        // Pull the image if it is not already present locally.
        await new Promise<void>((resolve, reject) => {
            this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
                if (err) return reject(err);
                this.docker.modem.followProgress(stream, (err: Error | null) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        });

        const container = await this.docker.createContainer({
            Image: image,
            name: containerName,
            Labels: {
                [RELAY_LABEL]: String(cfg.relayId),
                [GROUP_LABEL]: await this.group(),
                'nox.relay.label': cfg.label ?? '',
                'com.docker.compose.project': 'nox',
                'com.docker.compose.service': containerName,
            },
            Env: [
                `NOX_TOKEN=${cfg.token}`,
                `NOX_PORT=${port}`,
                `NOX_NODE_GATEWAY=${cfg.nodeGateway}`,
                `NOX_USE_ADDRESS=${dockerAddress}:${port}`,
                `NOX_MAX_INSTANCES=${cfg.maxInstances}`,
            ],
            ExposedPorts: { [`${port}/udp`]: {} },
            HostConfig: {
                PortBindings: {
                    [`${port}/udp`]: [{ HostPort: String(port) }],
                },
                RestartPolicy: { Name: 'unless-stopped' },
                NetworkMode: network,
            },
        });

        await container.start();
        return container.id;
    }

    async stop(providerId: string): Promise<void> {
        try {
            await this.docker.getContainer(providerId).stop({ t: 10 });
        } catch (err: any) {
            if (err?.statusCode !== 404 && err?.statusCode !== 304) throw err;
        }
    }

    async restart(providerId: string, config: RelayStartConfig): Promise<string> {
        await this.stop(providerId);
        // Remove old container before creating a fresh one
        try {
            await this.docker.getContainer(providerId).remove({ force: true });
        } catch { /* ignore */ }
        return this.start(config);
    }

    async kill(providerId: string): Promise<void> {
        try {
            await this.docker.getContainer(providerId).kill({ signal: 'SIGKILL' });
        } catch (err: any) {
            if (err?.statusCode !== 404) throw err;
        }
    }

    async getInfo(providerId: string | null): Promise<RelayRunnerInfo> {
        if (!providerId)
            return {
                providerId: null,
                status: 'unknown',
                startedAt: null,
                meta: {}
            };

        try {
            const info = await this.docker.getContainer(providerId).inspect();
            const state = info.State;
            let status: RelayRunnerInfo['status'] = 'unknown';
            if (state.Running) status = 'running';
            else if (state.Dead) status = 'dead';
            else status = 'stopped';

            return {
                providerId: info.Id.substring(0, 12),
                status,
                startedAt: state.StartedAt ? new Date(state.StartedAt) : null,
                meta: {
                    image: info.Config.Image,
                    name: info.Name.replace(/^\//, ''),
                    exit_code: state.Running ? '-1' : String(state.ExitCode),
                },
            };
        } catch (err: any) {
            if (err?.statusCode === 404)
                return {
                    providerId: providerId.substring(0, 12),
                    status: 'unknown',
                    startedAt: null,
                    meta: {}
                };

            throw err;
        }
    }

    async isRunning(providerId: string | null): Promise<boolean> {
        if (!providerId) return false;
        const info = await this.getInfo(providerId);
        return info.status === 'running';
    }
}
