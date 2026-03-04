import Main from '../Main';
import Debug from '../utils/Debug';
import ConversationReference from './ConversationReference';

export default class ConversationReferenceManager {
    constructor(private readonly main: Main) { }

    async findById(id: string): Promise<ConversationReference | null> {
        try {
            const record = await this.main.database.conversationReference.findUnique({
                where: { id }
            });
            if (!record) return null;
            return new ConversationReference(record, this.main);
        } catch (error) {
            Debug.error("Failed to find conversation reference by ID:", error);
            return null;
        }
    }
}
