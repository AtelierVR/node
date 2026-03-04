import { AssetProcessor, ProcessingJob, IProgress, ProcessingStatus } from '../assets/AssetProcessingQueue';
import AvatarManager from './AvatarManager';
import { checkValidAssetFile } from '../utils/Utils';
import { statSync } from 'fs';
import Debug from '../utils/Debug';

/**
 * Processeur spécifique pour les assets d'avatar
 * Gère la validation, le traitement et la finalisation des assets d'avatar
 */
export class AvatarAssetProcessor implements AssetProcessor {
    constructor(private readonly manager: AvatarManager) {}

    /**
     * Traite l'asset d'avatar - Tout en un (validation, processing, finalisation)
     * - Vérifie que l'asset existe et le fichier est valide
     * - Extrait les features de l'asset
     * - Sauvegarde le fichier avec compression
     * - Met à jour l'asset en base de données
     */
    async process(
        job: ProcessingJob, 
        updateProgress: (progress: IProgress) => void
    ): Promise<true | Error> {
        try {
            // PHASE 1: VALIDATION (0-20%)
            updateProgress({ progress: 5, status: ProcessingStatus.PROCESSING, message: 'Validating asset' });
            
            const asset = await this.manager.findAvatarAssetById(job.context.asset_id);
            if (!asset) {
                return new Error('Asset not found');
            }

            // Valider le fichier selon le type d'asset
            const { sucess, data } = await checkValidAssetFile(
                job.context.file_path, 
                asset.engine, 
                asset.platform, 
                'avatar'
            );

            if (!sucess || !data || typeof data === 'string') {
                return new Error(data && typeof data === 'string' ? data : 'Validation failed');
            }

            updateProgress({ progress: 20, message: 'Validation complete' });

            // PHASE 2: PROCESSING (20-80%)
            updateProgress({ progress: 25, status: ProcessingStatus.PROCESSING, message: 'Extracting features' });
            
            if (!asset.setFeatures([])) {
                return new Error('Failed to set features');
            }
            
            updateProgress({ progress: 40, message: 'Compressing and saving file' });
            
            const fileObj: any = { 
                path: job.context.file_path, 
                size: statSync(job.context.file_path).size 
            };
            
            const success = await asset.setFileAsync(fileObj, job.context.hash);
            if (!success) {
                return new Error('Failed to save file');
            }
            
            updateProgress({ progress: 80, message: 'Finalizing' });

            // PHASE 3: FINALISATION (80-100%)
            updateProgress({ progress: 85, message: 'Updating database' });
            
            const updatedAsset = await this.manager.updateAvatarAsset(asset);
            if (!updatedAsset) {
                return new Error('Failed to update database');
            }

            updateProgress({ progress: 100, status: ProcessingStatus.COMPLETED, message: 'Processing complete' });
            return true;
            
        } catch (error) {
            Debug.error('Avatar asset processing error:', error);
            return error instanceof Error ? error : new Error(String(error));
        }
    }
}
