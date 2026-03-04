import { ProcessingStatus } from './AssetProcessingQueue';

/**
 * Interface de base pour les réponses de statut de job de processing
 */
export interface ProcessingJobResponse {
    status: ProcessingStatus | 'empty';
    progress: number;
    message: string;
    created_at: number;
}

/**
 * Réponse pour un job en attente ou en cours de traitement
 */
export interface ProcessingJobActiveResponse extends ProcessingJobResponse {
    status: ProcessingStatus.PENDING | ProcessingStatus.PROCESSING;
    queue_position: number;
    started_at?: number;
    next_at: number;
}

/**
 * Réponse pour un job terminé avec succès
 */
export interface ProcessingJobCompletedResponse extends ProcessingJobResponse {
    status: ProcessingStatus.COMPLETED;
    hash: string;
    size?: number;
    started_at?: number;
    completed_at: number;
}

/**
 * Réponse pour un job échoué
 */
export interface ProcessingJobFailedResponse extends ProcessingJobResponse {
    status: ProcessingStatus.FAILED;
    error: string;
    started_at?: number;
    completed_at: number;
    next_at?: number;
}

/**
 * Réponse pour un asset jamais uploadé
 */
export interface ProcessingJobEmptyResponse extends ProcessingJobResponse {
    status: 'empty';
    progress: 0;
}

/**
 * Union type pour tous les types de réponses possibles
 */
export type AnyProcessingJobResponse = 
    | ProcessingJobActiveResponse 
    | ProcessingJobCompletedResponse 
    | ProcessingJobFailedResponse 
    | ProcessingJobEmptyResponse;
