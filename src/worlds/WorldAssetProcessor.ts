import { AssetProcessor, ProcessingJob, IProgress, ProcessingStatus } from '../assets/AssetProcessingQueue';
import WorldManager from './WorldManager';
import { checkValidAssetFile } from '../utils/Utils';
import { analyzeData } from './WorldUtils';
import { statSync } from 'fs';
import Debug from '../utils/Debug';

/**
 * Processeur spécifique pour les assets de monde
 * Gère la validation, le traitement et la finalisation des assets de monde
 */
export class WorldAssetProcessor implements AssetProcessor {
    constructor(private readonly manager: WorldManager) {}

    /**
     * Traite l'asset de monde - Tout en un (validation, processing, finalisation)
     */
    async process(
        job: ProcessingJob, 
        updateProgress: (progress: IProgress) => void
    ): Promise<true | Error> {
        try {
            // PHASE 1: VALIDATION (0-20%)
            updateProgress({ progress: 5, status: ProcessingStatus.PROCESSING, message: 'Validating file' });
            
            const asset = await this.manager.findWorldAssetById(job.context.asset_id);
            if (!asset) return new Error('Asset not found');

            // Valider le fichier selon le type d'asset
            const { sucess, data } = await checkValidAssetFile(
                job.context.file_path, 
                asset.engine, 
                asset.platform, 
                'world'
            );

            if (!sucess || !data || typeof data === 'string') {
                return new Error(data && typeof data === 'string' ? data : 'Validation failed');
            }

            updateProgress({ progress: 10, message: 'Analyzing data' });

            // Extraire et valider les descripteurs Nox
            const descriptorData = analyzeData(data);
            if (descriptorData instanceof Error) {
                return descriptorData;
            }

            // Vérifier la cohérence platform/engine
            if (descriptorData.platform !== asset.platform) {
                return new Error(`Platform mismatch: expected ${asset.platform}, got ${descriptorData.platform}`);
            }

            if (descriptorData.engine !== asset.engine) {
                return new Error(`Engine mismatch: expected ${asset.engine}, got ${descriptorData.engine}`);
            }

            // Vérifier qu'il y a au moins un MainDescriptor
            if (descriptorData.descriptors.length === 0) {
                return new Error('No MainDescriptor found in asset');
            }

            updateProgress({ progress: 20, message: 'Validation complete' });

            // PHASE 2: PROCESSING (20-80%)
            updateProgress({ progress: 25, status: ProcessingStatus.PROCESSING, message: 'Extracting features' });
            
            // Étape 1: Extraction des mods et features
            if (!asset.setMods([])) {
                return new Error('Failed to set mods');
            }
            
            if (!asset.setFeatures([])) {
                return new Error('Failed to set features');
            }
            
            updateProgress({ progress: 40, message: 'Saving file' });

            // Étape 2: Sauvegarde du fichier
            updateProgress({ progress: 50, message: 'Compressing asset' });
            
            const fileObj: any = { 
                path: job.context.file_path, 
                size: statSync(job.context.file_path).size 
            };
            
            const success = asset.setFile(fileObj, job.context.hash);
            
            if (!success) {
                return new Error('Failed to save file');
            }
            
            updateProgress({ progress: 80, message: 'Finalizing' });

            // PHASE 3: FINALISATION (80-100%)
            updateProgress({ progress: 85, message: 'Updating database' });
            
            const updatedAsset = await this.manager.updateWorldAsset(asset);
            if (!updatedAsset) {
                return new Error('Failed to update database');
            }

            updateProgress({ progress: 100, status: ProcessingStatus.COMPLETED, message: 'Processing complete' });
            return true;

        } catch (error) {
            Debug.error('World asset processing error:', error);
            return error instanceof Error ? error : new Error(String(error));
        }
    }
}
