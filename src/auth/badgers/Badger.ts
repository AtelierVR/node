import { Badger as IBadger, Prisma } from "@prisma/client";
import Main from "../../Main";
import User from "../../users/User";
import Relay from "../../relay/Relay";


export default class Badger implements IBadger {
    constructor(Badger: IBadger, private readonly app: Main) {
        this.id = Badger.id;
        this.token = Badger.token;
        this.relay_id = Badger.relay_id;
        this.created_at = Badger.created_at;
        this.updated_at = Badger.updated_at;
    }

    created_at: Date;
    updated_at: Date;
    id: number;
    token: string;
    relay_id: number;

    async getRelay(): Promise<Relay | null> {
        return await this.app.relays.getRelayByBadgerId(this.id);
    }
}