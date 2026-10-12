import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ASSET_PROVIDERS } from '@/assets/asset.constants';
import type {
  AssetFile,
  AssetImageInput,
  AssetSearchOptions,
  AssetSearchResult,
  IAssetProvider,
} from '@/assets/asset-provider.interface';
import type { AssetWithMethods } from '@/assets/asset.model';
import type { AssetReleaseWithMethods } from '@/assets/asset-release.model';
import type { AssetFileWithMethods } from '@/assets/asset-file.model';
import type { UserWithMethods } from '@/users/user.model';
import type { Readable } from 'node:stream';
import {
  isAssetUploadProvider,
  type IAssetUploadProvider,
  type UploadHeaders,
} from '@/assets/upload/upload-provider.interface';
import type {
  CreateUploadAssetDto,
  CreateUploadReleaseDto,
  InitUploadFileDto,
  UpdateUploadAssetDto,
  UpdateUploadReleaseDto,
} from '@/assets/upload/dto/upload.dto';

@Injectable()
export class AssetService {
  constructor(
    @Inject(ASSET_PROVIDERS)
    private readonly providers: readonly IAssetProvider[],
  ) {}

  /**
   * Entity-level reads: providers return entities and the **controller** turns
   * them into `IApi*` (with the viewer and the requested sanitize options).
   */
  async search(
    type: string,
    options: AssetSearchOptions,
  ): Promise<AssetSearchResult<AssetWithMethods>> {
    const providers = this.getProviders(type);
    if (providers.length === 1) return providers[0].search(type, options, this);

    const pages = await Promise.all(
      providers.map((provider) =>
        provider.search(
          type,
          {
            query: options.query,
            statuses: options.statuses,
            limit: 100,
            offset: 0,
          },
          this,
        ),
      ),
    );
    return {
      query: options.query ?? null,
      offset: options.offset,
      limit: options.limit,
      total: pages.reduce((total, page) => total + page.total, 0),
      items: pages
        .flatMap((page) => page.items)
        .slice(options.offset, options.offset + options.limit),
    };
  }

  async getAsset(type: string, id: string): Promise<AssetWithMethods> {
    const { asset } = await this.resolveAsset(type, id);
    if (!asset) throw new NotFoundException(`Asset not found: ${id}`);
    return asset;
  }

  async listReleases(
    type: string,
    id: string,
    searchOptions: AssetSearchOptions,
  ): Promise<AssetSearchResult<AssetReleaseWithMethods>> {
    const { provider } = await this.resolveAsset(type, id);
    const releases = await provider.listReleases(type, id, this, searchOptions);
    if (!releases) throw new NotFoundException(`Asset not found: ${id}`);
    return releases;
  }

  async getRelease(
    type: string,
    id: string,
    version: string,
  ): Promise<AssetReleaseWithMethods> {
    const { provider } = await this.resolveAsset(type, id);
    const release = await provider.getRelease(type, id, version, this);
    if (!release)
      throw new NotFoundException(`Release not found: ${id}@${version}`);
    return release;
  }

  /** Paginated files of one release (see `GET …/releases/{version}/files`). */
  async listFiles(
    type: string,
    id: string,
    version: string,
    searchOptions: AssetSearchOptions,
  ): Promise<AssetSearchResult<AssetFileWithMethods>> {
    const { provider } = await this.resolveAsset(type, id);
    const files = await provider.listFiles(
      type,
      id,
      version,
      searchOptions,
      this,
    );
    if (!files)
      throw new NotFoundException(`Release not found: ${id}@${version}`);
    return files;
  }

  async getFile(
    type: string,
    id: string,
    version: string,
    name: string,
  ): Promise<AssetFile> {
    const { provider } = await this.resolveAsset(type, id);
    const file = await provider.getFile(type, id, version, name, this);
    if (!file) {
      throw new NotFoundException(
        `Asset file not found: ${id}@${version}/${name}`,
      );
    }
    return file;
  }

  async createUploadAsset(
    type: string,
    dto: CreateUploadAssetDto,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods> {
    return this.getUploadProvider(type).createAsset(type, dto, viewer, this);
  }

  async createUploadRelease(
    type: string,
    id: string,
    dto: CreateUploadReleaseDto,
    viewer: UserWithMethods,
  ): Promise<AssetReleaseWithMethods> {
    return this.getUploadProvider(type).createRelease(
      type,
      id,
      dto,
      viewer,
      this,
    );
  }

  async initUploadFile(
    type: string,
    id: string,
    release: string,
    dto: InitUploadFileDto,
    viewer: UserWithMethods,
  ): Promise<AssetFileWithMethods> {
    return this.getUploadProvider(type).initFile(
      type,
      id,
      release,
      dto,
      viewer,
      this,
    );
  }

  async storeUploadFile(
    type: string,
    id: string,
    release: string,
    fileId: number,
    stream: Readable,
    contentType: string | undefined,
    headers: UploadHeaders,
    viewer: UserWithMethods,
  ): Promise<AssetFileWithMethods> {
    return this.getUploadProvider(type).storeFile(
      type,
      id,
      release,
      fileId,
      stream,
      contentType,
      headers,
      viewer,
      this,
    );
  }

  async updateUploadAsset(
    type: string,
    id: string,
    body: UpdateUploadAssetDto,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods> {
    return this.getUploadProvider(type).updateAsset(
      type,
      id,
      body,
      viewer,
      this,
    );
  }

  async updateUploadRelease(
    type: string,
    id: string,
    version: string,
    body: UpdateUploadReleaseDto,
    viewer: UserWithMethods,
  ): Promise<AssetReleaseWithMethods> {
    return this.getUploadProvider(type).updateRelease(
      type,
      id,
      version,
      body,
      viewer,
      this,
    );
  }

  /** Lightweight file status lookup (no bytes streamed back). */
  async getUploadFileStatus(
    type: string,
    id: string,
    release: string,
    fileRef: string,
    viewer: UserWithMethods,
  ): Promise<AssetFileWithMethods> {
    const file = await this.getUploadProvider(type).getFileStatus(
      type,
      id,
      release,
      fileRef,
      viewer,
      this,
    );
    if (!file) throw new NotFoundException(`File not found: ${fileRef}`);
    return file;
  }

  async notifyWebhook(type: string, id: string, token: string): Promise<void> {
    for (const provider of this.getProviders(type)) {
      if (!provider.handleWebhook) continue;
      const handled = await provider.handleWebhook(type, id, token);
      if (handled === true) return;
      if (handled === false) {
        throw new NotFoundException('Webhook not found');
      }
    }
    throw new NotFoundException('Webhook not found');
  }

  async deleteAsset(
    type: string,
    id: string,
    viewer: UserWithMethods,
  ): Promise<void> {
    const { provider } = await this.resolveAsset(type, id);
    if (!provider.deleteAsset)
      throw new NotImplementedException(
        `Asset type "${type}" does not support deletion`,
      );
    await provider.deleteAsset(type, id, this, viewer);
  }

  async deleteRelease(
    type: string,
    id: string,
    version: string,
    viewer: UserWithMethods,
  ): Promise<void> {
    const { provider } = await this.resolveAsset(type, id);
    if (!provider.deleteRelease)
      throw new NotImplementedException(
        `Asset type "${type}" does not support release deletion`,
      );
    await provider.deleteRelease(type, id, version, this, viewer);
  }

  async deleteFile(
    type: string,
    id: string,
    version: string,
    name: string,
    viewer: UserWithMethods,
  ): Promise<void> {
    const { provider } = await this.resolveAsset(type, id);
    if (!provider.deleteFile)
      throw new NotImplementedException(
        `Asset type "${type}" does not support file deletion`,
      );
    await provider.deleteFile(type, id, version, name, this, viewer);
  }

  async addAssetImage(
    type: string,
    id: string,
    image: AssetImageInput,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods> {
    const { provider } = await this.resolveAsset(type, id);
    if (!provider.addImage)
      throw new NotImplementedException(
        `Asset type "${type}" does not support image upload`,
      );
    return provider.addImage(type, id, image, this, viewer);
  }

  async removeAssetImage(
    type: string,
    id: string,
    index: number,
    viewer: UserWithMethods,
  ): Promise<AssetWithMethods> {
    const { provider } = await this.resolveAsset(type, id);
    if (!provider.removeImage)
      throw new NotImplementedException(
        `Asset type "${type}" does not support image removal`,
      );
    return provider.removeImage(type, id, index, this, viewer);
  }

  private getUploadProvider(type: string): IAssetUploadProvider {
    const provider = this.getProviders(type).find(isAssetUploadProvider);
    if (!provider) {
      throw new ServiceUnavailableException(
        `Asset type "${type}" does not support uploads`,
      );
    }
    return provider;
  }

  getProviderById(id: string, type?: string): IAssetProvider {
    const provider = this.providers.find(
      (candidate) =>
        candidate.id === id && (!type || candidate.assetTypes.includes(type)),
    );
    if (!provider) {
      throw new ServiceUnavailableException(
        `Asset provider "${id}" is not configured${type ? ` for type "${type}"` : ''}`,
      );
    }
    return provider;
  }

  private getProviders(type: string): IAssetProvider[] {
    const providers = this.providers.filter((provider) =>
      provider.assetTypes.includes(type),
    );
    if (providers.length === 0) {
      throw new ServiceUnavailableException(
        `No asset provider is configured for type "${type}"`,
      );
    }
    return providers;
  }

  private async resolveAsset(
    type: string,
    id: string,
  ): Promise<{ asset: AssetWithMethods; provider: IAssetProvider }> {
    for (const candidate of this.getProviders(type)) {
      const asset = await candidate.getAsset(type, id, this);
      if (!asset) continue;
      const provider = this.getProviderById(asset.provider, type);
      if (provider !== candidate) {
        throw new InternalServerErrorException(
          `Asset provider "${asset.provider}" returned an asset while registered as "${candidate.id}"`,
        );
      }
      return { asset, provider };
    }
    throw new NotFoundException(`Asset not found: ${id}`);
  }
}
