import { Instance as IInstance } from "@prisma/client";
import UserIdentifier from "../users/UserIdentifier";
import Relay from "../relay/Relay";
import Main from "../Main";
import WorldIdentifier from "../worlds/WorldIdentifier";
import { JsonValue } from "@prisma/client/runtime/library";
import { join } from "node:path";
import InstanceManager from "./InstanceManager";
import { statSync } from "node:fs";

export default class Instance implements IInstance {
    constructor(instance: IInstance, private readonly app: Main) {
        this.id = instance.id;
        this.name = instance.name;
        this.title = instance.title;
        this.description = instance.description;
        this.capacity = instance.capacity;
        this.tags = instance.tags;
        this.world_ref = instance.world_ref;
        this.owner_ref = instance.owner_ref;
        this.use_whitelist = instance.use_whitelist;
        this.whitelist_refs = instance.whitelist_refs;
        this.password = instance.password;
        this.use_password = instance.use_password;
        this.thumbnail = instance.thumbnail;
        this.cache = instance.cache;
        this.created_at = instance.created_at;
        this.updated_at = instance.updated_at;
    }

    created_at: Date;
    updated_at: Date;
    cache: JsonValue;
    use_password: boolean;
    password: string | null;
    use_whitelist: boolean;
    whitelist_refs: string[];
    id: number;
    name: string;
    title: string | null;
    description: string | null;
    capacity: number;
    tags: string[];
    world_ref: string;
    owner_ref: string;
    thumbnail: string | null;

    getTags(): string[] {
        return [
            ...this.tags,
            ...(this.capacity === 0 ? ['sys:unlimited'] : []),
            ...(this.use_whitelist ? ['sys:whitelist'] : []),
            ...(this.password && this.password.length > 0 && this.use_password ? ['sys:password'] : [])
        ];
    }

    getThumbnail(base: URL): URL | null {
        if (this.isLocalThumbnail()) {
            var s = statSync(this.getLocalThumbnailPath() as string);
            var u = new URL(`/api/instances/${this.id}/thumbnail`, base);
            u.searchParams.set('t', s.mtime.getTime().toString());
            return u;
        }

        if (this.thumbnail)
            try {
                return new URL(this.thumbnail);
            } catch { }
        return null;
    }

    getLocalThumbnailPath(): string | null {
        if (this.isLocalThumbnail())
            return join(InstanceManager.AssetFolder, this.thumbnail?.replace('file://', '') as string);
        return null;
    }

    isLocalThumbnail(): boolean {
        return this.thumbnail?.startsWith('file://') || false;
    }

    get ownerIdentifier(): UserIdentifier {
        return UserIdentifier.fromString(this.owner_ref);
    }

    get worldIdentifier(): WorldIdentifier {
        return WorldIdentifier.fromString(this.world_ref) as WorldIdentifier;
    }

    async getRelay(): Promise<Relay | null> {
        return await this.app.relays.getRelayByInstanceId(this.id);
    }

    async save(): Promise<void> {
        let r = await this.app.database.instance.update({
            where: {
                id: this.id
            },
            data: {
                capacity: this.capacity,
                description: this.description,
                name: this.name,
                owner_ref: this.owner_ref,
                password: this.password,
                tags: this.tags,
                thumbnail: this.thumbnail,
                title: this.title,
                use_password: this.use_password,
                use_whitelist: this.use_whitelist,
                whitelist_refs: this.whitelist_refs,
                world_ref: this.world_ref,
                cache: this.cache as any,
            }
        });
    }
}

export interface InstanceCache {
    players: PlayerInstanceCache[];
}

export interface PlayerInstanceCache {
    id: number;
    ref: string | null;
    display_name: string;
    flags: string[];
    created_at: number;
}