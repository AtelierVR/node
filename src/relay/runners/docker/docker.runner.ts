import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Docker from 'dockerode';
import { AppConfigService } from '../../../config/config.service';
import type { IRelayRunner, RelayRunnerInfo, RelayRunnerPort, RelayStartConfig } from '../runner.interface';

/** Id applied to every relay container so we can filter them. */
const RELAY_ID = 'nox.relay.id';
/** Label used to scope relay containers to a specific Nox instance. */
const GROUP_LABEL = 'nox.relay.group';
/** Optional label for easier identification of containers in `docker ps`. */
const RELAY_LABEL = 'nox.relay.label';

@Injectable()
export class DockerRunner implements IRelayRunner {
    readonly name = 'docker';

    private readonly logger = new Logger(DockerRunner.name);
    private docker!: Docker;

    /** Ports currently being allocated (between findFreePort and container start). */
    private readonly pendingPorts = new Set<number>();

    private async group(): Promise<string> {
        return this.config.get<string>('relay.group');
    }

    constructor(private readonly config: AppConfigService) {
        this.init();
    }

    async init() {
        let options = await this.config.getOptional<string | object>('relay.docker_options');
        if (typeof options === 'string')
            try { options = JSON.parse(options); }
            catch { options = {}; }
        this.docker = new Docker(options as Docker.DockerOptions);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Find a container by its `nox.relay.id` label value. */
    private async findContainer(relayId: string): Promise<Docker.ContainerInfo | null> {
        const all = await this.docker.listContainers({
            all: true,
            filters: {
                label: [
                    `${RELAY_ID}=${relayId}`,
                    `${GROUP_LABEL}=${await this.group()}`
                ]
            },
        });
        return all[0] ?? null;
    }

    /** Find a free UDP port, accounting for ports already being allocated in parallel. */
    private async findFreePort(min: number, max: number): Promise<number | null> {
        const used = new Set<number>(this.pendingPorts);
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [
                    `${RELAY_ID}`,
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

        this.pendingPorts.add(port);
        try {
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
                    [RELAY_ID]: String(cfg.relayId),
                    [GROUP_LABEL]: await this.group(),
                    ...(cfg.label ? {
                        [RELAY_LABEL]: cfg.label
                    } : {}),
                    'com.docker.compose.project': 'nox',
                    'com.docker.compose.service': containerName,
                },
                Env: [
                    `NOX_TOKEN=${cfg.token}`,
                    `NOX_PORT=${port}`,
                    `NOX_NODE_GATEWAY=${cfg.nodeGateway}`,
                    `NOX_USE_ADDRESS=${dockerAddress}:${port}`,
                    `NOX_MAX_INSTANCES=${cfg.maxLink}`,
                ],
                ExposedPorts: {
                    [`${port}/udp`]: {}
                },
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
        } finally {
            this.pendingPorts.delete(port);
        }
    }

    async stop(providerId: string, kill: boolean): Promise<void> {
        try {
            let container = this.docker.getContainer(providerId);
            if (kill)
                await container.kill({ signal: 'SIGKILL' });
            else await container.stop({ t: 10 });
        } catch (err) {
            // ignore
        }
    }

    async restart(providerId: string): Promise<void> {
        try {
            const container = this.docker.getContainer(providerId);
            await container.restart({ t: 10 });
        } catch (err) {
            // ignore
        }
    }

    async getInfo(providerId: string | null): Promise<RelayRunnerInfo> {
        if (!providerId)
            return {
                providerId: null,
                status: 'unknown',
                startedAt: null,
                meta: {},
                ports: [],
            };

        try {
            const info = await this.docker.getContainer(providerId).inspect();
            const state = info.State;
            let status: RelayRunnerInfo['status'] = 'unknown';
            if (state.Running) status = 'running';
            else if (state.Dead) status = "stopped";
            else status = 'stopped';

            const ports: RelayRunnerPort[] = [];
            const bindings = info.HostConfig?.PortBindings ?? {};
            for (const [key, hostBindings] of Object.entries(bindings)) {
                const slash = key.lastIndexOf('/');
                const protocol = key.substring(slash + 1);
                if (!Array.isArray(hostBindings)) continue;
                for (const b of hostBindings as { HostIp?: string; HostPort?: string }[]) {
                    const port = parseInt(b.HostPort ?? '', 10);
                    if (!isNaN(port))
                        ports.push({ protocol, host: b.HostIp || '0.0.0.0', port });
                }
            }

            return {
                providerId: info.Id.substring(0, 12),
                status,
                startedAt: state.StartedAt ? new Date(state.StartedAt) : null,
                meta: {
                    image: info.Config.Image,
                    image_sha: info.Image,
                    name: info.Name.replace(/^\//, ''),
                    code: state.Running ? '-1' : String(state.ExitCode),
                },
                ports,
            };
        } catch (err) {
            return {
                providerId: providerId.substring(0, 12),
                status: 'unknown',
                startedAt: null,
                meta: {},
                ports: [],
            };
        }
    }

    async isRunning(providerId: string | null): Promise<boolean> {
        if (!providerId) return false;
        const info = await this.getInfo(providerId);
        return info.status === 'running';
    }

    async hasCapacity(): Promise<boolean> {
        const minPort = Number(await this.config.getOptional<number>('relay.min_port') ?? 23000);
        const maxPort = Number(await this.config.getOptional<number>('relay.max_port') ?? 24000);
        const maxCapacity = maxPort - minPort + 1;

        const containers = await this.docker.listContainers({
            all: false,
            filters: {
                label: [
                    `${RELAY_ID}`,
                    `${GROUP_LABEL}=${await this.group()}`
                ]
            },
        });

        return containers.length + this.pendingPorts.size < maxCapacity;
    }
}
