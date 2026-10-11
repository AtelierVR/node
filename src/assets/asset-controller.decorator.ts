import { Controller, SetMetadata } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ASSET_ENDPOINT_METADATA,
  ASSET_TYPE_METADATA,
} from '@/assets/asset.constants';
import { registerAssetControllerType } from '@/assets/asset-controller.registry';

export function AssetController(
  type: string,
  endpoint: string,
): ClassDecorator {
  if (!type.trim()) throw new Error('Asset controller type must not be empty');
  if (!endpoint.trim())
    throw new Error('Asset controller endpoint must not be empty');

  return (target) => {
    registerAssetControllerType(type, endpoint);
    Controller(endpoint)(target);
    SetMetadata(ASSET_TYPE_METADATA, type)(target);
    SetMetadata(ASSET_ENDPOINT_METADATA, endpoint)(target);
    ApiTags(type)(target);
  };
}
