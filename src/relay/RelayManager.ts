import Relay, { RelayStatus } from './Relay';
import main from '../Main';
import RuntimeManager from './runtime/RuntimeManager';
import DockerManager from './runtime/DockerManager';
import Badger from '../auth/badgers/Badger';
import { randomBytes } from 'node:crypto';
import { WebMessage, WebSocket } from '../network/NetSocket';
import RelayAPIWeb from './RelayAPIWeb';
import UserIdentifier from '../users/UserIdentifier';
import { IUserBlacklist } from '../users/User';
import Debug from '../utils/Debug';
import User from '../users/User';
import WorldIdentifier from '../worlds/WorldIdentifier';
import { SafeLocalAddress } from '../utils/Constants';

export default class RelayManager {
    public runtimes: RuntimeManager[] = [];
    interval: NodeJS.Timeout;
    api_web: RelayAPIWeb;

    constructor(private readonly app: main) {
        this.api_web = new RelayAPIWeb(this.app);
        this.runtimes.push(new DockerManager(this.app));
        this.interval = setInterval(this.checkRuntimes.bind(this), 5000);
        this.app.on('socket:message', this.onSocketMessage.bind(this));
        this.initializeSubscribers();
    }

    /**
     * Initialize WebSocket subscribers for relay events
     */
    private initializeSubscribers() {
        // Register relay_status_change subscriber (admin only)
        this.app.http.socket.addSubscriber('relay_status_change', async (socket) => {
            if (!socket.data.isBearer()) return false;
            const user = await socket.data.getData() as User | null;
            if (!user || !('getTags' in user)) return false;
            return user.getTags().includes('sys:admin');
        });

        // Register relay_logs subscriber (admin only)
        this.app.http.socket.addSubscriber('relay_logs', async (socket) => {
            if (!socket.data.isBearer()) return false;
            const user = await socket.data.getData() as User | null;
            if (!user || !('getTags' in user)) return false;
            return user.getTags().includes('sys:admin');
        });

        // Register relay_specs_update subscriber (admin only)
        this.app.http.socket.addSubscriber('relay_specs_update', async (socket) => {
            if (!socket.data.isBearer()) return false;
            const user = await socket.data.getData() as User | null;
            if (!user || !('getTags' in user)) return false;
            return user.getTags().includes('sys:admin');
        });

        // TODO: restrict to admins only - relay client / player lifecycle events
        const adminValidator = async (socket: WebSocket) => {
            if (!socket.data.isBearer()) return false;
            const user = await socket.data.getData() as User | null;
            if (!user || !('getTags' in user)) return false;
            return user.getTags().includes('sys:admin');
        };
        this.app.http.socket.addSubscriber('relay_client_connected', adminValidator);
        this.app.http.socket.addSubscriber('relay_client_disconnected', adminValidator);
        this.app.http.socket.addSubscriber('relay_player_join', adminValidator);
        this.app.http.socket.addSubscriber('relay_player_leave', adminValidator);
    }

    private async checkRuntimes() {
        if (!this.app.ready_at) return;
        for (const runtime of this.runtimes)
            await runtime.checkHosts();
    }

    /**
     * Notifie tous les admins connectés d'un événement relay
     * Utilise le système de subscription centralisé
     */
    async notifyAdmins(type: string, data: any) {
        try {
            // relay_status_change est géré par le subscriber
            if (type === 'relay_status_change') {
                this.app.http.socket.emitSubscriber('relay_status_change', data);
            } else {
                // Fallback pour autres types d'événements
                await this.app.http.socket.emitEvent(type, data, async (socket) => {
                    if (!socket.data.isBearer()) return false;
                    const user = await socket.data.getData();
                    if (!user || !('getTags' in user)) return false;
                    return user.getTags().includes('sys:admin');
                });
            }
        } catch (error) {
            Debug.error('Error notifying admins:', error);
        }
    }



    async findRelayById(id: number): Promise<Relay | null> {
        const r = await this.app.database.relay.findUnique({ where: { id } });
        if (!r) return null;
        return new Relay(r, this.app);
    }

    async getBadgerByRelayId(id: number): Promise<Badger | null> {
        const r = await this.app.database.badger.findUnique({ where: { relay_id: id } });
        if (!r) return null;
        return new Badger(r, this.app);
    }

    async createRelay(): Promise<Relay | null> {
        const r = await this.app.database.relay.create({
            data: { badger: { create: { token: randomBytes(64).toString('base64') } } }
        });
        if (!r) return null;
        return new Relay(r, this.app);
    }

    async deleteRelay(id: number) {
        try {
            const r = await this.app.database.relay.delete({ where: { id } });
            if (!r) return null;
            return new Relay(r, this.app);
        } catch (error: any) {
            // If relay doesn't exist (P2025), return null (idempotent)
            if (error.code === 'P2025') {
                return null;
            }
            throw error;
        }
    }

    async getRelayByBadgerId(id: number) {
        const r = await this.app.database.relay.findFirst({ where: { badger: { id } } });
        if (!r) return null;
        return new Relay(r, this.app);
    }

    async getRelayByInstanceId(id: number) {
        let relays = await this.app.database.relay.findMany({});
        for (let r of relays) {
            let relay = new Relay(r, this.app);
            const hasInstance = await relay.hasInstance(id);
            if (hasInstance) return relay;
        }
        return null;
    }

    private async onSocketMessage(socket: WebSocket, message: WebMessage) {
        let relay = (socket.data.isBadger() && (await socket.data.getData()) || null) as Relay | null;
        if (!relay) return;
        if (message.type === 'request_instances')
            this.onRequestInstance(relay, message);
        else if (message.type === 'resolve_user')
            this.onResolveUser(relay, message);
        else if (message.type === 'relay_sync_instances')
            this.onSyncInstances(relay, message);
        else if (message.type === 'log')
            this.onRelayLog(relay, message);
        else if (message.type === 'specs')
            this.onRelaySpecs(relay, message);
        else if (message.type === 'client_connected')
            this.onRelayClientConnected(relay, message);
        else if (message.type === 'client_disconnected')
            this.onRelayClientDisconnected(relay, message);
        else if (message.type === 'player_join')
            this.onRelayPlayerJoin(relay, message);
        else if (message.type === 'player_leave')
            this.onRelayPlayerLeave(relay, message);
    }

    /**
     * Handler pour réception d'un log en temps réel d'un relay
     */
    private onRelayLog(relay: Relay, message: WebMessage) {
        try {
            const logData = message.data;

            // Émettre le log aux admins abonnés
            this.app.http.socket.emitSubscriber('relay_logs', {
                relayId: relay.id,
                timestamp: logData.Timestamp,
                level: logData.Level,
                message: logData.Message,
                tag: logData.Tag
            });
        } catch (error) {
            Debug.error('Error handling relay log:', error);
        }
    }

    /**
     * Handler pour réception des specs en temps réel d'un relay
     */
    private onRelaySpecs(relay: Relay, message: WebMessage) {
        try {
            const specs = message.data;

            // Transform specs to full format (c -> cpu, m -> memory, etc.)
            const transformedSpecs = {
                cpu: specs.c,
                memory: specs.m,
                upload: specs.u,
                download: specs.d,
                storage: specs.s
            };

            // Émettre les specs aux admins abonnés
            this.app.http.socket.emitSubscriber('relay_specs_update', {
                relayId: relay.id,
                timestamp: Date.now(),
                specs: transformedSpecs
            });
        } catch (error) {
            Debug.error('Error handling relay specs:', error);
        }
    }

    /**
     * Handler: a QUIC client connected to the relay.
     */
    private onRelayClientConnected(relay: Relay, message: WebMessage) {
        try {
            this.app.http.socket.emitSubscriber('relay_client_connected', {
                relay_id: relay.id,
                timestamp: Date.now(),
                client: {
                    id: message.data.id,
                    address: message.data.address,
                },
            });
        } catch (error) {
            Debug.error('Error handling relay client_connected:', error);
        }
    }

    /**
     * Handler: a QUIC client disconnected from the relay.
     */
    private onRelayClientDisconnected(relay: Relay, message: WebMessage) {
        try {
            this.app.http.socket.emitSubscriber('relay_client_disconnected', {
                relay_id: relay.id,
                timestamp: Date.now(),
                client: {
                    id: message.data.id,
                    address: message.data.address,
                    user: message.data.user ?? null,
                },
            });
        } catch (error) {
            Debug.error('Error handling relay client_disconnected:', error);
        }
    }

    /**
     * Handler: a player joined an instance on the relay.
     */
    private onRelayPlayerJoin(relay: Relay, message: WebMessage) {
        try {
            this.app.http.socket.emitSubscriber('relay_player_join', {
                relay_id: relay.id,
                timestamp: Date.now(),
                player: {
                    client_id: message.data.client_id,
                    player_id: message.data.player_id,
                    instance_id: message.data.instance_id,
                    user: message.data.user ?? null,
                    display: message.data.display,
                },
            });
        } catch (error) {
            Debug.error('Error handling relay player_join:', error);
        }
    }

    /**
     * Handler: a player left an instance on the relay.
     */
    private onRelayPlayerLeave(relay: Relay, message: WebMessage) {
        try {
            this.app.http.socket.emitSubscriber('relay_player_leave', {
                relay_id: relay.id,
                timestamp: Date.now(),
                player: {
                    client_id: message.data.client_id,
                    player_id: message.data.player_id,
                    instance_id: message.data.instance_id,
                    user: message.data.user ?? null,
                },
            });
        } catch (error) {
            Debug.error('Error handling relay player_leave:', error);
        }
    }


    async onResolveUser(relay: Relay, message: WebMessage<ResolveUserRequest, ResolveUserResponse>) {
        var identifier = new UserIdentifier(message.data.user_id, message.data.server);

        var user: {
            id: number;
            server: string;
            display: string;
            blacklist: () => IUserBlacklist | null;
            verify: () => Promise<boolean>;
        } | null = null;

        if (identifier.isLocal()) {
            var luser = await this.app.users.findUserById(message.data.user_id);
            if (luser) user = {
                id: luser.id,
                server: this.app.server.getInfos().address,
                display: luser.display,
                blacklist: luser.getBlacklist.bind(luser),
                verify: async () => await luser?.hasFingerprint(message.data.fingerprint) || false
            };
        } else {
            var serv = await this.app.netServers.findNetServerByAddress(message.data.server);
            if (!serv) return message.reply({
                result: "invalid_user",
                error: "Invalid server"
            });

            var ruser = await this.app.netUsers.findOrFetch(message.data.user_id, serv);
            var fuser = ruser
                ? await ruser.fetchUser()
                : null;

            if (fuser instanceof Error) {
                Debug.error(`Failed to fetch user infos for ${identifier.identifier} on server ${identifier.server}: ${fuser.message}`);
                return message.reply({
                    result: "invalid_user",
                    error: "Failed to fetch user infos"
                });
            }

            if (ruser && fuser)
                user = {
                    id: ruser.id,
                    server: serv.address,
                    display: fuser.display,
                    blacklist: ruser.getBlacklist.bind(ruser),
                    verify: async () => (await ruser?.fetchUser(message.data.fingerprint)) !== null
                };
        }

        if (!user) return message.reply({
            result: "invalid_user",
            error: "Invalid user"
        });

        var blacklist = user.blacklist();
        if (blacklist) return message.reply({
            result: "blacklisted",
            error: blacklist.reason || "You are blacklisted",
            expire_at: blacklist.expires?.getTime() || 0
        });

        var verify = await user.verify();
        if (!verify) return message.reply({
            result: "invalid_user",
            error: "Invalid fingerprint"
        });

        return message.reply({
            result: "success",
            user: {
                id: user.id,
                server: user.server,
                display: user.display
            }
        });
    }
    private async onSyncInstances(
        relay: Relay,
        message: WebMessage<RelaySyncInstancesRequest, RelaySyncInstancesResponse>
    ) {
        try {
            const syncData = message.data;
            Debug.log(`Relay #${relay.id} syncing ${syncData.instances.length} instances (uptime: ${syncData.relay_uptime}s)`);

            // Get current status of ALL relays
            let allStatuses = await Promise.all(
                (await this.app.database.relay.findMany({}))
                    .map(r => new Relay(r, this.app))
                    .map(async r => ({ relay: r, status: await r.getStatus() }))
            );

            // Build a map of instance_id -> relay_id for currently active instances
            const instanceToRelay = new Map<number, number>();
            for (const { relay: r, status } of allStatuses) {
                if (status instanceof Error) continue;
                // Skip the relay that's syncing (to check conflicts)
                if (r.id === relay.id) continue;

                const instancesResult = await r.getInstances(1000, 0);
                if (!(instancesResult instanceof Error)) {
                    for (const instance of instancesResult.instances)
                        instanceToRelay.set(parseInt(instance.id), r.id);
                }
            }

            // Check for conflicts
            const conflictingInstances: Array<{ node_id: number, other_relay_id: number }> = [];
            const validInstances: number[] = [];

            for (const instance of syncData.instances) {
                const conflictRelay = instanceToRelay.get(instance.node_id);

                if (conflictRelay !== undefined) {
                    // CONFLICT: This instance is already on another relay!
                    conflictingInstances.push({
                        node_id: instance.node_id,
                        other_relay_id: conflictRelay
                    });
                    Debug.warn(
                        `CONFLICT: Instance #${instance.node_id} claimed by Relay #${relay.id} ` +
                        `but already on Relay #${conflictRelay} (${instance.player_count} players)`
                    );
                } else validInstances.push(instance.node_id);
            }

            // Determine conflict resolution
            const instancesToRemove: number[] = [];

            if (conflictingInstances.length > 0) {
                for (const conflict of conflictingInstances) {
                    const instanceData = syncData.instances.find(i => i.node_id === conflict.node_id)!;
                    const ourPlayers = instanceData.player_count;

                    // Get the other relay's status
                    const otherRelayStatus = allStatuses.find(s => s.relay.id === conflict.other_relay_id);
                    const otherRelay = otherRelayStatus?.relay;
                    const otherStatus = otherRelayStatus?.status;

                    if (otherStatus instanceof Error || !otherStatus || !otherRelay) {
                        // Other relay is dead, we win
                        Debug.log(`Relay #${relay.id} wins conflict for instance #${conflict.node_id} (other relay dead)`);
                        validInstances.push(conflict.node_id);
                        continue;
                    }

                    const otherInstancesResult = await otherRelay.getInstances(1000, 0);
                    const otherInstance = (otherInstancesResult instanceof Error)
                        ? null
                        : otherInstancesResult.instances.find(i => i.id === conflict.node_id.toString());
                    const theirPlayers = otherInstance?.players.length || 0;

                    // PRIORITY 1: Players count
                    if (ourPlayers > theirPlayers) {
                        Debug.log(`Relay #${relay.id} wins (${ourPlayers} vs ${theirPlayers} players)`);
                        validInstances.push(conflict.node_id);
                        await this.notifyRelayToDropInstance(conflict.other_relay_id, conflict.node_id);
                    } else if (theirPlayers > ourPlayers) {
                        Debug.log(`Relay #${conflict.other_relay_id} wins (${theirPlayers} vs ${ourPlayers} players)`);
                        instancesToRemove.push(conflict.node_id);
                    } else {
                        // PRIORITY 2: Uptime (older wins)
                        const ourUptime = syncData.relay_uptime;
                        const theirUptime = otherStatus.u;

                        if (ourUptime > theirUptime) {
                            Debug.log(`Relay #${relay.id} wins (uptime: ${ourUptime}s vs ${theirUptime}s)`);
                            validInstances.push(conflict.node_id);
                            await this.notifyRelayToDropInstance(conflict.other_relay_id, conflict.node_id);
                        } else if (theirUptime > ourUptime) {
                            Debug.log(`Relay #${conflict.other_relay_id} wins (uptime: ${theirUptime}s vs ${ourUptime}s)`);
                            instancesToRemove.push(conflict.node_id);
                        } else {
                            // PRIORITY 3: Relay ID (deterministic tiebreaker)
                            if (relay.id < conflict.other_relay_id) {
                                Debug.log(`Relay #${relay.id} wins (lower ID)`);
                                validInstances.push(conflict.node_id);
                                await this.notifyRelayToDropInstance(conflict.other_relay_id, conflict.node_id);
                            } else {
                                Debug.log(`Relay #${conflict.other_relay_id} wins (lower ID)`);
                                instancesToRemove.push(conflict.node_id);
                            }
                        }
                    }
                }
            }

            // Verify instances exist in database - filter out undefined/null values
            const validInstancesFiltered = validInstances.filter((id): id is number => typeof id === 'number');
            const dbInstances = await this.app.database.instance.findMany({
                where: { id: { in: validInstancesFiltered } }
            });

            const validDbIds = new Set(dbInstances.map(i => i.id));
            const invalidInstances = validInstancesFiltered.filter(id => !validDbIds.has(id));

            // Update database with valid instances
            if (validDbIds.size > 0) {
                await this.app.database.instance.updateMany({
                    where: { id: { in: Array.from(validDbIds) } },
                    data: {
                        updated_at: new Date()
                    }
                });
            }

            // Combine all instances to remove
            const allInstancesToRemove = [...instancesToRemove, ...invalidInstances];

            message.reply({
                success: true,
                synced_count: validDbIds.size,
                invalid_instances: allInstancesToRemove.length > 0 ? allInstancesToRemove : null,
                conflicts_resolved: conflictingInstances.length
            });

            Debug.log(
                `Synced ${validDbIds.size} instances for Relay #${relay.id} ` +
                `(${allInstancesToRemove.length} removed, ${conflictingInstances.length} conflicts resolved)`
            );

            // Notify admins now that relay is fully synced and ready
            await this.notifyAdmins('relay_status_change', {
                relay_id: relay.id,
                status: 'ready',
                timestamp: Date.now(),
                relay: await relay.toJSON()
            });

        } catch (error) {
            Debug.error(`Error syncing instances for relay #${relay.id}:`, error);
            message.reply({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                synced_count: 0,
                conflicts_resolved: 0
            });
        }
    }

    /**
     * Notifie un relay qu'il doit relâcher une instance (conflit)
     */
    private async notifyRelayToDropInstance(relayId: number, instanceId: number) {
        try {
            const relay = await this.findRelayById(relayId);
            if (!relay) return;

            const socket = await relay.getSocket();
            if (!socket) return;

            socket.emitData('drop_instance', {
                instance_id: instanceId,
                reason: 'conflict_resolution',
                message: 'Another relay has claimed this instance with active players'
            });

            Debug.log(`Sent drop_instance command to Relay #${relayId} for instance #${instanceId}`);
        } catch (error) {
            Debug.error(`Failed to notify relay ${relayId} to drop instance ${instanceId}:`, error);
        }
    }
    private async onRequestInstance(relay: Relay, message: WebMessage) {
        let relays = (await this.app.database.relay.findMany({}))
            .map(r => new Relay(r, this.app));

        let instance_ids = new Set<number>();
        for (let r of relays) {
            const instancesResult = await r.getInstances(1000, 0);
            if (!(instancesResult instanceof Error)) {
                for (const instance of instancesResult.instances)
                    instance_ids.add(parseInt(instance.id));
            }
        }

        Debug.log(`Currently assigned instances: [${Array.from(instance_ids).join(', ')}]`);

        let instances = await this.app.database.instance.findMany({
            where: { id: { notIn: Array.from(instance_ids) } },
            orderBy: { created_at: 'asc' }
        });

        if (instances.length === 0) {
            Debug.warn(`No available instances for relay #${relay.id}`);
            return message.reply({
                success: false,
                error: "No available instances"
            });
        }

        let count = message.data?.count && typeof message.data.count === 'number'
            ? Math.min(instances.length, Math.max(1, Math.floor(message.data.count)))
            : 1;
        let assigned = instances.slice(0, count);

        Debug.log(`Assigning instances [${assigned.map(i => i.id).join(', ')}] to relay #${relay.id} (requested: ${count}, available: ${instances.length})`);
        let o = assigned.map(i => {
            const w = WorldIdentifier.fromString(i.world_ref) || undefined;
            return {
                id: i.id,
                password: i.password,
                capacity: i.capacity,
                world: {
                    id: w?.identifier ?? WorldIdentifier.InvalidId,
                    address: w?.server ?? SafeLocalAddress,
                    version: w?.version ?? WorldIdentifier.NoVersion
                }
            };
        });
        console.log(o);

        message.reply({
            success: true,
            instances: o
        });
    }
}

interface ResolveUserRequest {
    user_id: number;
    server: string;
    fingerprint: string;
}

interface ResolveUserResponse {
    result: "success" | "blacklisted" | "invalid_user";
    user?: {
        id: number;
        server: string;
        display: string;
    };
    error?: string;
    expire_at?: number;
}

interface RelaySyncInstancesRequest {
    instances: Array<{
        node_id: number;
        internal_id: number;
        password: string;
        capacity: number;
        player_count: number;
        world: string;
        flags: any;
    }>;
    relay_uptime: number;
}

interface RelaySyncInstancesResponse {
    success: boolean;
    error?: string;
    synced_count: number;
    invalid_instances?: number[] | null;
    conflicts_resolved: number;
}