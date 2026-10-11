import { AssetController } from '@/assets/asset-controller.decorator';
import { AssetControllerBase } from '@/assets/asset-controller.base';
import type { IAssetController } from '@/assets/asset-controller.interface';

/**
 * Avatar asset controller.
 *
 * Avatars have no extra option on top of the generic asset model, so the base
 * controller is used as-is (exactly like {@link ModsController}).
 */
@AssetController('avatar', 'avatars')
export class AvatarsController
  extends AssetControllerBase
  implements IAssetController {}
