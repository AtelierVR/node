import Main from "../Main";
import User from "../users/User";
import UserIdentifier from "../users/UserIdentifier";
import Debug from "../utils/Debug";
import Conversation from "./Conversation";
import { ICreateConversationInput } from "./MessageAPITypes";

export default class ConversationManager {
    constructor(private readonly app: Main) { }

    async create(create: ICreateConversationInput, user: User): Promise<Conversation | null> {
        try {
            var members = new Set([user.toIdentifier(), ...create.members.map(UserIdentifier.fromString)]);
            if (members.size < 2) {
                Debug.warn("Attempted to create conversation with less than 2 unique members");
                return null;
            }
            return new Conversation(await this.app.database.conversation.create({
                data: {
                    title: create.title || null,
                    thumbnail: create.thumbnail || null,
                    members: { create: Array.from(members).map(member => ({ user_ref: member.toString() })) },
                }
            }), this.app);
        } catch (error) {
            Debug.error("Failed to create conversation:", error);
            return null;
        }
    }


    async findById(id: string): Promise<Conversation | null> {
        try {
            const record = await this.app.database.conversation.findUnique({
                where: { id }
            });
            if (!record) return null;
            return new Conversation(record, this.app);
        } catch (error) {
            Debug.error("Failed to find conversation by ID:", error);
            return null;
        }
    }

    async findByIdWithUser(id: string, user: UserIdentifier): Promise<Conversation | null> {
        try {
            const record = await this.app.database.conversation.findFirst({
                where: { id, members: { some: { user_ref: user.toString() } } }
            });
            if (!record) return null;
            return new Conversation(record, this.app);
        } catch (error) {
            Debug.error("Failed to find conversation by ID with user:", error);
            return null;
        }
    }
}
