export enum ProcessingStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

export interface JobContext {
    /** Discriminator — used to pick the right processor */
    type: string;
    assetId: number;
    filePath: string;
    hash: string;
    fileSize: number;
    uploaderRef: string;
}

export interface ProcessingJob {
    context: JobContext;
    status: ProcessingStatus;
    progress: number;
    message: string;
    error?: string;
    createdAt: Date;
    startedAt?: Date;
    doneAt?: Date;
}

export interface AssetProcessor {
    process(
        job: ProcessingJob,
        updateProgress: (progress: number, message: string) => void,
    ): Promise<void>;
}

/**
 * In-memory async processing queue with pluggable processors per type.
 * Up to `maxConcurrent` jobs run in parallel.
 */
export class AssetProcessingQueue {
    private readonly pending: ProcessingJob[] = [];
    private readonly jobs = new Map<number, ProcessingJob>();
    private readonly processors = new Map<string, AssetProcessor>();
    private readonly maxConcurrent: number;
    private current = 0;

    /** Jobs are kept in memory for `ttlMs` after completion (default 1 h). */
    constructor(maxConcurrent = 3, private readonly ttlMs = 3_600_000) {
        this.maxConcurrent = maxConcurrent;
    }

    register(type: string, processor: AssetProcessor): void {
        this.processors.set(type, processor);
    }

    enqueue(context: JobContext): ProcessingJob {
        const existing = this.jobs.get(context.assetId);
        if (existing && (existing.status === ProcessingStatus.PENDING || existing.status === ProcessingStatus.PROCESSING))
            return existing;

        const job: ProcessingJob = {
            context,
            status: ProcessingStatus.PENDING,
            progress: 0,
            message: 'Queued',
            createdAt: new Date(),
        };
        this.jobs.set(context.assetId, job);
        this.pending.push(job);
        this.drain();
        return job;
    }

    getJob(assetId: number): ProcessingJob | undefined {
        return this.jobs.get(assetId);
    }

    queuePosition(assetId: number): number {
        const index = this.pending.filter(j => j.status === ProcessingStatus.PENDING).findIndex(j => j.context.assetId === assetId);
        if (index !== -1) return index;
        // Job exists but already moved to PROCESSING → it is effectively at position 0
        return this.jobs.has(assetId) ? 0 : -1;
    }

    // ── Internal ─────────────────────────────────────────────────────────────────

    private drain(): void {
        if (this.current >= this.maxConcurrent) return;
        const job = this.pending.find(j => j.status === ProcessingStatus.PENDING);
        if (!job) return;
        this.run(job);
    }

    private async run(job: ProcessingJob): Promise<void> {
        this.current++;
        job.status = ProcessingStatus.PROCESSING;
        job.startedAt = new Date();

        const processor = this.processors.get(job.context.type);
        if (!processor) {
            this.finish(job, new Error(`No processor registered for type "${job.context.type}"`));
            return;
        }

        try {
            await processor.process(job, (progress, message) => {
                job.progress = Math.min(100, Math.max(0, progress));
                job.message = message;
            });
            this.finish(job);
        } catch (err) {
            this.finish(job, err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.current--;
            this.drain();
        }
    }

    private finish(job: ProcessingJob, err?: Error): void {
        job.doneAt = new Date();
        const idx = this.pending.indexOf(job);
        if (idx !== -1) this.pending.splice(idx, 1);

        if (err) {
            job.status = ProcessingStatus.FAILED;
            job.error = err.message;
            job.message = err.message;
        } else {
            job.status = ProcessingStatus.COMPLETED;
            job.progress = 100;
            job.message = 'Processing complete';
        }

        setTimeout(() => this.jobs.delete(job.context.assetId), this.ttlMs);
    }
}
