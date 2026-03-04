import { ConversationReference as IConversationReference } from '@prisma/client';
import Main from '../Main';
import NetServer from '../server/NetServer';
import User from '../users/User';
import Debug from '../utils/Debug';
import { request } from 'undici';
import { 
    IGetConversationOutput, 
    ISendMessageInput, 
    IOutboxInput, 
    IOutboxOutput, 
    IOutboxOutputMessage, 
    IOutboxOutputRead, 
    IMessage, 
    IOutboxInputMessage, 
    IOutboxInputRead,
    ILocalNotificationEvent
} from './MessageAPITypes';
import NetExpress from '../network/NetExpress';
import ConversationIdentifier from './ConversationIdentifier';
import UserIdentifier from '../users/UserIdentifier';

export default class ConversationReference implements IConversationReference {
    constructor(reference: IConversationReference, private readonly app: Main) {
        this.id = reference.id;
        this.server = reference.server;
        this.user_id = reference.user_id;
        this.created_at = reference.created_at;
        this.updated_at = reference.updated_at;
    }


    id: string; // ID de la conversation sur le serveur autoritaire
    server: number; // ID du serveur autoritaire
    user_id: number; // ID de l'utilisateur local
    created_at: Date;
    updated_at: Date;


    async toIdentifier(): Promise<ConversationIdentifier> {
        var serv = await this.getAddress();
        if (!serv) throw new Error("Cannot get authority address for conversation reference");
        return new ConversationIdentifier(this.id, serv);
    }

    /**
     * Récupère l'utilisateur local associé à cette référence
     */
    async getUser(): Promise<User | null> {
        try {
            return await this.app.users.findUserById(this.user_id);
        } catch (error) {
            Debug.error("Failed to get user for conversation reference:", error);
            return null;
        }
    }

    /**
     * Récupère le serveur autoritaire
     */
    async getServer(): Promise<NetServer | null> {
        try {
            const serverData = await this.app.database.netServer.findUnique({
                where: { id: this.server }
            });
            if (!serverData) return null;

            return await this.app.netServers.findNetServerByAddress(serverData.address);
        } catch (error) {
            Debug.error("Failed to get authority server:", error);
            return null;
        }
    }

    /**
     * Récupère les données complètes de la conversation depuis le serveur autoritaire
     */
    async fetch(): Promise<IGetConversationOutput | null> {
        try {
            const netServer = await this.getServer();
            if (!netServer) {
                Debug.error("Authority server not found");
                return null;
            }

            const serverInfo = await netServer.fetchInfos();
            if (!serverInfo) {
                Debug.error("Cannot fetch server info for authority server");
                return null;
            }

            const url = new URL(`/api/messages/conversations/${this.id}`, serverInfo.gateways.http);

            const response = await request(url, {
                method: "GET",
                headers: {
                    ...(await netServer.requestHeaders())
                }
            });

            if (response && response.statusCode === 200) {
                const body = await response.body.json();

                // Valider la réponse
                const validation = await NetExpress.validateResponse<IGetConversationOutput>(body, 'messages/conversation_response');
                if (!validation.valid) {
                    Debug.error(`Invalid response from authority server:`, validation.errors);
                    return null;
                }

                Debug.log(`Fetched conversation ${this.id} from authority server`);
                return validation.data || null;
            } else {
                Debug.error(`Failed to fetch conversation from authority: ${response?.statusCode}`);
                return null;
            }
        } catch (error) {
            Debug.error("Error fetching conversation from authority:", error);
            return null;
        }
    }

    /**
     * Récupère les messages depuis le serveur autoritaire
     */
    async fetchMessages(limit: number = 50, before?: string): Promise<IMessage[]> {
        try {
            const netServer = await this.getServer();
            if (!netServer) {
                Debug.error("Authority server not found");
                return [];
            }

            const serverInfo = await netServer.fetchInfos();
            if (!serverInfo) {
                Debug.error("Cannot fetch server info for authority server");
                return [];
            }

            const url = new URL(`/api/messages/conversations/${this.id}/messages`, serverInfo.gateways.http);
            url.searchParams.set('limit', limit.toString());
            if (before) {
                url.searchParams.set('before', before);
            }

            const response = await request(url, {
                method: "GET",
                headers: {
                    ...(await netServer.requestHeaders())
                }
            });

            if (response && response.statusCode === 200) {
                const body = await response.body.json() as { messages: IMessage[] };
                Debug.log(`Fetched ${body.messages.length} messages from authority server`);
                return body.messages;
            } else {
                Debug.error(`Failed to fetch messages from authority: ${response?.statusCode}`);
                return [];
            }
        } catch (error) {
            Debug.error("Error fetching messages from authority:", error);
            return [];
        }
    }

    /**
     * Supprime la référence de conversation
     */
    async delete(): Promise<boolean> {
        try {
            await this.app.database.conversationReference.delete({
                where: {
                    id_server_user_id: {
                        id: this.id,
                        server: this.server,
                        user_id: this.user_id
                    }
                }
            });

            Debug.log(`Deleted conversation reference ${this.id} for user ${this.user_id}`);
            return true;
        } catch (error) {
            Debug.error("Failed to delete conversation reference:", error);
            return false;
        }
    }

    /**
     * Récupère l'adresse du serveur autoritaire
     */
    async getAddress(): Promise<string | null> {
        try {
            const serverData = await this.app.database.netServer.findUnique({
                where: { id: this.server }
            });
            return serverData?.address || null;
        } catch (error) {
            Debug.error("Failed to get authority server address:", error);
            return null;
        }
    }

    /**
     * Envoie un événement au serveur autoritaire via /api/messages/outbox
     */
    private async sendOutbox<TI extends IOutboxInput, TO extends IOutboxOutput>(type: TI["type"], data: TI['data']): Promise<TO | null> {
        try {
            const netServer = await this.getServer();
            if (!netServer) {
                Debug.error("Authority server not found");
                return null;
            }

            const serverInfo = await netServer.fetchInfos();
            if (!serverInfo) {
                Debug.error("Cannot fetch server info for authority server");
                return null;
            }

            const url = new URL(`/api/messages/outbox`, serverInfo.gateways.http);
            const response = await request(url, {
                method: "POST",
                headers: {
                    ...(await netServer.requestHeaders()),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type, data: data })
            });

            if (response && response.statusCode === 200) {
                const body = await response.body.json();

                // Valider la réponse
                const validation = await NetExpress.validateResponse<TO>(body, 'messages/outbox_response');
                if (!validation.valid) {
                    Debug.error(`Invalid response from authority server:`, validation.errors);
                    return null;
                }

                Debug.log(`Sent ${type} event to authority server`);
                return validation.data || null;
            } else {
                Debug.error(`Failed to send ${type} event to authority: ${response?.statusCode}`);
                return null;
            }
        } catch (error) {
            Debug.error(`Error sending ${type} event to authority server:`, error);
            return null;
        }
    }


    async sendMessage(author: UserIdentifier, data: ISendMessageInput): Promise<IOutboxOutputMessage | null> {
        try {
            // Construire l'événement create_message (le serveur autoritaire génèrera l'ID et le timestamp)
            const result = await this.sendOutbox<IOutboxInputMessage, IOutboxOutputMessage>('create_message', {
                conversation_id: this.id,
                user: author.identifierAsId(),
                content: data.content,
                attachments: data.attachments || [],
                reply: data.reply || null
            });

            return result;
        } catch (error) {
            Debug.error("Error sending message to authority server:", error);
            return null;
        }
    }

    async getMessages(limit: number = 50, before?: Date): Promise<IMessage[]> {
        try {
            const beforeTimestamp = before ? before.getTime().toString() : undefined;
            const messages = await this.fetchMessages(limit, beforeTimestamp);
            return messages;
        } catch (error) {
            Debug.error("Error getting messages from authority server:", error);
            return [];
        }
    }

    async markAsRead(user: UserIdentifier): Promise<IOutboxOutputRead | null> {
        try {
            return await this.sendOutbox<IOutboxInputRead, IOutboxOutputRead>('read', {
                conversation_id: this.id,
                user: user.identifierAsId()
            });
        } catch (error) {
            Debug.error("Error marking conversation as read on authority server:", error);
            return null;
        }
    }

    /**
     * Notifie l'utilisateur local associé à cette référence d'un événement
     */
    async notifyUser<T extends ILocalNotificationEvent>(type: T["type"], data: T["data"]): Promise<boolean> {
        try {
            const user = await this.getUser();
            if (!user)
                throw new Error("Local user not found for conversation reference");
            const sockets = await user.getSockets();
            for (const socket of sockets) 
                socket.emitData(`messages:${type}`, data);
            return true;
        } catch (error) {
            Debug.error(`[INBOX] Failed to notify user:`, error);
            return false;
        }
    }
}
