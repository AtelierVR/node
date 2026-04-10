import { unlink } from 'node:fs/promises';
import type { AssetProcessor, ProcessingJob } from '../worlds/asset-processing.queue';
import type { AvatarsService } from './avatars.service';
import { checkValidAssetFile, analyzeAvatarAsset } from './avatar-utils';
import { NoxIdentifier } from 'src/common/identifier';

export const AVATAR_ASSET_PROCESSOR_TYPE = 'avatar-asset';
export const AVATAR_ASSET_MIMETYPE = 'application/x-nox-avatar';

export class AvatarAssetProcessor implements AssetProcessor {
    constructor(private readonly service: AvatarsService) { }

    async process(
        job: ProcessingJob,
        updateProgress: (progress: number, message: string) => void,
    ): Promise<void> {
        updateProgress(0, 'Loading asset record');
        const asset = await this.service.findAssetById(job.context.assetId);
        if (!asset) throw new Error(`Asset ${job.context.assetId} not found`);

        updateProgress(5, 'Analyzing asset bundle');
        const analyzed = await checkValidAssetFile(job.context.filePath);

        updateProgress(15, 'Validating avatar descriptor');
        analyzeAvatarAsset(analyzed, asset.engine, asset.platform);

        updateProgress(20, 'Storing asset file');
        const stored = await this.service.storage.store({
            source: job.context.filePath,
            mimetype: AVATAR_ASSET_MIMETYPE,
        });

        if (asset.url && asset.url !== stored.key)
            await this.service.storage.delete(asset.url);

        updateProgress(85, 'Updating database');
        await this.service.updateAssetRecord(job.context.assetId, {
            url: stored.key,
            hash: job.context.hash,
            size: job.context.fileSize,
        });

        this.service.activity.create({
            type: 'avatar.asset.upload',
            message: `Avatar asset #${job.context.assetId} uploaded (${job.context.hash.slice(0, 8)})`,
            details: {
                asset_id: job.context.assetId,
                hash: job.context.hash,
                size: job.context.fileSize
            },
            author: NoxIdentifier.parse(job.context.uploaderRef).toString(),
        }).catch(() => { });

        updateProgress(95, 'Cleaning up temp file');
        unlink(job.context.filePath).catch(() => { /* best-effort */ });

        updateProgress(100, 'Done');
    }
}
