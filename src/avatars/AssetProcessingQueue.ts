import Debug from '../utils/Debug';
import { EventEmitter } from 'events';

export enum ProcessingStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
    COMPRESSING = 'compressing',
    VALIDATING = 'validating'
}

export interface ProcessingJob {
    asset_id: number;
    avatar_id: number;
    file_path: string;
    hash: string;
    status: ProcessingStatus;
    progress: number;
    error?: string;
    created_at: Date;
    started_at?: Date;
    completed_at?: Date;
}

export class AssetProcessingQueue extends EventEmitter {
    private queue: ProcessingJob[] = [];
    private processing = false;
    private jobs = new Map<number, ProcessingJob>();
    private maxConcurrent = 3;
    private currentProcessing = 0;

    constructor() {
        super();
    }

    addJob(job: Omit<ProcessingJob, 'status' | 'progress' | 'created_at'>): ProcessingJob {
        const fullJob: ProcessingJob = {
            ...job,
            status: ProcessingStatus.PENDING,
            progress: 0,
            created_at: new Date()
        };
        
        this.queue.push(fullJob);
        this.jobs.set(job.asset_id, fullJob);
        
        Debug.log(`Asset ${job.asset_id} added to processing queue`);
        this.emit('job-added', fullJob);
        
        this.processNext();
        
        return fullJob;
    }

    getJob(asset_id: number): ProcessingJob | undefined {
        return this.jobs.get(asset_id);
    }

    getStatus(asset_id: number): ProcessingStatus | undefined {
        return this.jobs.get(asset_id)?.status;
    }

    private async processNext() {
        if (this.currentProcessing >= this.maxConcurrent) return;
        
        const job = this.queue.find(j => j.status === ProcessingStatus.PENDING);
        if (!job) return;

        this.currentProcessing++;
        job.status = ProcessingStatus.PROCESSING;
        job.started_at = new Date();
        
        Debug.log(`Processing asset ${job.asset_id}`);
        this.emit('job-started', job);
        
        try {
            // The actual processing will be done by the caller
            // This is just a queue manager
            this.emit('process', job);
        } catch (error) {
            job.status = ProcessingStatus.FAILED;
            job.error = error instanceof Error ? error.message : String(error);
            job.completed_at = new Date();
            Debug.error(`Failed to process asset ${job.asset_id}:`, error);
            this.emit('job-failed', job);
        } finally {
            this.currentProcessing--;
            this.processNext();
        }
    }

    completeJob(asset_id: number, success: boolean, error?: string) {
        const job = this.jobs.get(asset_id);
        if (!job) return;

        job.status = success ? ProcessingStatus.COMPLETED : ProcessingStatus.FAILED;
        job.progress = 100;
        job.completed_at = new Date();
        if (error) job.error = error;
        
        Debug.log(`Asset ${asset_id} processing ${success ? 'completed' : 'failed'}`);
        this.emit(success ? 'job-completed' : 'job-failed', job);
        
        // Remove from queue
        const index = this.queue.indexOf(job);
        if (index > -1) this.queue.splice(index, 1);
        
        // Keep job in jobs map for status queries
        setTimeout(() => this.jobs.delete(asset_id), 3600000); // Keep for 1 hour
        
        this.processNext();
    }

    updateProgress(asset_id: number, progress: number, status?: ProcessingStatus) {
        const job = this.jobs.get(asset_id);
        if (!job) return;

        job.progress = Math.min(100, Math.max(0, progress));
        if (status) job.status = status;
        
        this.emit('job-progress', job);
    }

    getQueueLength(): number {
        return this.queue.filter(j => j.status === ProcessingStatus.PENDING).length;
    }

    getProcessingCount(): number {
        return this.currentProcessing;
    }

    getAllJobs(): ProcessingJob[] {
        return Array.from(this.jobs.values());
    }
}

export default new AssetProcessingQueue();
