import { SafeLocalAddress } from "../utils/Constants";
import { getPreferedAddress } from "../utils/Environment";
import { isLocalAddress } from "../utils/Utils";

export default class ModIdentifier {
    constructor(identifier: number, server?: string, variables?: { [key: string]: string }) {
        this.identifier = identifier;
        this.server = server || undefined;
        this.variables = variables || {};
    }

    static fromString(str: string): ModIdentifier | null {
        const parts = str.split('@');
        const identifierparts = parts[0].split(';');
        var variables: { [key: string]: string } = {};
        for (let i = 1; i < identifierparts.length; i++) {
            const keyvalue = identifierparts[i].split('=');
            variables[keyvalue[0]] = keyvalue.slice(1).join('=');
        }
        var idn = parseInt(identifierparts[0]);
        if (isNaN(idn)) return null;
        return new ModIdentifier(idn, parts[1], variables);
    }

    identifier: number; // id or username
    server?: string;
    variables: { [key: string]: string } = {};

    isLocal(): boolean {
        return this.server === undefined
            || isLocalAddress(this.server)
            || this.server === SafeLocalAddress
            || getPreferedAddress() === this.server;
    }

    toString(defaultserver?: string): string {
        return `${this.identifier}@${this.isLocal() ? defaultserver || SafeLocalAddress : this.server}`;
    }
}