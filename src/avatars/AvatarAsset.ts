import { AvatarAsset as IAvatarAsset } from '@prisma/client';
import Main from '../Main';
import { isValidURL } from '../utils/Utils';
import { existsSync, readFileSync, copyFileSync, rmSync, mkdirSync, createReadStream, createWriteStream } from 'fs';
import { join } from 'path';
import AvatarManager from './AvatarManager';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import Debug from '../utils/Debug';

export default class AvatarAsset implements IAvatarAsset {
    constructor(asset: IAvatarAsset, private readonly app: Main) {
        this.id = asset.id;
        this.version = asset.version;
        this.engine = asset.engine;
        this.platform = asset.platform;
        this.url = asset.url;
        this.hash = asset.hash;
        this.features = asset.features;
        this.size = asset.size;
        this.avatar_id = asset.avatar_id;
        this.created_at = asset.created_at;
        this.updated_at = asset.updated_at;
    }

    id: number;
    version: number;
    engine: string;
    platform: string;
    url: string | null;
    hash: string | null;
    features: string[];
    size: number;
    avatar_id: number;
    created_at: Date;
    updated_at: Date;

    isEmpty(): boolean {
        return !this.url
            || (!isValidURL(this.url) && !this.url.startsWith('file://'))
            || this.size <= 0
            || !this.hash;
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

    async save(): Promise<boolean> {
        try {
            await this.app.database.avatarAsset.update({
                where: { id: this.id },
                data: {
                    version: this.version,
                    engine: this.engine,
                    platform: this.platform,
                    url: this.url,
                    hash: this.hash,
                    features: this.features,
                    size: this.size,
                    updated_at: new Date()
                }
            });
            return true;
        } catch {
            return false;
        }
    }

    async delete(): Promise<boolean> {
        try {
            await this.app.database.avatarAsset.delete({
                where: { id: this.id }
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the organized file path for this asset
     */
    private getOrganizedPath(hash: string): string {
        // Organize as: assets/avatars/{avatar_id}/{hash}
        return join(AvatarManager.AssetFolder, 'avatars', this.avatar_id.toString(), hash);
    }

    /**
     * Check if a file with this hash already exists (deduplication)
     */
    async checkExistingFile(hash: string): Promise<string | null> {
        const organizedPath = this.getOrganizedPath(hash);
        if (existsSync(organizedPath)) {
            Debug.log(`File with hash ${hash} already exists (deduplicated)`);
            return organizedPath;
        }

        // Check if other assets have this hash
        const existingAsset = await this.app.database.avatarAsset.findFirst({
            where: { 
                hash: hash,
                url: { startsWith: 'file://' },
                NOT: { id: this.id }
            }
        });

        if (existingAsset && existingAsset.url) {
            const existingPath = existingAsset.url.replace('file://', '');
            const fullPath = join(AvatarManager.AssetFolder, 'avatars', existingAsset.avatar_id.toString(), existingPath);
            if (existsSync(fullPath)) {
                Debug.log(`Found existing file for hash ${hash} in asset ${existingAsset.id}`);
                return fullPath;
            }
        }

        return null;
    }

    /**
     * Set file with compression support
     */
    async setFileAsync(file: Express.Multer.File, hash: string): Promise<boolean> {
        try {
            const avatarFolder = join(AvatarManager.AssetFolder, 'avatars', this.avatar_id.toString());
            if (!existsSync(avatarFolder)) 
                mkdirSync(avatarFolder, { recursive: true });

            // Check for existing file (deduplication)
            const existingFile = await this.checkExistingFile(hash);
            if (existingFile) {
                // File already exists, just reference it
                this.size = file.size;
                this.url = `file://${hash}`;
                this.hash = hash;
                
                // Clean up the uploaded temp file
                if (existsSync(file.path)) rmSync(file.path);
                
                return true;
            }

            const targetPath = this.getOrganizedPath(hash);

            // Compress if file is large (> 1MB)
            if (file.size > 1024 * 1024) {
                Debug.log(`Compressing asset ${this.id} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                const compressedPath = targetPath + '.gz';
                
                await pipeline(
                    createReadStream(file.path),
                    createGzip(),
                    createWriteStream(compressedPath)
                );
                
                rmSync(file.path);
                this.size = file.size;
                this.url = `file://${hash}.gz`;
                this.hash = hash;
            } else {
                // Copy without compression for small files
                copyFileSync(file.path, targetPath);
                rmSync(file.path);
                this.size = file.size;
                this.url = `file://${hash}`;
                this.hash = hash;
            }

            return true;
        } catch (e) {
            Debug.error('Error setting file:', e);
            return false;
        }
    }

    setFile(file: Express.Multer.File, hash: string) {
        try {
            const avatarFolder = join(AvatarManager.AssetFolder, 'avatars', this.avatar_id.toString());
            if (!existsSync(avatarFolder)) 
                mkdirSync(avatarFolder, { recursive: true });
            
            const targetPath = this.getOrganizedPath(hash);
            copyFileSync(file.path, targetPath);
            rmSync(file.path);
            this.size = file.size;
            this.url = `file://${hash}`;
            this.hash = hash;
            return true;
        } catch (e) {
            Debug.error('Error setting file:', e);
            return false;
        }
    }

    getFile() {
        if (!this.url || !this.url.startsWith('file://') || this.isEmpty()) return null;
        const filename = this.url.replace('file://', '');
        return join(AvatarManager.AssetFolder, 'avatars', this.avatar_id.toString(), filename);
    }

    setFeatures(features: string[]): boolean {
        this.features = features.filter(f => f && f.trim().length > 0);
        return true;
    }
}
