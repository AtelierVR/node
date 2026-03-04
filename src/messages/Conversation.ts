import { ConversationMember, Conversation as IConversation, ConversationMember as IConversationMember } from '@prisma/client';
import Main from '../Main';
import UserIdentifier from '../users/UserIdentifier';
import Debug from '../utils/Debug';
import ConversationIdentifier from './ConversationIdentifier';
import Message from './Message';
import { ISendMessageInput, IInboxInput, ILocalNotificationEvent } from './MessageAPITypes';
import { request } from 'undici';
import { SafeLocalAddress } from '../utils/Constants';

export default class Conversation implements IConversation {
    constructor(conversation: IConversation, private readonly app: Main) {
        this.id = conversation.id;
        this.title = conversation.title;
        this.thumbnail = conversation.thumbnail;
        this.created_at = conversation.created_at;
        this.updated_at = conversation.updated_at;
        this.last_message = conversation.last_message;
    }
    id: string;
    title: string | null;
    thumbnail: string | null;
    created_at: Date;
    updated_at: Date;
    last_message: Date | null;

    toIdentifier(): ConversationIdentifier {
        return new ConversationIdentifier(this.id);
    }

    /**
     * Récupère les membres de la conversation
     */
    async getMembers(): Promise<IConversationMember[]> {
        try {
            return await this.app.database.conversationMember.findMany({
                where: { conversation_id: this.id }
            });
        } catch (error) {
            Debug.error("Failed to get conversation members:", error);
            return [];
        }
    }

    /**
     * Récupère les messages de la conversation
     */
    async getMessages(limit: number = 50, before?: Date): Promise<Message[]> {
        try {
            const messages = await this.app.database.message.findMany({
                where: {
                    conversation_id: this.id,
                    ...(before && { created_at: { lt: before } })
                },
                orderBy: { created_at: 'desc' },
                take: limit
            });
            return messages.map(m => new Message(m, this.app));
        } catch (error) {
            Debug.error("Failed to get messages:", error);
            return [];
        }
    }

    /**
     * Vérifie si un utilisateur est membre de la conversation
     */
    async isMember(user: UserIdentifier): Promise<boolean> {
        try {
            const userRef = user.toString();
            const member = await this.app.database.conversationMember.findUnique({
                where: {
                    conversation_id_user_ref: {
                        conversation_id: this.id,
                        user_ref: userRef
                    }
                }
            });
            return !!member;
        } catch (error) {
            Debug.error("Failed to check membership:", error);
            return false;
        }
    }

    /**
     * Récupère le thumbnail de la conversation
     */
    getThumbnail(): URL | null {
        if (this.thumbnail) {
            if (this.thumbnail.startsWith('file://')) {
                // For local files, return a URL pointing to our API endpoint
                try {
                    return new URL(`/api/messages/conversations/${this.id}/thumbnail`, this.app.server.getInfos().gateways.http);
                } catch { }
            } else {
                // For external URLs, return as-is
                try {
                    return new URL(this.thumbnail);
                } catch { }
            }
        }
        return null;
    }

    /**
     * Sauvegarde les modifications de la conversation
     */
    async save(): Promise<boolean> {
        try {
            await this.app.database.conversation.update({
                where: { id: this.id },
                data: {
                    title: this.title,
                    thumbnail: this.thumbnail,
                    updated_at: new Date()
                }
            });
            return true;
        } catch (error) {
            Debug.error("Failed to save conversation:", error);
            return false;
        }
    }

    /**
     * Supprime la conversation
     */
    async delete(): Promise<boolean> {
        try {
            await this.app.database.conversation.delete({
                where: { id: this.id }
            });
            return true;
        } catch (error) {
            Debug.error("Failed to delete conversation:", error);
            return false;
        }
    }

    /**
     * Vérifie si ce serveur est autoritaire pour cette conversation
     */
    isAuthoritative(): boolean {
        // Si la conversation existe localement, ce serveur est autoritaire
        return true;
    }

    /**
     * Récupère le nombre de messages non lus pour un utilisateur
     */
    async getUnreadCount(user: UserIdentifier): Promise<number> {
        try {
            const userRef = user.toString();
            const member = await this.app.database.conversationMember.findUnique({
                where: {
                    conversation_id_user_ref: {
                        conversation_id: this.id,
                        user_ref: userRef
                    }
                }
            });

            if (!member) return 0;

            const count = await this.app.database.message.count({
                where: {
                    conversation_id: this.id,
                    created_at: {
                        gt: member.last_read_at || new Date(0)
                    }
                }
            });

            return count;
        } catch (error) {
            Debug.error("Failed to get unread count:", error);
            return 0;
        }
    }

    /**
     * Obtient le dernier message de la conversation
     */
    async getLastMessage(): Promise<Message | null> {
        try {
            const message = await this.app.database.message.findFirst({
                where: { conversation_id: this.id },
                orderBy: { created_at: 'desc' }
            });
            return message ? new Message(message, this.app) : null;
        } catch (error) {
            Debug.error("Failed to get last message:", error);
            return null;
        }
    }

    /**
     * Envoie un événement inbox aux serveurs externes pour notifier les membres distants
     */
    private async sendInbox<TI extends IInboxInput>(type: TI["type"], data: TI['data']): Promise<void> {
        try {
            // Récupérer tous les membres de la conversation
            const members = await this.getMembers();

            // Grouper les membres par serveur distant
            const serverMembers = new Map<number, number[]>();

            for (const member of members) {
                const userIdentifier = UserIdentifier.fromString(member.user_ref);

                // Ignorer les utilisateurs locaux
                if (!userIdentifier.server) continue;

                // Récupérer le serveur
                const netServer = await this.app.netServers.findNetServerByAddress(userIdentifier.server);
                if (!netServer) {
                    Debug.warn(`Server ${userIdentifier.server} not found for user ${member.user_ref}`);
                    continue;
                }

                // Grouper par serveur
                if (!serverMembers.has(netServer.id))
                    serverMembers.set(netServer.id, []);
                serverMembers.get(netServer.id)!.push(userIdentifier.identifierAsId());
            }

            // Envoyer l'événement à chaque serveur distant
            for (const [serverId, userIds] of serverMembers.entries()) {
                const netServer = await this.app.database.netServer.findUnique({
                    where: { id: serverId }
                });

                if (!netServer) continue;

                const server = await this.app.netServers.findNetServerByAddress(netServer.address);
                if (!server) continue;

                const serverInfo = await server.fetchInfos();
                if (!serverInfo) continue;

                try {
                    const url = new URL(`/api/messages/inbox`, serverInfo.gateways.http);
                    const response = await request(url, {
                        method: "POST",
                        headers: {
                            ...(await server.requestHeaders()),
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ type, data })
                    });

                    if (response && response.statusCode === 200) {
                        Debug.log(`[INBOX] Sent ${type} event to server ${netServer.address}`);
                    } else {
                        Debug.error(`[INBOX] Failed to send ${type} event to server ${netServer.address}: ${response?.statusCode}`);
                    }
                } catch (error) {
                    Debug.error(`[INBOX] Error sending ${type} event to server ${netServer.address}:`, error);
                }
            }
        } catch (error) {
            Debug.error(`[INBOX] Failed to send inbox event:`, error);
        }
    }

    /**
     * Notifie les utilisateurs locaux d'un événement via WebSocket
     */
    private async notifyUsers<T extends ILocalNotificationEvent>(type: T["type"], data: T["data"]): Promise<void> {
        try {
            const members = await this.getMembers();
            for (const member of members) {
                const uid = UserIdentifier.fromString(member.user_ref);
                if (uid.server || uid.server == SafeLocalAddress) continue;
                const user = await this.app.users.findUserById(uid.identifierAsId());
                if (!user) continue;
                const sockets = await user.getSockets();
                for (const socket of sockets)
                    socket.emitData(`messages:${type}`, data);
            }
        } catch (error) {
            Debug.error(`[LOCAL] Failed to notify local users:`, error);
        }
    }

    async sendMessage(author: UserIdentifier, data: ISendMessageInput): Promise<Message | null> {
        try {
            const message = new Message(await this.app.database.message.create({
                data: {
                    conversation_id: this.id,
                    author_ref: author.toString(),
                    content: data.content,
                    attachments: (data.attachments as any) || [],
                    reply_to: data.reply
                }
            }), this.app);

            // Mettre à jour le timestamp du dernier message
            await this.app.database.conversation.update({
                where: { id: this.id },
                data: { last_message: message.created_at }
            });

            this.last_message = message.created_at;

            Debug.log(`Message ${message.id} sent in conversation ${this.id}`);

            // Notifier les utilisateurs locaux
            await this.notifyUsers('create', {
                conversation_id: this.id,
                message: {
                    id: message.id,
                    author: message.author_ref,
                    content: message.content,
                    attachments: message.getAttachments(),
                    reply: message.reply_to,
                    created_at: message.created_at.getTime(),
                    edited_at: message.edited_at ? message.edited_at.getTime() : null
                }
            });

            // Notifier les serveurs externes
            await this.sendInbox<IInboxInput>('create_message', {
                conversation_id: this.id,
                user: author.identifierAsId(),
                content: data.content,
                attachments: data.attachments || [],
                reply: data.reply || null
            });

            return message;
        } catch (error) {
            Debug.error("Failed to send message:", error);
            return null;
        }
    }

    async markAsRead(user: UserIdentifier): Promise<boolean> {
        try {
            await this.app.database.conversationMember.update({
                where: {
                    conversation_id_user_ref: {
                        conversation_id: this.id,
                        user_ref: user.toString()
                    }
                },
                data: {
                    last_read_at: new Date()
                }
            });

            // Notifier les utilisateurs locaux
            await this.notifyUsers('read', {
                conversation_id: this.id,
                user: user.toString()
            });

            // Notifier les serveurs externes
            await this.sendInbox<IInboxInput>('read', {
                conversation_id: this.id,
                user: user.identifierAsId()
            });

            return true;
        } catch (error) {
            Debug.error("Failed to mark as read:", error);
            return false;
        }
    }

    async deleteMessage(id: string, identifier: UserIdentifier): Promise<boolean> {
        try {
            await this.app.database.message.delete({
                where: {
                    id: id,
                    conversation_id: this.id,
                    author_ref: identifier.toString()
                }
            });

            // Notifier les utilisateurs locaux
            await this.notifyUsers('delete_message', {
                conversation_id: this.id,
                user: identifier.toString(),
                message_id: id
            });

            // Notifier les serveurs externes
            await this.sendInbox<IInboxInput>('delete_message', {
                conversation_id: this.id,
                user: identifier.identifierAsId(),
                message_id: id
            });

            return true;
        } catch (error) {
            Debug.error("Failed to delete message:", error);
            return false;
        }
    }


    async notifyTyping(identifier: UserIdentifier, is_typing: boolean): Promise<boolean> {
        try {
            // Notifier les utilisateurs locaux
            await this.notifyUsers('typing', {
                conversation_id: this.id,
                user: identifier.toString(),
                is_typing: is_typing
            });

            // Notifier les serveurs externes
            await this.sendInbox<IInboxInput>('typing', {
                conversation_id: this.id,
                user: identifier.identifierAsId(),
                is_typing: is_typing
            });

            return true;
        } catch (error) {
            Debug.error("Failed to notify typing:", error);
            return false;
        }
    }


    async removeMember(identifier: UserIdentifier, by: UserIdentifier | null = null): Promise<ConversationMember | null> {
        try {
            const member = await this.app.database.conversationMember.delete({
                where: {
                    conversation_id_user_ref: {
                        conversation_id: this.id,
                        user_ref: identifier.toString()
                    },
                    conversation: {
                        id: this.id,
                        members: by ? { some: { user_ref: by.toString() } } : undefined
                    }
                }
            });

            // Notifier les utilisateurs locaux
            await this.notifyUsers('leave', {
                conversation_id: this.id,
                user: identifier.toString(),
                executed_by: by ? by.toString() : null
            });

            // Notifier les serveurs externes
            await this.sendInbox<IInboxInput>('leave', {
                conversation_id: this.id,
                user: identifier.toString(),
                executed_by: by ? by.identifierAsId() : null
            });

            return member;
        } catch (error) {
            Debug.error("Failed to remove member:", error);
            return null;
        }
    }

    async addMember(identifier: UserIdentifier, by: UserIdentifier): Promise<ConversationMember | null> {
        try {
            const member = await this.app.database.conversationMember.create({
                data: {
                    conversation_id: this.id,
                    user_ref: identifier.toString()
                }
            });

            // Notifier les utilisateurs locaux
            await this.notifyUsers('join', {
                conversation_id: this.id,
                user: identifier.toString(),
                invited_by: by.toString()
            });

            // Notifier les serveurs externes
            await this.sendInbox<IInboxInput>('join', {
                conversation_id: this.id,
                user: identifier.toString(),
                invited_by: by.identifierAsId()
            });

            return member;
        } catch (error) {
            Debug.error("Failed to add member:", error);
            return null;
        }
    }
}
