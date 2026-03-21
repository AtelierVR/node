import Reileta from "../Main";
import { Instance as IInstance } from "@prisma/client";
import Instance, { InstanceCache } from "./Instance";
import InstanceAPIWeb from "./InstanceAPIWeb";
import { randomBytes } from "crypto";
import WorldIdentifier from "../worlds/WorldIdentifier";
import NetUser from "../users/NetUser";
import User from "../users/User";
import UserIdentifier from "../users/UserIdentifier";
import { sleep } from "../utils/Utils";
import { Regex } from "../utils/Constants";
import Debug from "../utils/Debug";
import { join } from "path";
import { cwd } from "process";

export default class InstanceManager {

    api_web: InstanceAPIWeb;

    constructor(private readonly app: Reileta) {
        this.api_web = new InstanceAPIWeb(this.app, this);
    }

    creatingrelay = false;

    static AssetFolder = join(cwd(), 'assets');

    static isValidId(id: number): boolean {
        return id >= 0n && id < (1n << 32n);
    }

    static isValidName(name: string): boolean {
        return Regex.InstanceName.test(name);
    }

    async findInstanceById(id: number): Promise<Instance | null> {
        if (!InstanceManager.isValidId(id)) return null;
        let instance: IInstance | null = null;
        try {
            instance = await this.app.database.instance.findUnique({ where: { id: Number(id) } });
        } catch { }
        return !instance ? null : new Instance(instance, this.app);
    }

    async searchInstances(search: SearchData, ilimit: number, ioffset: number) {
        let instances: IInstance[] = [];
        let total: number = 0;
        try {
            const conditions: any[] = [
                ...(search.query ? [
                    { name: { contains: search.query, mode: 'insensitive' } },
                    { title: { contains: search.query, mode: 'insensitive' } },
                    { description: { contains: search.query, mode: 'insensitive' } }
                ] : []),
                ...(search.world ? [{ world_ref: search.world.toString() }] : []),
                ...(search.owner ? [{ owner_ref: search.owner.toString() }] : [])
            ];
            const query: any = conditions.length > 0 ? { OR: conditions } : {};
            instances = await this.app.database.instance.findMany({
                where: query,
                orderBy: search.query ? {
                    _relevance: {
                        fields: ["name", "title", "description"],
                        search: search.query,
                        sort: "desc",
                    }
                } : undefined,
                skip: ioffset,
                take: ilimit
            });
            total = await this.app.database.instance.count({ where: query });
        } catch { }
        return { instances: instances.map(instance => new Instance(instance, this.app)), total };
    }

    async findInstanceByName(name: string): Promise<Instance | null> {
        let instance: IInstance | null = null;
        try {
            instance = await this.app.database.instance.findUnique({
                where: { name }
            });
        } catch { }
        return !instance ? null : new Instance(instance, this.app);
    }

    generateName(): string {
        return randomBytes(3).toString('hex');
    }

    async createInstance(instance: IMakeInstance): Promise<Instance | null> {
        try {
            let inst = await this.app.database.instance.create({
                data: {
                    name: instance.name,
                    title: instance.title,
                    description: instance.description,
                    capacity: instance.capacity,
                    world_ref: instance.world.toString(),
                    owner_ref: instance.owner.toIdentifier().toString(),
                    tags: instance.tags,
                    use_whitelist: instance.whitelist.active,
                    whitelist_refs: instance.whitelist.users.map(user => user.toString()),
                    use_password: instance.password.active,
                    password: instance.password.value,
                    cache: ({ players: [] } as InstanceCache) as any
                }
            });
            return new Instance(inst, this.app);
        } catch {
            return null;
        }
    }
}

export interface IMakeInstance {
    name: string;
    title: string | null;
    description: string | null;
    thumbnail: URL | null;
    world: WorldIdentifier;
    capacity: number;
    owner: User | NetUser;
    tags: string[];
    whitelist: { active: boolean, users: UserIdentifier[] };
    password: { active: boolean, value?: string };
}

export interface SearchData {
    query?: string;
    world?: WorldIdentifier;
    owner?: UserIdentifier;
}