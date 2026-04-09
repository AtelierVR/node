import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import type { IStorageProvider, FileInfo, CreateFile } from './storage.types';

@Injectable()
export class StorageService implements OnModuleInit {
    constructor(@Inject('IStorageProvider') private readonly provider: IStorageProvider) { }

    async onModuleInit(): Promise<void> {
        try {
            if (this.provider && typeof this.provider.init === 'function') 
                await this.provider.init();
        } catch {
            // ignore init errors — provider may handle them
        }
    }

    async store(file: CreateFile): Promise<FileInfo> {
        return await this.provider.store(file);
    }

    async delete(key: string): Promise<void> {
        return await this.provider.delete(key);
    }

    async get(key: string): Promise<FileInfo> {
        return await this.provider.get(key);
    }
}
