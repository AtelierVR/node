import { SafeLocalAddress } from "../utils/Constants";
import Env from "../utils/Environment";
import { isLocalAddress } from "../utils/Utils";

export default class WorldIdentifier {
    static InvalidId = 0;
    static NoVersion = 65535;


    constructor(identifier: number, server?: string, variables?: { [key: string]: string }) {
        this.identifier = identifier;
        this.server = server || undefined;
        this.variables = variables || {};
    }

    static fromString(str: string): WorldIdentifier | null {
        // <id>[;<key>=<value>][@<server>]
        const parts = str.split('@');
        const identifierparts = parts[0].split(';');
        var variables: { [key: string]: string } = {};
        for (let i = 1; i < identifierparts.length; i++) {
            const keyvalue = identifierparts[i].split('=');
            variables[keyvalue[0]] = keyvalue.slice(1).join('=');
        }
        var idn = parseInt(identifierparts[0]);
        if (isNaN(idn)) return null;
        return new WorldIdentifier(idn, parts[1], variables);
    }

    identifier: number; // id or username
    server?: string;
    variables: { [key: string]: string } = {};

    isLocal(): boolean {
        return this.server === undefined
            || isLocalAddress(this.server)
            || this.server === SafeLocalAddress
            || Env.sync('ADDRESS') === this.server;
    }

    get version() {
        return typeof this.variables["v"] != "undefined" 
            ? parseInt(this.variables["v"]) 
            : WorldIdentifier.NoVersion 
    }

    set version(value) {
        value = ~~value;
        if (value < 0) 
            throw new Error("Version cannot be a nevative orand float");
        if (value > WorldIdentifier.NoVersion)
            delete this.variables["v"];
        this.variables["v"] = value.toString();
    }

    toString(defaultserver?: string): string {
        return `${this.identifier}@${this.isLocal() ? defaultserver || SafeLocalAddress : this.server}`;
    }
}