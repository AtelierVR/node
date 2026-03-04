import Reileta from "../../Main";
import Badger from "./Badger";
import { randomBytes } from "crypto";
import { Badger as IBadger } from "@prisma/client";

export default class BadgerManager {
    constructor(private readonly app: Reileta) { }

    async findBadgerById(id: number): Promise<Badger | null> {
        let badger: IBadger | null = null;
        try {
            badger = await this.app.database.badger.findUnique({ where: { id } });
        } catch { }
        return badger ? new Badger(badger, this.app) : null;
    }

    async findBadgerByToken(token: string): Promise<Badger | null> {
        let badger: IBadger | null = null;
        try {
            badger = await this.app.database.badger.findUnique({ where: { token } });
        } catch { }
        return badger ? new Badger(badger, this.app) : null;
    }

    async createBadger(badger?: IBadger, relay_id?: number): Promise<Badger | null> {
        try {

            return new Badger(await this.app.database.badger.create({
                data: {
                    ...(badger || {}) as IBadger,
                    token: badger?.token || BadgerManager.generateToken(),
                    id: badger?.id || undefined,
                    relay_id: relay_id || badger?.relay_id || 0
                }
            }), this.app);
        } catch {
            return null;
        }
    }

    static generateToken(): string {
        return randomBytes(64).toString('base64');
    }
}