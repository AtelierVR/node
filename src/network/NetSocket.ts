import Reileta from "../Main";
import NetHTTP from "./NetHTTP";
import NetData from "./NetData";
import { Server, WebSocket as IWebSocket, RawData } from "ws";
import { IncomingMessage } from "http";
import User from "../users/User";
import { IRUserMe } from "../users/UserAPIWeb";
import Debug from "../utils/Debug";
import Env from "../utils/Environment";
import { presenceToApi } from "../utils/Presence";
import { Security } from "../utils/Security";
import Relay from "../relay/Relay";

export default class NetSocket {
    private websocket: Server;
    private subscriptions: Map<WebSocket, Set<string>> = new Map();
    private validators: Map<string, (socket: WebSocket) => Promise<boolean>> = new Map();

    constructor(private readonly app: Reileta, private readonly http: NetHTTP) {
        this.websocket = new Server({
            server: this.http.server,
            path: '/api/ws',
        });

        this.websocket.on('connection', (socket: WebSocket, req) => this.onConnection(socket, req));
    }

    get randomId() {
        return Math.random().toString(36).substring(2, 15);
    }

    generateReply(msg: WebMessage, socket: WebSocket) {
        function reply(data: any) {
            if (typeof data !== 'object') return;
            (socket as any).send(JSON.stringify({ type: msg.type, id: msg.id, data }));
        }
        return reply;
    }
    async onConnection(socket: WebSocket, req: IncomingMessage) {
        socket.data = new NetData(this.app, req);

        socket.emitData = (type: string, data: any) => {
            if (socket.readyState === WebSocket.OPEN)
                (socket as any).send(JSON.stringify({ type, data, callback: false, id: this.randomId }));
        };

        socket.sendData = (type: string, data: any) => new Promise(resolve => {
            if (socket.readyState !== WebSocket.OPEN)
                return resolve(new Error("Socket not open"));
            const uid = this.randomId;
            const listener = (raw: any) => {
                const message = JSON.parse(raw.toString()) as WebMessage;
                if (message.id !== uid || message.type !== type) return;
                message.reply = this.generateReply(message, socket);
                socket.removeListener('message', listener);
                resolve(message.data);
            };
            socket.on('message', listener);
            (socket as any).send(JSON.stringify({ type, id: uid, data }));
            setTimeout(() => {
                socket.removeListener('message', listener);
                resolve(new Error("Response timeout"));
            }, 5000);
        });

        socket.on('message', (message) => this.onMessage(socket, message));
        this.app.emit('socket:connection', socket);
        socket.on('close', async () => {
            this.app.emit('socket:disconnection', socket);

            // Clean up subscriptions
            this.subscriptions.delete(socket);

            // Track relay disconnection
            if (socket.data.isBadger()) {
                const relay = await socket.data.getData() as Relay | null;
                if (relay) {
                    relay.updateLastDisconnection();
                    Debug.log(`Relay #${relay.id} disconnected, entering grace period`);

                    // Notify admins that relay is disconnected
                    await this.app.relays.notifyAdmins('relay_status_change', {
                        relay_id: relay.id,
                        status: 'disconnected',
                        timestamp: Date.now(),
                        relay: await relay.toJSON()
                    });
                }
            }
        });
        var user = (socket.data.isBearer() && (await socket.data.getData()) || null) as User | null;
        if (user) {
            var http = this.app.server.getInfos().gateways.http;
            var web = this.app.server.getInfos().gateways.web;
            var address = this.app.server.getInfos().address;
            socket.sendData<IRUserMe>('user_connected', {
                id: user.id,
                username: user.username,
                display: user.display,
                bio: user.bio || null,
                pronoun: user.pronoun,
                server: address,
                tags: user.getTags(),
                thumbnail: user.getThumbnail(http)?.href || null,
                banner: user.getBanner(http)?.href || null,
                home: user.getHomeRef()?.toString(address) || null,
                avatar: user.getAvatarRef()?.toString(address) || null,
                links: user.getLinks(),
                relations: null,
                email: user.email,
                email_verified: user.email_verified,
                rank: user.rank,
                created_at: user.created_at.getTime(),
                twofa_enabled: user.twofa_enabled,
                certificate: Security.compactCertificate(Security.certificateToPem(user.publicCertificate)),
                followers: await user.getFollowersCount(),
                following: await user.getFollowingCount(),
                presence: {
                    status: presenceToApi(user.presence),
                    text: user.presence_status,
                },
                alias: await user.alias(),
            });
            Debug.log(`[${Env.sync('HIDE_IP') ? `<hidden>` : socket.data.ip}] SOCKET Connected as '${user.username}'`);
            return;
        }

        var relay = (socket.data.isBadger() && (await socket.data.getData()) || null) as Relay | null;
        if (relay) {
            relay.updateLastConnection();
            socket.sendData('relay_connected', {
                id: relay.id,
                node_address: this.app.server.getInfos().address
            });
            Debug.log(`[${Env.sync('HIDE_IP') ? `<hidden>` : socket.data.ip}] SOCKET Connected as 'Relay #${relay.id}'`);

            // Simple notification that relay socket is connected
            // Full status will be sent after sync in RelayManager.onSyncInstances
            await this.app.relays.notifyAdmins('relay_status_change', {
                relay_id: relay.id,
                status: 'connected',
                timestamp: Date.now(),
                relay: await relay.toJSON()
            });

            return;
        }

        Debug.log(`[${Env.sync('HIDE_IP') ? `<hidden>` : socket.data.ip}] SOCKET Connected as 'Guest'`);
    }

    onMessage(socket: WebSocket, raw: RawData) {
        this.app.emit('socket:raw_message', socket, raw);
        try {
            const message = JSON.parse(raw.toString()) as WebMessage;
            if (typeof message !== 'object' || typeof message.type !== 'string' || message.type.length === 0) return;
            message.reply = this.generateReply(message, socket);
            this.app.emit('socket:message', socket, message);

            if (message.type === 'ping') {
                let received = message.data?.time && typeof message.data.time === 'number' ? message.data.time : 0;
                message.reply({ time: Date.now(), received });
            }
            else if (message.type === 'subscribe')
                // Handle subscribe asynchronously
                this.handleSubscribe(socket, message);
            else if (message.type === 'unsubscribe')
                this.handleUnsubscribe(socket, message);

        } catch { }
    }

    get sockets() {
        return this.websocket.clients as Set<WebSocket>;
    }

    async getSocketsByUserId(id: number) {
        let li: WebSocket[] = [];
        for (let socket of this.sockets)
            if (socket.data.isBearer() && (await socket.data.getData())?.id === id) li.push(socket);
        return li;
    }

    async getSocketsByRelayId(id: number) {
        let li: WebSocket[] = [];
        for (let socket of this.sockets)
            if (socket.data.isBadger() && (await socket.data.getData())?.id === id) li.push(socket);
        return li;
    }

    /**
     * Register a subscriber with validation
     * @param name Subscriber event name
     * @param onValidate Validation function that returns true if the socket is allowed to subscribe
     */
    addSubscriber(name: string, onValidate: (socket: WebSocket) => Promise<boolean>) {
        this.validators.set(name, onValidate);
        Debug.log(`Registered subscriber '${name}' with validation`);
    }

    /**
     * Remove a registered subscriber
     * @param name Subscriber event name
     */
    removeSubscriber(name: string) {
        this.validators.delete(name);
        Debug.log(`Unregistered subscriber '${name}'`);
    }

    /**
     * Emit data to all subscribers of an event
     * @param name Event name
     * @param params Parameters to send
     */
    emitSubscriber(name: string, ...params: any[]) {
        return this.emitEvent(name, params.length === 1 ? params[0] : params);
    }

    /**
     * Handle subscribe message from client
     */
    private async handleSubscribe(socket: WebSocket, message: WebMessage) {
        const { events } = message.data;
        if (!Array.isArray(events)) {
            message.reply({ success: false, error: 'events must be an array' });
            return;
        }

        if (!this.subscriptions.has(socket)) {
            this.subscriptions.set(socket, new Set());
        }

        const socketSubscriptions = this.subscriptions.get(socket)!;
        const addedEvents: string[] = [];
        const deniedEvents: string[] = [];

        for (const event of events) {
            if (typeof event === 'string' && event.length > 0) {
                // Check if this event has a validator
                const validator = this.validators.get(event);
                if (validator) {
                    // Run validation
                    const isValid = await validator(socket);
                    if (!isValid) {
                        deniedEvents.push(event);
                        continue;
                    }
                }

                socketSubscriptions.add(event);
                addedEvents.push(event);
            }
        }

        message.reply({
            success: true,
            subscribed: addedEvents,
            denied: deniedEvents.length > 0 ? deniedEvents : undefined,
            total: socketSubscriptions.size
        });

        if (addedEvents.length > 0)
            Debug.debug(`[${Env.sync('HIDE_IP') ? '<hidden>' : socket.data.ip}] Subscribed to events: ${addedEvents.join(', ')}`);
        if (deniedEvents.length > 0)
            Debug.debug(`[${Env.sync('HIDE_IP') ? '<hidden>' : socket.data.ip}] Denied subscription to events: ${deniedEvents.join(', ')}`);
    }

    /**
     * Handle unsubscribe message from client
     */
    private handleUnsubscribe(socket: WebSocket, message: WebMessage) {
        const { events } = message.data;
        if (!Array.isArray(events)) {
            message.reply({ success: false, error: 'events must be an array' });
            return;
        }

        const socketSubscriptions = this.subscriptions.get(socket);
        if (!socketSubscriptions) {
            message.reply({ success: true, unsubscribed: [], total: 0 });
            return;
        }

        const removedEvents: string[] = [];

        for (const event of events) {
            if (typeof event === 'string' && socketSubscriptions.has(event)) {
                socketSubscriptions.delete(event);
                removedEvents.push(event);
            }
        }

        message.reply({
            success: true,
            unsubscribed: removedEvents,
            total: socketSubscriptions.size
        });

        Debug.debug(`[${Env.sync('HIDE_IP') ? '<hidden>' : socket.data.ip}] Unsubscribed from events: ${removedEvents.join(', ')}`);
    }

    /**
     * Emit an event to all subscribed clients
     * @param event Event name
     * @param data Event data
     * @param filter Optional filter function to select which sockets receive the event
     */
    emitEvent<T = any>(event: string, data: T, filter?: (socket: WebSocket) => boolean | Promise<boolean>) {
        return this.emitEventAsync(event, data, filter);
    }

    /**
     * Emit an event to all subscribed clients (async version)
     */
    async emitEventAsync<T = any>(event: string, data: T, filter?: (socket: WebSocket) => boolean | Promise<boolean>) {
        let count = 0;

        for (const [socket, events] of this.subscriptions.entries()) {
            if (!events.has(event)) continue;
            if (socket.readyState !== WebSocket.OPEN) continue;

            // Apply filter if provided
            if (filter) {
                const shouldSend = await filter(socket);
                if (!shouldSend) continue;
            }

            socket.emitData(`event:${event}`, data);
            count++;
        }

        return count;
    }

    /**
     * Get all subscriptions for a socket
     */
    getSubscriptions(socket: WebSocket): Set<string> | undefined {
        return this.subscriptions.get(socket);
    }

    /**
     * Get all sockets subscribed to a specific event
     */
    getSubscribersForEvent(event: string): WebSocket[] {
        const subscribers: WebSocket[] = [];
        for (const [socket, events] of this.subscriptions.entries()) {
            if (events.has(event) && socket.readyState === WebSocket.OPEN) {
                subscribers.push(socket);
            }
        }
        return subscribers;
    }
}

export interface WebSocket extends IWebSocket {
    data: NetData;
    emitData<T = any>(type: string, data: T): void;
    sendData<T = any, TR = any>(type: string, data: T): Promise<TR | Error>;
}

export interface WebMessage<T = any, TR = any> {
    type: string;
    id: string;
    data: T;
    reply: (data: TR) => void;
}