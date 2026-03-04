import { request } from "undici";
import Reileta from "../Main";
import NetServer from "../server/NetServer";
import NetUser from "../users/NetUser";
import PresenceAPIWeb, { IResquestPresenceByServerData, IResquestPresenceLocationData } from "./PresenceAPIWeb";
import User from "../users/User";
import InstanceManager from "../instances/InstanceManager";
import InstanceIdentifier from "../instances/InstanceIdentifier";
import WorldIdentifier from "../worlds/WorldIdentifier";
import Presence from "./Presence";

export default class PresenceManager {

    api_web: PresenceAPIWeb;

    constructor(private readonly main: Reileta) {
        this.api_web = new PresenceAPIWeb(main, this);
    }

    async sendPresenceLocation(data: IResquestPresenceLocationData, toUsers: (NetUser | User)[]) {
        let localUsers: User[] = [];
        let remoteUsers: Map<string, { server: NetServer, users: NetUser[], result: boolean }> = new Map();
        for (let user of toUsers)
            if (user instanceof User) {
                localUsers.push(user);
            } else if (user instanceof NetUser) {
                let serverId = user.server_id;
                if (!serverId) continue;
                let remote = remoteUsers.get(serverId.toString()) || { server: await user.getNetServer(), users: [] as NetUser[], result: false };
                remote.users.push(user);
                remoteUsers.set(serverId.toString(), remote);
            }
        for (let [serverId, remote] of remoteUsers) {
            let result = await this.sendPresenceLocationToServer(data, remote.server, remote.users);
            remote.result = result;
            remoteUsers.set(serverId, remote);
        }

        let local_result = await this.makePresenceLocation({
            type: data.type,
            to: localUsers,
            mode: data.mode,
            instance: data.instance,
            world: data.world
        }, 'user');

        return {
            local: {
                users: localUsers,
                result: local_result
            },
            remote: Array.from(remoteUsers.values()).map(remote => ({
                server: remote.server,
                users: remote.users,
                result: remote.result
            }))
        };
    }

    async sendPresenceLocationToServer(data: IResquestPresenceLocationData, server: NetServer, toUsers: NetUser[]): Promise<boolean> {
        try {
            let body: IResquestPresenceByServerData & IResquestPresenceLocationData = {
                type: 'location',
                to: toUsers.map(u => u.id),
                mode: data.mode,
                instance: data.instance,
                world: data.world
            };

            let infos = await server.fetchInfos();
            if (!infos) return false;
            let response = await request(new URL('/api/presence', infos.gateways.http), {
                method: 'POST',
                headers: {
                    ...this.main.server.defaultHeaders,
                    ...await server.requestHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });

            if (response.statusCode !== 200) return false;
            var response_data = await response.body.json() as { data?: { success: true }, error?: any };

            return response_data.data?.success || false;
        } catch { }
        return false;
    }

    async makePresenceLocation(data: IResquestPresenceLocationData & { to: User[] }, by: 'user' | 'server'): Promise<Presence[]> {
        try {
            let transaction = await this.main.database.$transaction(data.to
                .map(user => this.main.database.presence.create({
                    data: {
                        user_id: user.id,
                        type: 'location',
                        data: {
                            mode: data.mode,
                            instance: data.instance,
                            world: data.world,
                            by: by
                        }
                    }
                })));

            var instance = InstanceIdentifier.fromString(data.instance) as InstanceIdentifier;
            var world = WorldIdentifier.fromString(data.world) as WorldIdentifier;

            for (let user of data.to) {
                let socket = await user.getSockets();
                for (let s of socket) s.emitData('user_presence', {
                    type: 'location',
                    mode: data.mode,
                    instance: instance.toString(this.main.server.getInfos().address),
                    world: world.toString(this.main.server.getInfos().address),
                    by: by
                });
            }

            return transaction.map(presence => new Presence(presence, this.main));
        } catch { }
        return [];
    }
}