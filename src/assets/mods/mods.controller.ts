import { AssetController } from '@/assets/asset-controller.decorator';
import { AssetControllerBase } from '@/assets/asset-controller.base';
import type { IAssetController } from '@/assets/asset-controller.interface';

@AssetController('mod', 'mods')
export class ModsController
  extends AssetControllerBase
  implements IAssetController {}
