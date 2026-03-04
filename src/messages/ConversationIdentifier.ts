import { SafeLocalAddress } from "../utils/Constants";

export default class ConversationIdentifier {

    constructor(identifier: string, server?: string) {
        this.identifier = identifier;
        this.server = server;
    }

    static from(str: string): ConversationIdentifier {
        const parts = str.split('@');
        return new ConversationIdentifier(parts[0], parts[1] || SafeLocalAddress);
    }

    identifier: string;
    server?: string;

    toString(defaultserver?: string): string {
        return `${this.identifier}@${this.server === SafeLocalAddress ? (defaultserver || SafeLocalAddress) : this.server}`;
    }

    equals(other: ConversationIdentifier): boolean {
        return this.identifier === other.identifier && this.server === other.server;
    }
}