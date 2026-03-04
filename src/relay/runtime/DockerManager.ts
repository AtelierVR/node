import Main from "../../Main";
import Docker from 'dockerode';
import Relay from "../Relay";
import { randomBytes } from "crypto";
import Debug from "../../utils/Debug";
import Env from "../../utils/Environment";
import { readFileSync } from "fs";
import RuntimeManager, { AddressList } from "./RuntimeManager";

export interface RelayContainer {
    relay: Relay;
    container: Docker.Container;
}

export interface RelayContainerOptions {
    port: number;
    badgerToken: string;
    relayId: number;
}

export interface ContainerEvent {
    id: string;
    action: string;
    relay_id: number;
}


export default class DockerManager extends RuntimeManager {
    docker: Docker;
    private processedEvents: Set<string> = new Set();
    private readonly EVENT_CACHE_DURATION = 5000; // 5 seconds
    private creatingRelay: boolean = false; // Lock to prevent multiple simultaneous relay creations
    private containerStartTimes: Map<number, Date> = new Map(); // Track when containers start
    private gracePeriodsLogged: Set<number> = new Set(); // Track which relays we've logged grace period for

    constructor(app: Main) {
        super(app);
        this.docker = new Docker(Env.getDockerOptions());
        this.app.on('ready', this.onReady.bind(this));
    }

    getName(): string {
        return 'docker';
    }

    async isHost(relay: Relay): Promise<boolean> {
        let infos = await this.docker.listContainers({ all: true, filters: { label: ['nox.relay.id'] } });
        return infos.some(info => info.Labels['nox.relay.id'] === relay.id.toString());
    }
    async onReady(): Promise<void> {
        let events = await this.docker.getEvents({ filters: { label: ['nox.relay.id'] } });

        events.on('data', this.onContainerEvent.bind(this));
        events.on('error', (error) => Debug.debug('Docker event stream error:', error));

        let infos = await this.docker.listContainers({ all: true, filters: { label: ['nox.relay.id'] } });
        for (let info of infos)
            await this.onContainer({
                id: info.Id,
                action: info.State === 'running' ? 'start' : 'die',
                relay_id: parseInt(info.Labels['nox.relay.id'], 10)
            });
    }

    async getSelfContainer() {
        const info = readFileSync("/proc/self/mountinfo", "utf8");
        const match = info.match(/\/var\/lib\/docker\/containers\/([0-9a-f]{64})\//);
        var id = match ? match[1] : null;
        if (!id) throw new Error("Not running inside a Docker container");
        const container = this.docker.getContainer(id);
        return await container.inspect();
    }

    async onContainerEvent(data: any) {
        try {
            const obj = JSON.parse(data.toString());
            if (obj.Type !== 'container') return;
            
            const event = {
                id: obj.id || obj.Actor?.ID || '',
                action: obj.Action,
                relay_id: parseInt(obj.Actor?.Attributes?.['nox.relay.id'], 10)
            };
            
            // Skip if not a relay event
            if (isNaN(event.relay_id)) return;
            
            // Create unique event key
            const eventKey = `${event.id}-${event.action}-${event.relay_id}`;
            
            // Check if already processed
            if (this.processedEvents.has(eventKey)) {
                return; // Skip duplicate event
            }
            
            // Mark as processed
            this.processedEvents.add(eventKey);
            
            // Clean up old events after duration
            setTimeout(() => {
                this.processedEvents.delete(eventKey);
            }, this.EVENT_CACHE_DURATION);
            
            await this.onContainer(event);
        } catch (error) {
            Debug.debug('Error processing container event:', error);
        }
    }

    async onContainer(event: ContainerEvent): Promise<void> {
        switch (event.action) {
            case 'start':
                await this.onContainerStarted(event);
                break;
            case 'die':
                await this.onContainerDied(event);
                break;
            case 'destroy':
                await this.onContainerDestroyed(event);
                break;
            case 'create':
                await this.onContainerCreated(event);
                break;
            default:
                const containerId = event.id ? event.id.substring(0, 12) : 'unknown';
                Debug.warn(`Unhandled container event: ${event.action} (container: ${containerId}) for relay ${event.relay_id}`);
        }

    }

    async isFull(): Promise<boolean> {
        let relays = (await this.app.database.relay.findMany())
            .map(r => new Relay(r, this.app));

        if (relays.length === 0)
            return true;

        // Filter out recently disconnected relays during grace period
        let activeOrGracePeriodRelays = [];
        for (let relay of relays) {
            const isConnected = await relay.isConnected();
            const isRecentlyDisconnected = relay.isRecentlyDisconnected(60);

            if (isConnected || isRecentlyDisconnected) {
                activeOrGracePeriodRelays.push(relay);
            }

        }

        if (activeOrGracePeriodRelays.length === 0) {
            Debug.log('No active relays (excluding dead ones), creating new relay');
            return true;
        }

        // Check if active/grace-period relays are full
        const fullStatuses = await Promise.all(
            activeOrGracePeriodRelays.map(async r => await r.isFull())
        );

        const allFull = fullStatuses.every(v => v);
        return allFull;
    }

    async checkHosts(): Promise<void> {
        let relays = await this.app.database.relay.findMany();

        for (let relayData of relays) {
            let relay = new Relay(relayData, this.app);

            // Check if container still exists
            if (!await this.isHost(relay)) {
                await relay.delete();
                this.containerStartTimes.delete(relay.id);
                this.gracePeriodsLogged.delete(relay.id);
                Debug.log(`Removed relay ${relay.id} as its container is missing`);
                continue;
            }

            // Check if container was started recently (startup grace period)
            const containerStartTime = this.containerStartTimes.get(relay.id);
            if (containerStartTime) {
                const timeSinceStart = (Date.now() - containerStartTime.getTime()) / 1000;
                const STARTUP_GRACE_PERIOD = 60; // 60 seconds
                
                if (timeSinceStart < STARTUP_GRACE_PERIOD) {
                    // Only log once per relay when entering grace period
                    if (!this.gracePeriodsLogged.has(relay.id)) {
                        Debug.debug(`Relay ${relay.id} entered startup grace period, will skip dead checks for ${STARTUP_GRACE_PERIOD}s`);
                        this.gracePeriodsLogged.add(relay.id);
                    }
                    continue;
                } else {
                    // Remove from logged set when grace period is over
                    this.gracePeriodsLogged.delete(relay.id);
                }
            }

            // Check if relay is really dead (past grace period and not connected)
            if (await relay.isReallyDead()) {
                Debug.warn(`Relay ${relay.id} is considered dead (past grace period), removing...`);

                // Get container and remove it
                const infos = await this.docker.listContainers({
                    all: true,
                    filters: { label: ['nox.relay.id'] }
                });

                const info = infos.find(info => info.Labels['nox.relay.id'] === relay.id.toString());
                if (info) {
                    const container = this.docker.getContainer(info.Id);
                    try {
                        await container.stop();
                        await container.remove();
                    } catch (err: any) {
                        // Ignore 404 (not found) and 409 (removal in progress) errors
                        if (err.statusCode !== 404 && err.statusCode !== 409) {
                            Debug.error(`Error removing dead relay container: ${err}`);
                        }
                    }
                }

                await relay.delete();
                this.containerStartTimes.delete(relay.id);
                continue;
            }
        }

        if (await this.isFull()) {
            // Use lock to prevent multiple simultaneous relay creations
            if (this.creatingRelay) {
                Debug.debug('Relay creation already in progress, skipping...');
                return;
            }
            
            this.creatingRelay = true;
            try {
                Debug.log('All relays are full, creating new relay...');
                let rc = await this.newRelayContainer();
                if (rc) {
                    Debug.log(`Created new relay ${rc.relay.id} in container ${rc.container.id}`);
                    await rc.container.start();
                }
                else Debug.warn('Failed to create new relay container');
            } finally {
                this.creatingRelay = false;
            }
        }

    }

    async onContainerDied(event: ContainerEvent): Promise<void> {
        Debug.log(`Container died for relay ${event.relay_id}, removing...`);
        
        // Remove from start time tracking
        this.containerStartTimes.delete(event.relay_id);
        this.gracePeriodsLogged.delete(event.relay_id);

        var relay = await this.app.relays.findRelayById(event.relay_id);

        // Notifier les admins que le relay est down
        await this.app.relays.notifyAdmins('relay_status_change', {
            relay_id: event.relay_id,
            status: 'down',
            timestamp: Date.now(),
            relay: relay ? await relay.toJSON() : null
        });

        try {
            await this.docker.getContainer(event.id).remove();
        } catch (error: any) {
            // Ignore 404 errors (container already removed) and 409 errors (removal in progress)
            if (error.statusCode !== 404 && error.statusCode !== 409) {
                Debug.debug(`Error removing container: ${error}`);
            }
        }
    }

    async onContainerStarted(event: ContainerEvent): Promise<void> {
        Debug.log(`Container started for relay ${event.relay_id}`);
        
        // Track container start time
        this.containerStartTimes.set(event.relay_id, new Date());
        
        var relay = await this.app.relays.findRelayById(event.relay_id);
        if (!relay) {
            Debug.log(`No relay found for container, removing...`);
            await this.docker.getContainer(event.id).remove();
            return;
        }

        // Notifier les admins que le relay est up
        await this.app.relays.notifyAdmins('relay_status_change', {
            relay_id: event.relay_id,
            status: 'up',
            timestamp: Date.now(),
            relay: await relay.toJSON()
        });
    }

    async onContainerDestroyed(event: ContainerEvent): Promise<void> {
        Debug.log(`Container destroyed for relay ${event.relay_id}`);
        
        // Remove from start time tracking
        this.containerStartTimes.delete(event.relay_id);
        this.gracePeriodsLogged.delete(event.relay_id);
        
        var relay = await this.app.relays.findRelayById(event.relay_id);
        
        if (relay) {
            try {
                await relay.delete();
            } catch (error: any) {
                // Ignore P2025 errors (record not found - already deleted)
                if (error.code !== 'P2025') {
                    Debug.debug(`Error deleting relay: ${error}`);
                }
            }
        }

        // Notifier les admins que le relay a été détruit
        await this.app.relays.notifyAdmins('relay_status_change', {
            relay_id: event.relay_id,
            status: 'destroyed',
            timestamp: Date.now(),
            relay: null
        });
    }

    async onContainerCreated(event: ContainerEvent): Promise<void> {
        Debug.log(`Container created for relay ${event.relay_id}`);
        var relay = await this.app.relays.findRelayById(event.relay_id);
        if (!relay) {
            Debug.log(`No relay found for container, removing...`);
            try {
                await this.docker.getContainer(event.id).remove();
            } catch (error: any) {
                if (error.statusCode !== 404) {
                    Debug.debug(`Error removing orphaned container: ${error}`);
                }
            }
            return;
        }

        // Notifier les admins qu'un nouveau relay a été créé
        await this.app.relays.notifyAdmins('relay_status_change', {
            relay_id: event.relay_id,
            status: 'created',
            timestamp: Date.now(),
            relay: await relay.toJSON()
        });
    }


    async newRelayContainer(): Promise<RelayContainer | null> {
        let relay: Relay | null = null;
        try {
            relay = await this.app.relays.createRelay();
            if (!relay)
                throw new Error('Failed to create relay');

            const container = await this.createContainer(relay);
            if (!container)
                throw new Error('Failed to create Docker container for relay');

            return { relay, container };
        } catch (error) {
            Debug.debug('Error creating relay container:', error);
            if (relay) await relay.delete();
            return null;
        }
    }

    async createContainer(relay: Relay): Promise<Docker.Container | null> {
        try {
            const badger = await relay.getBadger();
            if (!badger) {
                Debug.debug(`No badger found for relay ${relay.id}`);
                return null;
            }

            const port = await this.findFreePort();
            if (!port) {
                Debug.debug('No free port available');
                return null;
            }

            Debug.debug(`Creating container for relay ${relay.id} on 127.0.0.1:${port}`);

            const containerConfig = this.buildContainerConfig({
                port,
                badgerToken: badger.token,
                relayId: relay.id
            });

            return await this.docker.createContainer(containerConfig);
        } catch (error) {
            Debug.debug(`Error creating container for relay ${relay.id}:`, error);
            return null;
        }
    }

    async findFreePort(): Promise<number | null> {
        const usedPorts = new Set<number>();
        const containers = await this.docker.listContainers();
        for (const container of containers)
            if (container.Ports)
                for (const portInfo of container.Ports)
                    if (portInfo.PublicPort)
                        usedPorts.add(portInfo.PublicPort);
        for (let port = 30000; port <= 40000; port++)
            if (!usedPorts.has(port))
                return port;
        return null;
    }

    private buildContainerConfig(options: RelayContainerOptions): Docker.ContainerCreateOptions {
        let id = randomBytes(4).toString('hex');
        return {
            Image: Env.getDockerImage(),
            Labels: {
                'nox.relay.id': options.relayId.toString(),
                'nox.relay.process': id,
                'com.docker.compose.project': 'nox',
                'com.docker.compose.service': `relay_${id}`
            },
            Env: [
                `NOX_TOKEN=${options.badgerToken}`,
                `NOX_PORT=${options.port}`,
                'NOX_MAX_TPS=24',
                `NOX_NODE_GATEWAY=http://nox_node:${Env.getPort()}`,
                `NOX_DEBUG=true`
            ],
            name: `relay_${id}`,
            ExposedPorts: {
                [`${options.port}/udp`]: {}
            },
            HostConfig: {
                PortBindings: {
                    [`${options.port}/udp`]: [{ HostPort: options.port.toString() }]
                },
                RestartPolicy: {
                    Name: 'always'
                },
                NetworkMode: 'nox_default'
            }
        };
    }

    async create(relay: Relay): Promise<boolean> {
        try {
            const container = await this.createContainer(relay);
            if (!container) {
                Debug.debug(`Failed to create container for relay ${relay.id}`);
                return false;
            }

            await container.start();
            Debug.log(`Created and started container for relay ${relay.id}`);
            return true;
        } catch (error) {
            Debug.debug(`Error creating relay ${relay.id}:`, error);
            return false;
        }
    }

    async stop(relay: Relay): Promise<boolean> {
        try {
            const infos = await this.docker.listContainers({ all: true, filters: { label: ['nox.relay.id'] } });
            const info = infos.find(info => info.Labels['nox.relay.id'] === relay.id.toString());
            if (!info) {
                Debug.debug(`No container found for relay ${relay.id}`);
                return false;
            }

            const container = this.docker.getContainer(info.Id);
            await container.kill();
            Debug.log(`Stopped container for relay ${relay.id}`);
            return true;
        } catch (error) {
            Debug.debug(`Error stopping relay ${relay.id}:`, error);
            return false;
        }
    }

    async restart(relay: Relay): Promise<boolean> {
        try {
            const infos = await this.docker.listContainers({ all: true, filters: { label: ['nox.relay.id'] } });
            const info = infos.find(info => info.Labels['nox.relay.id'] === relay.id.toString());
            if (!info) {
                Debug.debug(`No container found for relay ${relay.id}`);
                return false;
            }

            const container = this.docker.getContainer(info.Id);
            await container.kill();
            Debug.log(`Restarted container for relay ${relay.id}`);
            return true;
        } catch (error) {
            Debug.debug(`Error restarting relay ${relay.id}:`, error);
            return false;
        }
    }

}
