import {
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { IStorageProvider, FileInfo, CreateFile } from './storage.types';
import { FileProviderException } from './file-provider-exception';
import { randomBytes } from 'crypto';
import { WellKnownService } from 'src/fediverse/well-known.service';
import { AppConfigService } from 'src/config/config.service';
import { Injectable, Logger } from '@nestjs/common';

export interface StaticKey {
  id: string;
  time: Date;
  type: string;
}

@Injectable()
export class LocalFileProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalFileProvider.name);

  constructor(
    private readonly wellKnown: WellKnownService,
    private readonly config: AppConfigService,
  ) {}

  async getBaseDir(): Promise<string> {
    try {
      if (!this.config) throw new Error('config service not available');
      return await this.config.get<string>('storage.local.dir');
    } catch (e) {
      this.logger.warn(
        'Failed to get base directory from config, falling back to default "assets" folder',
        String(e),
      );
      return join(process.cwd(), 'assets');
    }
  }

  async init(): Promise<void> {
    const baseDir = await this.getBaseDir();
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  }

  async store(file: CreateFile): Promise<FileInfo> {
    try {
      // Use a filesystem-safe id
      const id = randomBytes(16).toString('hex');
      const base = await this.getBaseDir();
      const fullPath = join(base, id);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      copyFileSync(file.source, fullPath);
      try {
        unlinkSync(file.source);
      } catch {
        /* ignore */
      }

      const time = new Date();
      const stats = statSync(fullPath);

      const metadata = file.metadata ?? {};
      if (Object.keys(metadata).length > 0)
        writeFileSync(
          `${fullPath}.meta.json`,
          JSON.stringify(metadata),
          'utf8',
        );

      const keyObj: StaticKey = {
        id: id,
        time: time,
        type: file.mimetype,
      };

      return {
        key: this.toKey(keyObj),
        value: 'file://' + fullPath,
        url: await this.toUrl(keyObj),
        created: time,
        size: stats.size,
        mimetype: file.mimetype,
        metadata,
      };
    } catch (err) {
      this.logger.error(
        'store: failed to store file',
        (err as Error).stack ?? String(err),
      );
      throw new FileProviderException('store: failed to store file');
    }
  }

  async toUrl(key: StaticKey): Promise<URL> {
    return new URL(
      `${await this.wellKnown.apiBaseUrl()}files/${this.toId(key)}`,
    );
  }

  toKey(key: StaticKey): string {
    return `local://${this.toId(key)}`;
  }

  toId(key: StaticKey): string {
    return `${Buffer.from(`${encodeURIComponent(key.id)}?t=${key.time.getTime()}&type=${encodeURIComponent(key.type)}`).toString('base64url')}`;
  }

  fromId(id: string): StaticKey {
    const decoded = Buffer.from(id, 'base64url').toString('utf8');
    const [key, options] = decoded.split('?');
    if (!key || !options)
      throw new FileProviderException('fromId: invalid id format');
    const timePart = options.match(/t=(\d+)/)?.[1];
    const typePart = options.match(/type=([^&]+)/)?.[1];
    if (!key || !timePart || !typePart)
      throw new FileProviderException('fromId: invalid id format');
    return {
      id: decodeURIComponent(key),
      time: new Date(parseInt(timePart)),
      type: decodeURIComponent(typePart),
    };
  }

  fromKey(key: string): { id: string; time: Date; type: string } {
    if (!key.startsWith('local://'))
      throw new FileProviderException('fromKey: invalid key format');
    const idPart = key.slice('local://'.length);
    return this.fromId(idPart);
  }

  async delete(key: string): Promise<void> {
    try {
      const keyObj = this.fromKey(key);
      if (!keyObj)
        throw new FileProviderException('delete: invalid key format');
      const fullPath = join(await this.getBaseDir(), keyObj.id);
      if (!existsSync(fullPath))
        throw new FileProviderException('delete: file not found');
      unlinkSync(fullPath);
      try {
        unlinkSync(`${fullPath}.meta.json`);
      } catch {
        /* no sidecar metadata */
      }
    } catch (err) {
      this.logger.error('delete: failed', String(err));
      throw new FileProviderException('delete: failed to delete file');
    }
  }

  async get(key: string): Promise<FileInfo> {
    try {
      const keyObj = this.fromKey(key);
      if (!keyObj) throw new FileProviderException('get: invalid key format');
      const fullPath = join(await this.getBaseDir(), keyObj.id);
      if (!existsSync(fullPath))
        throw new FileProviderException('get: file not found');
      const stats = statSync(fullPath);
      return {
        key: key,
        value: 'file://' + fullPath,
        url: await this.toUrl(keyObj),
        created: stats.birthtime,
        size: stats.size,
        mimetype: keyObj.type,
        metadata: this.readMetadata(fullPath),
      };
    } catch (err) {
      this.logger.error('get: failed', String(err));
      throw new FileProviderException('get: failed to get file info');
    }
  }

  /** Reads the sidecar metadata file written next to a stored file, if any. */
  private readMetadata(fullPath: string): Record<string, unknown> {
    const metaPath = `${fullPath}.meta.json`;
    if (!existsSync(metaPath)) return {};
    try {
      return JSON.parse(readFileSync(metaPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }
}
