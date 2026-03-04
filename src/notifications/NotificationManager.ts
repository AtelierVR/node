import { $Enums } from "@prisma/client";
import Main from "../Main";
import NetServer from "../server/NetServer";
import UserIdentifier from "../users/UserIdentifier";
import NotificationAPIWeb, { IMakeNotification, IMakeNotificationResponse } from "./NotificationAPIWeb";
import User from "../users/User";
import { Notification as INotification } from "@prisma/client";
import Notification from "./Notification";
import NetUser from "../users/NetUser";
import { normalize } from "path";
import { request } from "undici";

export default class NotificationManager {

    api_web: NotificationAPIWeb;

    constructor(private readonly main: Main) {
        this.api_web = new NotificationAPIWeb(this.main, this);
    }

    // receive notification
    async makeNotification(data: IMakeNotificationObject): Promise<Notification[]> {
        try {
            let transaction = await this.main.database.$transaction(data.to
                .map(user => this.main.database.notification.create({
                    data: {
                        type: data.type,
                        to_user_id: user.id,
                        data: data.data,
                        external_id: data.external_id,
                        expires_at: data.expires_at
                    }
                }))
            );
            for (let user of data.to) {
                let socket = await user.getSockets();
                for (let s of socket) s.emitData('notification_' + data.type, data.data);
            }
            return transaction.map(notification => new Notification(notification, this.main));
        } catch { }
        return [];
    }

    // send notification
    async sendNotifications(data: ISendNotificationObject, toUsers: (NetUser | User)[]) {
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
            let result = await this.sendNotificationToServer(data, remote.server, remote.users);
            remote.result = result;
            remoteUsers.set(serverId, remote);
        }

        let local_result = await this.makeNotification({
            type: data.type,
            to: localUsers,
            data: data.data,
            external_id: data.external_id,
            expires_at: data.expires_at
        });

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

    async sendNotificationToServer(data: ISendNotificationObject, server: NetServer, toUsers: NetUser[]): Promise<boolean> {
        try {
            let body: IMakeNotification = {
                type: normalize(data.type),
                to: toUsers.map(user => user.id),
                data: data.data,
                external_id: data.external_id,
                expires_at: data.expires_at?.getTime()
            };
            let infos = await server.fetchInfos();
            if (!infos) return false;
            let response = await request(new URL('/api/notification', infos.gateways.http), {
                method: 'POST',
                headers: {
                    ...this.main.server.defaultHeaders,
                    ...await server.requestHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });
            if (response.statusCode !== 200) return false;
            var response_data = await response.body.json() as { data?: IMakeNotificationResponse, error?: any };
            if (response_data.error || !response_data.data) return false;
            return true;
        } catch { }
        return false;
    }




    async getNotifications(user: User, after: Date | null, limit: number, offset: number): Promise<{
        notifications: Notification[];
        total: number;
    }> {
        let notifications: INotification[] = [];
        let total: number = 0;
        try {
            let query: any = {
                to_user_id: user.id,
                created_at: {
                    gt: after || new Date(0)
                },
                OR: [
                    { expires_at: null },
                    { expires_at: { gt: new Date() } }
                ]
            };
            notifications = await this.main.database.notification.findMany({
                where: query,
                orderBy: { created_at: "desc" },
                skip: offset,
                take: limit
            });
            total = await this.main.database.notification.count({ where: query });
        } catch { }
        return {
            notifications: notifications.map(notification => new Notification(notification, this.main)),
            total
        };
    }


}

export interface ISendNotificationObject {
    type: string;
    to: User[];
    data: any;
    external_id?: string;
    expires_at?: Date;
}

export interface IMakeNotificationObject {
    type: string;
    to: User[];
    data: any;
    external_id?: string;
    expires_at?: Date;
}
