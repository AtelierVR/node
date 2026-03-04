import Main from "../Main";
import User from "../users/User";
import UserIdentifier from "../users/UserIdentifier";
import Debug from "../utils/Debug";
import MessageAPIWeb from "./MessageAPIWeb";
import Conversation from "./Conversation";
import ConversationReference from "./ConversationReference";
import ConversationIdentifier from "./ConversationIdentifier";


export default class MessageManager {
    api_web: MessageAPIWeb;

    constructor(private readonly main: Main) {
        this.api_web = new MessageAPIWeb(this.main, this);
    }


    async getUserConversation(user: User, id: ConversationIdentifier): Promise<Conversation | ConversationReference | null> {
        try {
            const local = await this.main.database.conversation.findUnique({
                where: { id: id.identifier, members: { some: { user_ref: user.toIdentifier().toString() } } }
            });

            if (local)
                return new Conversation(local, this.main);

            if (!id.server)
                return null;

            const server = await this.main.netServers.findNetServerByAddress(id.server);
            if (!server) {
                Debug.error(`Server ${id.server} not found`);
                return null;
            }

            const remote = await this.main.database.conversationReference.findUnique({
                where: { id_server_user_id: { id: id.identifier, server: server.id, user_id: user.id } }
            });

            if (remote)
                return new ConversationReference(remote, this.main);

            return null;
        } catch (error) {
            Debug.error("Failed to get user conversation:", error);
            return null;
        }
    }

    async getUserConversations(user: User, limit = 20, offset = 0): Promise<(Conversation | ConversationReference)[]> {
        try {
            const localConversations = (await this.main.database.conversation.findMany({
                where: { members: { some: { user_ref: user.toString() } } },
                orderBy: { last_message: 'desc' },
                skip: offset,
                take: limit
            })).map(c => new Conversation(c, this.main));

            const remoteReferences = (await this.main.database.conversationReference.findMany({
                where: { user_id: user.id },
                orderBy: { updated_at: 'desc' },
                skip: offset,
                take: limit
            })).map(r => new ConversationReference(r, this.main));

            let conversations: (Conversation | ConversationReference)[] = [
                ...localConversations,
                ...remoteReferences
            ];

            // Trier par dernier message / mise à jour
            conversations.sort((a, b) => {
                const aDate = (a instanceof Conversation) ? (a.last_message || a.created_at) : a.updated_at;
                const bDate = (b instanceof Conversation) ? (b.last_message || b.created_at) : b.updated_at;
                return bDate.getTime() - aDate.getTime();
            });

            return conversations.slice(0, limit);
        } catch (error) {
            Debug.error("Failed to get user conversations:", error);
            return [];
        }
    }

    /**
     * Récupère toutes les références locales pour une conversation distante
     */
    async getConversationReferences(conversationId: string): Promise<ConversationReference[]> {
        try {
            const refs = await this.main.database.conversationReference.findMany({
                where: { id: conversationId }
            });

            return refs.map(ref => new ConversationReference(ref, this.main));
        } catch (error) {
            Debug.error("Failed to get conversation references:", error);
            return [];
        }
    }
}

export interface SearchData {
    query?: string;
    users?: UserIdentifier[];
}
