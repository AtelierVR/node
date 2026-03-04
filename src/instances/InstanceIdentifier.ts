import { SafeLocalAddress } from "../utils/Constants";
import { getPreferedAddress } from "../utils/Environment";
import { isLocalAddress } from "../utils/Utils";
import InstanceManager from "./InstanceManager";

// (<id>|#<name>|(<id>;name=#<name>))[;<key>=<value>][@<server>]
export default class InstanceIdentifier {

    constructor(identifier: number | string, server?: string, variables?: { [key: string]: string }) {
        this.identifier = identifier;
        this.server = server || undefined;
        this.variables = variables || {};
    }


    static fromString(str: string): InstanceIdentifier | null {

        const parts = str.split('@');
        const identifierparts = parts[0].split(';');
        var variables: { [key: string]: string } = {};
        for (let i = 1; i < identifierparts.length; i++) {
            const keyvalue = identifierparts[i].split('=');
            variables[keyvalue[0]] = keyvalue.slice(1).join('=');
        }

        if (identifierparts[0].startsWith('#')) {
            var name = identifierparts[0].slice(1);
            if (InstanceManager.isValidName(name))
                return new InstanceIdentifier(name, parts[1], variables);
            return null;
        } else {
            var id = parseInt(identifierparts[0]);
            if (InstanceManager.isValidId(id))
                return new InstanceIdentifier(id, parts[1], variables);
            return null;
        }
    }

    identifier: string | number; // id or name
    server?: string;
    variables: { [key: string]: string } = {};

    toString(defaultserver?: string): string {
        return `${typeof this.identifier === 'number' ? this.identifier : `#${this.identifier}`}@${this.isLocal() ? defaultserver || SafeLocalAddress : this.server}`;
    }

    isLocal(): boolean {
        return this.server === undefined
            || isLocalAddress(this.server)
            || this.server === SafeLocalAddress
            || getPreferedAddress() === this.server;
    }

    isName(): boolean {
        return typeof this.identifier === 'string';
    }

    isId(): boolean {
        return typeof this.identifier === 'number';
    }
}