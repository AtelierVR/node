import Main from "../Main";
import MessageManager from "./MessageManager";
import User from "../users/User";
import Debug from "../utils/Debug";
import { Request, Response } from "../network/NetExpress";
import Express from "express";
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage } from "../utils/Utils";
import NetServer from "../server/NetServer";
import NetExpress from "../network/NetExpress";
import {
    ICreateConversationInput,
    ICreateConversationOutput,
    IGetConversationsOutput,
    IGetConversationOutput,
    ISendMessageInput,
    ISendMessageOutput,
    IGetMessagesOutput,
    IMarkAsReadInput,
    IMarkAsReadOutput,
    IInboxInput,
    IInboxOutput,
    IOutboxInput,
    IOutboxOutput,
    IReceiveCreateMessageEvent,
    IReceiveEditMessageEvent,
    IReceiveReadEvent,
    IReceiveJoinConversationEvent,
    IReceiveLeaveConversationEvent,
    IReceiveTypingEvent,
    IReceiveDeleteMessageEvent,
    IReceiveConversationReferenceInput,
    IReceiveConversationReferenceOutput,
    IMessage,
    IOutboxOutputMessage,
    IOutboxOutputRead,
    IOutboxOutputEdit,
    IOutboxOutputDeleteMessage,
    IOutboxOutputTyping,
    IOutboxOutputJoin,
    IOutboxInputLeave,
    IOutboxOutputLeave
} from "./MessageAPITypes";
import ConversationReference from "./ConversationReference";
import Conversation from "./Conversation";
import ConversationIdentifier from "./ConversationIdentifier";
import UserIdentifier from "../users/UserIdentifier";
import Message from "./Message";

export default class MessageAPIWeb {
    constructor(private readonly main: Main, private readonly manager: MessageManager) {
        // Créer une conversation
        this.main.http.express.server.post(
            '/api/messages/conversations',
            Express.json(),
            NetExpress.validate<ICreateConversationInput>('messages/create_conversation'),
            (req, res) => this.handleCreateConversation(req as Request, res as Response)
        );

        // Obtenir les conversations de l'utilisateur
        this.main.http.express.server.get(
            '/api/messages/conversations',
            (req, res) => this.handleGetConversations(req as Request, res as Response)
        );

        // Obtenir une conversation spécifique
        this.main.http.express.server.get(
            '/api/messages/conversations/:id',
            (req, res) => this.handleGetConversation(req as Request<{ id: string }>, res as Response)
        );

        // Envoyer un message
        this.main.http.express.server.post(
            '/api/messages/conversations/:id/messages',
            Express.json(),
            NetExpress.validate<ISendMessageInput>('messages/send_message'),
            (req, res) => this.handleSendMessage(req as Request<{ id: string }>, res as Response)
        );

        // Obtenir les messages d'une conversation
        this.main.http.express.server.get(
            '/api/messages/conversations/:id/messages',
            (req, res) => this.handleGetMessages(req as Request<{ id: string }>, res as Response)
        );

        // Marquer comme lu
        this.main.http.express.server.post(
            '/api/messages/conversations/:id/read',
            Express.json(),
            NetExpress.validate<IMarkAsReadInput>('messages/mark_as_read'),
            (req, res) => this.handleMarkAsRead(req as Request<{ id: string }>, res as Response)
        );

        // Inbox: Recevoir des événements d'une conversation externe (le serveur autoritaire nous envoie des événements)
        this.main.http.express.server.post(
            '/api/messages/inbox',
            Express.json(),
            NetExpress.validate<IInboxInput>('messages/inbox'),
            (req, res) => this.handleInbox(req as Request<{}, IInboxInput>, res as Response)
        );

        // Outbox: Recevoir des événements d'une conversation interne (utilisateur externe fait une action dans notre conversation)
        this.main.http.express.server.post(
            '/api/messages/outbox',
            Express.json(),
            NetExpress.validate<IOutboxInput>('messages/outbox'),
            (req, res) => this.handleOutbox(req as Request<{}, IOutboxInput>, res as Response)
        );
    }

    async handleCreateConversation(request: Request<{}, ICreateConversationInput>, response: Response) {
        try {
            if (!request.data.isBearer())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            const user = await request.data.getData() as User | null;
            if (!user)
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));

            const conversation = await this.main.conversations.create(request.body, user);

            if (!conversation)
                return response.send(new ErrorMessage(ErrorCodes.InternalError, "create conversation"));

            response.send<ICreateConversationOutput>({
                id: conversation.id,
                server: this.main.server.getInfos().address,
                title: conversation.title,
                thumbnail: conversation.thumbnail,
                created_at: conversation.created_at.getTime(),
                updated_at: conversation.updated_at.getTime(),
                last_message: null,
                members: (await conversation.getMembers()).map(m => ({
                    id: m.id,
                    reference: m.user_ref,
                    last_read_at: m.last_read_at?.getTime() || null,
                    joined_at: m.joined_at.getTime()
                })),
                messages: []
            });
        } catch (error) {
            Debug.error("Failed to create conversation:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "create conversation"));
        }
    }

    async handleGetConversations(request: Request, response: Response) {
        try {
            if (!request.data.isBearer())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            const user = await request.data.getData() as User | null;
            if (!user)
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));

            const limit = parseInt(request.query.limit as string) || 50;
            const offset = parseInt(request.query.offset as string) || 0;

            const conversations = await this.manager.getUserConversations(user, limit, offset);

            const fetched = await Promise.all<IGetConversationOutput>(conversations.map(async c => {
                if (c instanceof ConversationReference) {
                    const fullData = await c.fetch();
                    if (fullData) {
                        return fullData;
                    } else throw new Error("Failed to fetch conversation from authority");
                } else if (c instanceof Conversation) {
                    return {
                        id: c.id,
                        title: c.title,
                        thumbnail: c.thumbnail,
                        server: this.main.server.getInfos().address,
                        created_at: c.created_at.getTime(),
                        updated_at: c.updated_at.getTime(),
                        last_message: c.last_message?.getTime() || null,
                        members: (await c.getMembers()).map(m => ({
                            id: m.id,
                            reference: m.user_ref,
                            last_read_at: m.last_read_at?.getTime() || null,
                            joined_at: m.joined_at.getTime()
                        }))
                    };
                } else throw new Error("Unknown conversation type");
            }));

            response.send<IGetConversationsOutput>({
                conversations: fetched,
                limit,
                offset
            });
        } catch (error) {
            Debug.error("Failed to get conversations:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "get conversations"));
        }
    }

    async handleGetConversation(request: Request<{ id: string }>, response: Response) {
        try {
            if (!request.data.isBearer())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            const user = await request.data.getData() as User | null;
            if (!user)
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));

            const conversation = await this.main.messages.getUserConversation(user, ConversationIdentifier.from(request.params.id));
            if (!conversation)
                return response.send(new ErrorMessage(ErrorCodes.NotFound, "conversation"));

            var infos = conversation instanceof ConversationReference
                ? await conversation.fetch()
                : {
                    id: conversation.id,
                    server: this.main.server.getInfos().address,
                    title: conversation.title,
                    thumbnail: conversation.thumbnail,
                    created_at: conversation.created_at.getTime(),
                    updated_at: conversation.updated_at.getTime(),
                    last_message: conversation.last_message?.getTime() || null,
                    members: (await conversation.getMembers()).map(m => ({
                        id: m.id,
                        reference: m.user_ref,
                        last_read_at: m.last_read_at?.getTime() || null,
                        joined_at: m.joined_at.getTime()
                    }))
                };

            if (!infos)
                return response.send(new ErrorMessage(ErrorCodes.NotFound, "conversation"));

            response.send<IGetConversationOutput>(infos);
        } catch (error) {
            Debug.error("Failed to get conversation:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "get conversation"));
        }
    }

    async handleSendMessage(request: Request<{ id: string }, ISendMessageInput>, response: Response) {
        try {
            if (!request.data.isBearer())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            const user = await request.data.getData() as User | null;
            if (!user)
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));

            const conversation = await this.main.messages.getUserConversation(user, ConversationIdentifier.from(request.params.id));
            if (!conversation)
                return response.send(new ErrorMessage(ErrorCodes.NotFound, "conversation"));

            const message = await conversation.sendMessage(user.toIdentifier(), request.body);
            if (!message)
                return response.send(new ErrorMessage(ErrorCodes.InternalError, "send message"));

            if (!(message instanceof Message) && !message.success)
                return response.send(new ErrorMessage(ErrorCodes.InternalError, "send message"));

            response.send<ISendMessageOutput>(message instanceof Message ? {
                id: message.id,
                conversation_id: message.conversation_id,
                author: UserIdentifier.fromString(message.author_ref).toString(this.main.server.getInfos().address),
                content: message.content,
                attachments: message.getAttachments().map(a => ({
                    type: a.type,
                    url: a.url,
                    size: a.size,
                    mime: a.mime,
                    filename: a.filename
                })),
                reply: message.reply_to,
                created_at: message.created_at.getTime(),
                edited_at: message.edited_at ? message.edited_at.getTime() : null
            } : message.data!);
        } catch (error) {
            Debug.error("Failed to send message:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "send message"));
        }
    }

    async handleGetMessages(request: Request<{ id: string }>, response: Response) {
        try {
            if (!request.data.isBearer())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            const user = await request.data.getData() as User | null;
            if (!user)
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));

            const cid = request.params.id;
            const limit = parseInt(request.query.limit as string) || 50;
            const before = new Date(parseInt(request.query.before as string) || Date.now());

            const conversation = await this.main.messages.getUserConversation(user, ConversationIdentifier.from(cid));
            if (!conversation)
                return response.send(new ErrorMessage(ErrorCodes.NotFound, "conversation"));

            const messages = await conversation.getMessages(limit, before);

            response.send<IGetMessagesOutput>({
                messages: messages.map<IMessage>(m => m instanceof Message ? {
                    id: m.id,
                    author: UserIdentifier.fromString(m.author_ref).toString(this.main.server.getInfos().address),
                    content: m.content,
                    reply: m.reply_to,
                    attachments: m.getAttachments().map(a => ({
                        type: a.type,
                        url: a.url,
                        size: a.size,
                        mime: a.mime,
                        filename: a.filename
                    })),
                    created_at: m.created_at.getTime(),
                    edited_at: m.edited_at ? m.edited_at.getTime() : null
                } : m),
                limit,
                before: before.getTime()
            });
        } catch (error) {
            Debug.error("Failed to get messages:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "get messages"));
        }
    }

    async handleMarkAsRead(request: Request<{ id: string }>, response: Response) {
        try {
            if (!request.data.isBearer())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            const user = await request.data.getData() as User | null;
            if (!user)
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));

            const conversationId = request.params.id;

            // Récupérer la conversation
            const conversation = await this.main.messages.getUserConversation(user, ConversationIdentifier.from(conversationId));
            if (!conversation)
                return response.send(new ErrorMessage(ErrorCodes.NotFound, "conversation"));

            const success = await conversation.markAsRead(user.toIdentifier());

            if (!success)
                return response.send(new ErrorMessage(ErrorCodes.InternalError, "mark as read"));

            response.send<IMarkAsReadOutput>({ success: true });
        } catch (error) {
            Debug.error("Failed to mark as read:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "mark as read"));
        }
    }

    async handleInbox(request: Request<{}, IInboxInput>, response: Response) {
        try {
            // Validation du serveur distant
            if (!request.data.isChallenge())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            let netServer = await request.data.getData() as NetServer | null;
            if (!netServer)
                return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));

            const { type, data } = request.body;

            Debug.log(`[INBOX] Received ${type} event from authority server`);

            // Dispatch selon le type d'événement
            let success = false;
            switch (type) {
                case "create_message":
                    success = await this.handleInboxCreateMessage(data as IReceiveCreateMessageEvent);
                    break;
                case "edit_message":
                    success = await this.handleInboxEditMessage(data as IReceiveEditMessageEvent);
                    break;
                case "read":
                    success = await this.handleInboxRead(data as IReceiveReadEvent);
                    break;
                case "join":
                    success = await this.handleInboxJoinConversation(data as IReceiveJoinConversationEvent);
                    break;
                case "leave":
                    success = await this.handleInboxLeaveConversation(data as IReceiveLeaveConversationEvent);
                    break;
                case "typing":
                    success = await this.handleInboxTyping(data as IReceiveTypingEvent);
                    break;
                case "delete_message":
                    success = await this.handleInboxDeleteMessage(data as IReceiveDeleteMessageEvent);
                    break;
                default:
                    Debug.warn(`[INBOX] Unknown event type: ${type}`);
                    return response.send(new ErrorMessage(ErrorCodes.InternalError, "unknown event type"));
            }

            if (!success)
                return response.send(new ErrorMessage(ErrorCodes.InternalError, `inbox ${type}`));

            response.send<IInboxOutput>({
                type: type,
                success: true
            });
        } catch (error) {
            Debug.error("[INBOX] Failed to receive event:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "inbox event"));
        }
    }

    async handleOutbox(request: Request<{}, IOutboxInput>, response: Response) {
        try {
            // Validation du serveur distant
            if (!request.data.isChallenge())
                return response.send(new ErrorMessage(ErrorCodes.NotLogged));
            let netServer = await request.data.getData() as NetServer | null;
            if (!netServer)
                return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));

            const { type, data } = request.body;

            Debug.log(`[OUTBOX] Received ${type} event from external user`);

            // Dispatch selon le type d'événement
            let result: IOutboxOutput = {
                type: type,
                success: false
            };

            switch (type) {
                case "create_message":
                    result = await this.handleOutboxCreateMessage(data as IReceiveCreateMessageEvent, netServer);
                    break;
                case "edit_message":
                    result = await this.handleOutboxEditMessage(data as IReceiveEditMessageEvent, netServer);
                    break;
                case "read":
                    result = await this.handleOutboxRead(data as IReceiveReadEvent, netServer);
                    break;
                case "join":
                    result = await this.handleOutboxJoinConversation(data as IReceiveJoinConversationEvent, netServer);
                    break;
                case "leave":
                    result = await this.handleOutboxLeaveConversation(data as IReceiveLeaveConversationEvent, netServer);
                    break;
                case "typing":
                    result = await this.handleOutboxTyping(data as IReceiveTypingEvent, netServer);
                    break;
                case "delete_message":
                    result = await this.handleOutboxDeleteMessage(data as IReceiveDeleteMessageEvent, netServer);
                    break;
                default:
                    Debug.warn(`[OUTBOX] Unknown event type: ${type}`);
                    return response.send(new ErrorMessage(ErrorCodes.InternalError, "unknown event type"));
            }

            if (!result)
                return response.send(new ErrorMessage(ErrorCodes.InternalError, `outbox ${type}`));

            response.send<IOutboxOutput>({
                type: type,
                success: true
            });
        } catch (error) {
            Debug.error("[OUTBOX] Failed to receive event:", error);
            response.send(new ErrorMessage(ErrorCodes.InternalError, "outbox event"));
        }
    }

    private async handleInboxCreateMessage(data: IReceiveCreateMessageEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('create', {
                    conversation_id: data.conversation_id,
                    message: {
                        id: '', // L'ID sera généré côté client ou ignoré
                        author: data.user.toString(),
                        content: data.content,
                        attachments: data.attachments || [],
                        reply: data.reply || null,
                        created_at: Date.now(),
                        edited_at: null
                    }
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of new message in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying message:`, error);
            return false;
        }
    }

    private async handleInboxEditMessage(data: IReceiveEditMessageEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('edit', {
                    conversation_id: data.conversation_id,
                    message_id: data.id,
                    user: data.user,
                    content: data.content,
                    edited_at: data.edited_at
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of message edit in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying message edit:`, error);
            return false;
        }
    }

    private async handleInboxRead(data: IReceiveReadEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('read', {
                    conversation_id: data.conversation_id,
                    user: data.user.toString()
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of read event in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying read event:`, error);
            return false;
        }
    }

    private async handleInboxJoinConversation(data: IReceiveJoinConversationEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('join', {
                    conversation_id: data.conversation_id,
                    user: data.user,
                    invited_by: data.invited_by
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of join event in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying join event:`, error);
            return false;
        }
    }

    private async handleInboxLeaveConversation(data: IReceiveLeaveConversationEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('leave', {
                    conversation_id: data.conversation_id,
                    user: data.user,
                    executed_by: data.executed_by
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of leave event in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying leave event:`, error);
            return false;
        }
    }

    private async handleInboxTyping(data: IReceiveTypingEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('typing', {
                    conversation_id: data.conversation_id,
                    user: data.user,
                    is_typing: data.is_typing
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of typing event in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying typing event:`, error);
            return false;
        }
    }

    private async handleInboxDeleteMessage(data: IReceiveDeleteMessageEvent): Promise<boolean> {
        try {
            // Récupérer toutes les références locales pour cette conversation
            const refs = await this.manager.getConversationReferences(data.conversation_id);
            
            if (refs.length === 0) {
                Debug.warn(`[INBOX] No local references found for conversation ${data.conversation_id}`);
                return false;
            }

            // Notifier chaque utilisateur local via sa référence
            let success = false;
            for (const ref of refs) {
                const result = await ref.notifyUser('delete_message', {
                    conversation_id: data.conversation_id,
                    user: data.user.toString(),
                    message_id: data.message_id
                });
                success = success || result;
            }

            if (success) {
                Debug.log(`[INBOX] Notified local users of message deletion in conversation ${data.conversation_id}`);
            }

            return success;
        } catch (error) {
            Debug.error(`[INBOX] Error notifying message deletion:`, error);
            return false;
        }
    }

    private async handleOutboxCreateMessage(data: IReceiveCreateMessageEvent, server: NetServer): Promise<IOutboxOutputMessage> {
        try {
            var identifier = new UserIdentifier(data.user, server.address);

            // Vérifier que la conversation existe et est locale
            const conversation = await this.main.conversations.findByIdWithUser(data.conversation_id, identifier);
            if (!conversation)
                throw new Error(`Conversation ${data.conversation_id} not found`);

            // Créer le message localement
            const message = await conversation.sendMessage(identifier, {
                content: data.content,
                attachments: data.attachments || [],
                reply: data.reply || undefined
            });

            if (!message)
                throw new Error("Failed to create message");

            return {
                type: "create_message",
                success: true,
                data: {
                    id: message.id,
                    conversation_id: message.conversation_id,
                    author: UserIdentifier.fromString(message.author_ref).toString(this.main.server.getInfos().address),
                    content: message.content,
                    attachments: message.getAttachments().map(a => ({
                        type: a.type,
                        url: a.url,
                        size: a.size,
                        mime: a.mime,
                        filename: a.filename
                    })),
                    reply: message.reply_to,
                    created_at: message.created_at.getTime(),
                    edited_at: message.edited_at ? message.edited_at.getTime() : null
                }
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error creating message:`, error);
            return {
                type: "create_message",
                success: false,
                data: null
            };
        }
    }

    private async handleOutboxEditMessage(data: IReceiveEditMessageEvent, server: NetServer): Promise<IOutboxOutputEdit> {
        try {
            var identifier = new UserIdentifier(data.user, server.address);

            // Vérifier que la conversation existe et est locale
            const message = new Message(await this.main.database.message.update({
                where: {
                    id: data.id,
                    conversation: { members: { some: { user_ref: identifier.toString() } } },
                    author_ref: identifier.toString()
                },
                data: {
                    content: data.content,
                    edited_at: new Date(data.edited_at)
                }
            }), this.main);

            return {
                type: "edit_message",
                success: true,
                data: {
                    id: message.id,
                    conversation_id: message.conversation_id,
                    author: UserIdentifier.fromString(message.author_ref).toString(this.main.server.getInfos().address),
                    content: message.content,
                    attachments: message.getAttachments().map(a => ({
                        type: a.type,
                        url: a.url,
                        size: a.size,
                        mime: a.mime,
                        filename: a.filename
                    })),
                    reply: message.reply_to,
                    created_at: message.created_at.getTime(),
                    edited_at: message.edited_at ? message.edited_at.getTime() : null
                }
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error editing message:`, error);
            return {
                type: "edit_message",
                success: false,
                data: null
            };
        }
    }

    private async handleOutboxRead(data: IReceiveReadEvent, server: NetServer): Promise<IOutboxOutputRead> {
        try {
            var identifier = new UserIdentifier(data.user, server.address);

            const conversation = await this.main.conversations.findByIdWithUser(data.conversation_id, identifier);
            if (!conversation)
                throw new Error(`Conversation ${data.conversation_id} not found`);

            // Mettre à jour le statut de lecture pour l'utilisateur local
            const result = await conversation.markAsRead(identifier);
            if (!result)
                throw new Error(`Failed to mark conversation ${data.conversation_id} as read for user ${identifier.toString()}`);

            return {
                type: "read",
                success: true
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error handling read event:`, error);
            return {
                type: "read",
                success: false
            };
        }
    }

    private async handleOutboxJoinConversation(data: IReceiveJoinConversationEvent, server: NetServer): Promise<IOutboxOutputJoin> {
        try {
            var joinner = UserIdentifier.fromString(data.user);
            var inviter = new UserIdentifier(data.invited_by, server.address);

            const conversation = await this.main.conversations.findByIdWithUser(data.conversation_id, inviter);
            if (!conversation)
                throw new Error(`Conversation ${data.conversation_id} not found`);

            // Ajouter le membre à la conversation
            const result = await conversation.addMember(joinner, inviter);
            if (!result)
                throw new Error(`Failed to add member ${joinner.toString()} to conversation ${data.conversation_id}`);

            return {
                type: "join",
                success: true,
                data: {
                    id: result.id,
                    reference: result.user_ref,
                    last_read_at: result.last_read_at ? result.last_read_at.getTime() : null,
                    joined_at: result.joined_at.getTime()
                }
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error handling join event:`, error);
            return {
                type: "join",
                success: false,
                data: null
            };
        }
    }

    private async handleOutboxLeaveConversation(data: IReceiveLeaveConversationEvent, server: NetServer): Promise<IOutboxOutputLeave> {
        try {
            var identifier = UserIdentifier.fromString(data.user);
            var executedBy = data.executed_by ? new UserIdentifier(data.executed_by, server.address) : null;

            const conversation = await this.main.conversations.findByIdWithUser(data.conversation_id, identifier);
            if (!conversation)
                throw new Error(`Conversation ${data.conversation_id} not found`);

            // Retirer le membre de la conversation
            const result = await conversation.removeMember(identifier, executedBy);
            if (!result)
                throw new Error(`Failed to remove member ${identifier.toString()} from conversation ${data.conversation_id}`);

            return {
                type: "leave",
                success: true,
                data: {
                    id: result.id,
                    reference: result.user_ref,
                    last_read_at: result.last_read_at ? result.last_read_at.getTime() : null,
                    joined_at: result.joined_at.getTime()
                }
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error handling leave event:`, error);
            return {
                type: "leave",
                success: false,
                data: null
            };
        }
    }

    private async handleOutboxTyping(data: IReceiveTypingEvent, server: NetServer): Promise<IOutboxOutputTyping> {
        try {
            var identifier = new UserIdentifier(data.user, server.address);

            const conversation = await this.main.conversations.findByIdWithUser(data.conversation_id, identifier);
            if (!conversation)
                throw new Error(`Conversation ${data.conversation_id} not found`);

            if (!await conversation.notifyTyping(identifier, data.is_typing))
                throw new Error(`Failed to notify typing status in conversation ${data.conversation_id} for user ${identifier.toString()}`);

            return {
                type: "typing",
                success: true
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error handling typing event:`, error);
            return {
                type: "typing",
                success: false
            };
        }
    }

    private async handleOutboxDeleteMessage(data: IReceiveDeleteMessageEvent, server: NetServer): Promise<IOutboxOutputDeleteMessage> {
        try {
            var identifier = new UserIdentifier(data.user, server.address);

            var conversation = await this.main.conversations.findByIdWithUser(data.conversation_id, identifier);
            if (!conversation)
                throw new Error(`Conversation ${data.conversation_id} not found`);

            if (!await conversation.deleteMessage(data.message_id, identifier))
                throw new Error(`Failed to delete message ${data.message_id}`);

            return {
                type: "delete_message",
                success: true
            };
        } catch (error) {
            Debug.error(`[OUTBOX] Error deleting message:`, error);
            return {
                type: "delete_message",
                success: false
            };
        }
    }
}
