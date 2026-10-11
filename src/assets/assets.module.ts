import { Module } from '@nestjs/common';
import type { DynamicModule, ModuleMetadata, Type } from '@nestjs/common';
import { ASSET_PROVIDERS } from '@/assets/asset.constants';
import type { IAssetController } from '@/assets/asset-controller.interface';
import type { IAssetProvider } from '@/assets/asset-provider.interface';
import { AssetService } from '@/assets/asset.service';

export interface AssetsModuleOptions {
  controllers: Type<IAssetController>[];
  providers?: Type<IAssetProvider>[];
  imports?: ModuleMetadata['imports'];
}

@Module({})
export class AssetsModule {
  static register(options: AssetsModuleOptions): DynamicModule {
    const providers = options.providers ?? [];
    return {
      module: AssetsModule,
      imports: options.imports,
      controllers: options.controllers,
      providers: [
        ...providers,
        {
          provide: ASSET_PROVIDERS,
          useFactory: (...instances: IAssetProvider[]) => instances,
          inject: providers,
        },
        AssetService,
      ],
      exports: [AssetService],
    };
  }
}
