import Debug from '../utils/Debug';
import { EventEmitter } from 'events';

/**
 * Status du processing d'un asset
 */
export enum ProcessingStatus {
    PENDING = 'pending',         // En attente dans la queue
    PROCESSING = 'processing',   // En cours de traitement
    COMPLETED = 'completed',     // Traitement réussi
    FAILED = 'failed',           // Traitement échoué
}

/**
 * Job de processing d'un asset
 */
export interface ProcessingJob {
    context: IContext;
    progress: IProgress & { status: ProcessingStatus, message: string };
    error?: Error;
    created_at: Date;
    started_at?: Date;
    done_at?: Date;
}

export interface IContext {
    type: string;
    [key: string]: any;
}

export interface IProgress {
    progress: number;
    status?: ProcessingStatus;
    message?: string;
}


/**
 * Interface pour les processeurs d'assets par type
 */
export interface AssetProcessor {
    /**
     * Traite l'asset (compression, optimisation, etc.)
     * @returns true si succès, sinon une Error avec le message d'erreur
     */
    process(job: ProcessingJob, updateProgress: (progress: IProgress) => void): Promise<true | Error>;
}

/**
 * Queue de processing des assets avec gestion par type
 * 
 * Cette classe gère une queue de traitement asynchrone pour les assets.
 * Elle permet de:
 * - Traiter plusieurs assets en parallèle (configurable)
 * - Enregistrer des processeurs spécifiques par type d'asset
 * - Suivre la progression de chaque job
 * - Gérer les erreurs et les retries
 */
export class AssetProcessingQueue extends EventEmitter {
    private queue: ProcessingJob[] = [];
    private jobs = new Map<number, ProcessingJob>();
    private processors = new Map<string, AssetProcessor>();
    private maxConcurrent = 3;      // Nombre max de jobs parallèles
    private currentProcessing = 0;   // Nombre de jobs en cours

    constructor() {
        super();
    }

    /**
     * Enregistre un processeur pour un type d'asset
     */
    registerProcessor(assetType: string, processor: AssetProcessor): void {
        this.processors.set(assetType, processor);
        Debug.log(`Processor registered for asset type: ${assetType}`);
    }

    /**
     * Ajoute un job à la queue de processing
     */
    addJob(job: Omit<ProcessingJob, 'created_at'>): ProcessingJob {
        const fullJob: ProcessingJob = {
            ...job,
            created_at: new Date()
        };

        this.queue.push(fullJob);
        this.jobs.set(job.context.asset_id, fullJob);

        Debug.log(`Asset ${job.context.asset_id} (${job.context.type}) added to processing queue`);
        this.emit('job-added', fullJob);

        // Démarrer le traitement si possible
        this.processNext();

        return fullJob;
    }

    /**
     * Récupère un job par son asset_id
     */
    getJob(asset_id: number): ProcessingJob | undefined {
        return this.jobs.get(asset_id);
    }

    /**
     * Récupère le status d'un job
     */
    getStatus(asset_id: number): ProcessingStatus | undefined {
        return this.jobs.get(asset_id)?.progress.status;
    }

    /**
     * Traite le prochain job dans la queue
     */
    private async processNext() {
        // Ne pas dépasser le nombre max de jobs parallèles
        if (this.currentProcessing >= this.maxConcurrent) return;

        // Trouver le prochain job en attente
        const job = this.queue.find(j => j.progress.status === ProcessingStatus.PENDING);
        if (!job) return;

        this.currentProcessing++;
        job.progress.status = ProcessingStatus.PROCESSING;
        job.started_at = new Date();

        Debug.log(`Processing asset ${job.context.asset_id} (${job.context.type})`);
        this.emit('job-started', job);

        try {
            // Récupérer le processeur pour ce type d'asset
            const processor = this.processors.get(job.context.type);
            if (!processor) {
                throw new Error(`No processor registered for asset type: ${job.context.type}`);
            }

            // Appeler la méthode process (qui gère tout)
            const processResult = await processor.process(
                job,
                (progress: IProgress) => this.updateProgress(job.context.asset_id, progress)
            );
            
            if (processResult !== true) {
                this.completeJob(job.context.asset_id, false, processResult);
                return;
            }

            // Succès !
            this.completeJob(job.context.asset_id, true);

        } catch (error) {
            Debug.error(`Failed to process asset ${job.context.asset_id}:`, error);
            this.completeJob(job.context.asset_id, false,
                error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.currentProcessing--;
            // Traiter le prochain job dans la queue
            this.processNext();
        }
    }

    /**
     * Marque un job comme terminé (succès ou échec)
     */
    completeJob(asset_id: number, success: boolean, error?: Error): void {
        const job = this.jobs.get(asset_id);
        if (!job) return;

        job.progress.status = success ? ProcessingStatus.COMPLETED : ProcessingStatus.FAILED;
        job.progress.progress = 100;
        job.done_at = new Date();
        if (error) job.error = error;

        Debug.log(`Asset ${asset_id} processing ${success ? 'completed' : 'failed'}${error ? `: ${error.message}` : ''}`);
        this.emit(success ? 'job-completed' : 'job-failed', job);

        // Retirer de la queue
        const index = this.queue.indexOf(job);
        if (index > -1) this.queue.splice(index, 1);

        // Garder le job en mémoire pour les requêtes de status (1 heure)
        setTimeout(() => this.jobs.delete(asset_id), 3600000);
    }

    /**
     * Met à jour la progression d'un job
     */
    updateProgress(asset_id: number, progress: IProgress): void {
        const job = this.jobs.get(asset_id);
        if (!job) return;

        job.progress.progress = Math.min(100, Math.max(0, progress.progress));
        if (progress.status) job.progress.status = progress.status;
        if (progress.message) job.progress.message = progress.message;

        this.emit('job-progress', job);
    }

    /**
     * Retourne le nombre de jobs en attente
     */
    getQueueLength(): number {
        return this.queue.filter(j => j.progress.status === ProcessingStatus.PENDING).length;
    }

    /**
     * Retourne le nombre de jobs en cours de traitement
     */
    getProcessingCount(): number {
        return this.currentProcessing;
    }

    /**
     * Retourne tous les jobs (en cours et terminés récemment)
     */
    getAllJobs(): ProcessingJob[] {
        return Array.from(this.jobs.values());
    }

    /**
     * Configure le nombre max de jobs parallèles
     */
    setMaxConcurrent(max: number): void {
        this.maxConcurrent = Math.max(1, max);
    }
}

/**
 * Instance singleton de la queue de processing
 */
export default new AssetProcessingQueue();
