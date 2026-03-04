import { Message as IMessage } from '@prisma/client';
import Main from '../Main';
import UserIdentifier from '../users/UserIdentifier';
import Debug from '../utils/Debug';
import { IMessageAttachment } from './MessageAPITypes';
import Conversation from './Conversation';

/**
 * Représente un message dans le système de messagerie.
 * 
 * Les messages sont toujours stockés sur le serveur autoritaire de la conversation.
 * Ils peuvent être édités, supprimés, et avoir des pièces jointes.
 * 
 * @implements {IMessage}
 */
export default class Message {
    /**
     * Crée une instance de Message
     * @param {IMessage} message - Les données du message depuis Prisma
     * @param {Main} app - L'instance principale de l'application
     */
    constructor(message: IMessage, private readonly app: Main) {
        this.id = message.id;
        this.conversation_id = message.conversation_id;
        this.author_ref = message.author_ref;
        this.content = message.content;
        this.attachments = message.attachments;
        this.reply_to = message.reply_to;
        this.created_at = message.created_at;
        this.updated_at = message.updated_at;
        this.edited_at = message.edited_at;
    }

    id: string;
    conversation_id: string;
    author_ref: string;
    content: string;
    attachments: any[];
    reply_to: string | null;
    delivery_errors: any | null;
    created_at: Date;
    updated_at: Date;
    edited_at: Date | null;

    /**
     * Récupère le UserIdentifier de l'expéditeur
     * 
     * Parse le author_ref au format "id@server" ou "id" pour extraire
     * l'identifiant utilisateur fédéré.
     * 
     * @returns {UserIdentifier} L'identifiant de l'expéditeur
     */
    getauthor(): UserIdentifier {
        return UserIdentifier.fromString(this.author_ref);
    }

    /**
     * Récupère les pièces jointes du message
     * 
     * @returns {IMessageAttachment[]} Liste des pièces jointes
     */
    getAttachments(): IMessageAttachment[] {
        return (this.attachments as IMessageAttachment[]) || [];
    }

    /**
     * Récupère le message auquel celui-ci répond
     * 
     * @returns {Promise<Message | null>} Le message parent ou null si aucune réponse
     */
    async getReplyTo(): Promise<Message | null> {
        if (!this.reply_to) return null;

        try {
            const replyMessage = await this.app.database.message.findUnique({
                where: { id: this.reply_to }
            });

            if (!replyMessage) return null;

            return new Message(replyMessage, this.app);
        } catch (error) {
            Debug.error("Failed to get reply message:", error);
            return null;
        }
    }

    /**
     * Récupère la conversation associée à ce message
     * 
     * @returns {Promise<Conversation | null>} La conversation ou null
     */
    async getConversation(): Promise<Conversation | null> {
        try {
            return await this.app.conversations.findById(this.conversation_id);
        } catch (error) {
            Debug.error("Failed to get conversation for message:", error);
            return null;
        }
    }

    /**
     * Édite le contenu du message
     * 
     * Met à jour le contenu et le timestamp edited_at.
     * Seul l'expéditeur du message devrait pouvoir l'éditer.
     * 
     * @param {string} newContent - Le nouveau contenu du message
     * @returns {Promise<boolean>} true si l'édition a réussi
     */
    async edit(newContent: string): Promise<boolean> {
        try {
            await this.app.database.message.update({
                where: { id: this.id },
                data: {
                    content: newContent,
                    edited_at: new Date()
                }
            });

            this.content = newContent;
            this.edited_at = new Date();
            Debug.log(`Edited message ${this.id}`);
            return true;
        } catch (error) {
            Debug.error("Failed to edit message:", error);
            return false;
        }
    }

    /**
     * Supprime le message
     * 
     * @returns {Promise<boolean>} true si la suppression a réussi
     */
    async delete(): Promise<boolean> {
        try {
            await this.app.database.message.delete({
                where: { id: this.id }
            });

            Debug.log(`Deleted message ${this.id}`);
            return true;
        } catch (error) {
            Debug.error("Failed to delete message:", error);
            return false;
        }
    }

    /**
     * Vérifie si le message a été édité
     * 
     * @returns {boolean} true si le message a été édité
     */
    isEdited(): boolean {
        return this.edited_at !== null;
    }

    /**
     * Vérifie si le message est une réponse à un autre message
     * 
     * @returns {boolean} true si le message est une réponse
     */
    isReply(): boolean {
        return this.reply_to !== null;
    }

    /**
     * Vérifie si le message a des pièces jointes
     * 
     * @returns {boolean} true si le message a des pièces jointes
     */
    hasAttachments(): boolean {
        return this.attachments && this.attachments.length > 0;
    }

    /**
     * Vérifie si l'utilisateur est l'expéditeur du message
     * 
     * @param {UserIdentifier} user - L'identifiant utilisateur à vérifier
     * @returns {boolean} true si l'utilisateur est l'expéditeur
     */
    isauthor(user: UserIdentifier): boolean {
        const author = this.getauthor();
        return author.equals(user);
    }
}
