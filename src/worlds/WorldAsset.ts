import Main from "../Main";
import { WorldAsset as IRWorldAsset } from '@prisma/client';
import { isValidURL, normalizeText } from "../utils/Utils";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import WorldManager from "./WorldManager";
import ModIdentifier from "../mods/ModIdentifier";

export default class WorldAsset implements IRWorldAsset {
    constructor(asset: IRWorldAsset, private readonly app: Main) {
        this.id = asset.id;
        this.version = asset.version;
        this.engine = asset.engine;
        this.platform = asset.platform;
        this.url = asset.url;
        this.hash = asset.hash;
        this.mod_refs = asset.mod_refs;
        this.size = asset.size || 0;
        this.world_id = asset.world_id;
        this.created_at = asset.created_at;
        this.updated_at = asset.updated_at;
        this.features = asset.features;
    }
    
    created_at: Date;
    updated_at: Date;
    features: string[];
    id: number;
    version: number;
    engine: string;
    platform: string;
    url: string | null;
    hash: string | null;
    mod_refs: string[];
    size: number;
    world_id: number;

    isEmpty(): boolean {
        return !this.url
            || (!isValidURL(this.url) && !this.url.startsWith('file://'))
            || this.size <= 0
            || !this.hash;
    }

    get modReferences(): ModIdentifier[] {
        return this.mod_refs.map(mod => ModIdentifier.fromString(mod) as ModIdentifier);
    }

    getURL(): URL | null {
        if (this.url && !this.isEmpty() && !this.url.startsWith('file://'))
            try {
                return new URL(this.url);
            } catch { }
        return null;
    }

    getSize(): number {
        return this.isEmpty() ? 0 : this.size;
    }

    getHash(): string | null {
        return this.isEmpty() ? null : this.hash;
    }

    setFile(file: Express.Multer.File, hash: string) {
        try {
            if (!existsSync(WorldManager.AssetFolder)) mkdirSync(WorldManager.AssetFolder);
            copyFileSync(file.path, join(WorldManager.AssetFolder, hash));
            rmSync(file.path);
            this.size = file.size;
            this.url = `file://${hash}`;
            this.hash = hash;
            return true;
        } catch (e) {
            return false
        }
    }

    setMods(mods: string[]): boolean {
        let m: ModIdentifier[] = [];
        for (let mod of mods) {
            let modid = ModIdentifier.fromString(mod);
            if (!modid) return false;
            m.push(modid);
        }
        this.mod_refs = m.map(mod => mod.toString());
        return true;
    }

    setFeatures(features: string[]) {
        let f: string[] = [];
        for (let feature of features) {
            const o = normalizeText(feature.trim())
            if (o.length > 0) f.push(o);
            else return false;
        }
        this.features = f;
        return true;
    }

    getFile() {
        if (!this.url || !this.url.startsWith('file://') || this.isEmpty()) return null;
        return join(WorldManager.AssetFolder, this.hash as string);
    }
}