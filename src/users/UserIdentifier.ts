import { ErrorCodes, SafeLocalAddress } from "../utils/Constants";
import { getPreferedAddress } from "../utils/Environment";
import { ErrorMessage, isLocalAddress } from "../utils/Utils";

export default class UserIdentifier {
    constructor(identifier: string | number, server?: string) {
        this.identifier = identifier;
        this.server = server;
    }

    static fromString(str: string): UserIdentifier {
        const parts = str.split('@');
        return new UserIdentifier(isNaN(+parts[0]) ? parts[0] : +parts[0], parts[1]);
    }


    identifier: string | number; // id or username
    server?: string;

    isUsername(): boolean {
        return typeof this.identifier === 'string';
    }

    identifierAsUsername(): string {
        if (!this.isUsername())
            throw new Error("Identifier is not a username");
        return (this.identifier as string).toLowerCase();
    }

    identifierAsId(): number {
        if (this.isUsername())
            throw new Error("Identifier is not an id");
        return this.identifier as number;
    }

    isLocal(): boolean {
        return this.server === undefined
            || isLocalAddress(this.server)
            || this.server === SafeLocalAddress
            || getPreferedAddress() === this.server;
    }

    toString(defaultserver?: string): string {
        return `${this.identifier}@${this.isLocal() ? defaultserver || SafeLocalAddress : this.server}`;
    }

    equals(other: UserIdentifier): boolean {
        return this.identifier === other.identifier && (this.isLocal() === other.isLocal() || this.server === other.server);
    }
}