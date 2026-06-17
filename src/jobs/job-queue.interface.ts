/**
 * Job Queue abstraction layer.
 *
 * A "job queue" handles asynchronous, retryable background work:
 * ActivityPub delivery, image processing, email sending,
 * scheduled cleanup, etc.
 *
 * Implementations:
 *   - SyncJobProvider  — executes jobs immediately in-process (dev / single-node)
 *   - BullMqProvider   — Redis-backed queue with retries, scheduling, monitoring
 *   - (future) SqsProvider, RabbitMqProvider, …
 */

// ── Job metadata ────────────────────────────────────────────────────────────

export interface JobOptions {
    /** Max retry attempts before moving to dead letter (default: 3) */
    attempts?: number;
    /** Exponential backoff delay in ms (default: 1000) */
    backoff?: number;
    /** Remove job on completion (default: true for sync, false for BullMQ) */
    removeOnComplete?: boolean;
    /** Delay execution by this many ms */
    delay?: number;
    /** Job priority: lower = higher priority (default: 0) */
    priority?: number;
}

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';

export interface JobInfo {
    id: string;
    queue: string;
    status: JobStatus;
    attemptsMade: number;
    failedReason: string | null;
    createdAt: Date;
    processedAt: Date | null;
    completedAt: Date | null;
}

// ── The provider interface ───────────────────────────────────────────────────

export type JobHandler<T = unknown> = (data: T) => Promise<void>;

export interface IJobQueue {
    /** Provider name — must match the `queueProvider` config value */
    readonly name: string;

    /**
     * Add a job to a queue. Returns the job ID.
     */
    add<T = unknown>(queue: string, data: T, opts?: JobOptions): Promise<string>;

    /**
     * Register a handler for a queue. All jobs in that queue will be
     * processed by this handler. Call this during module initialization.
     */
    process<T = unknown>(queue: string, handler: JobHandler<T>): void;

    /**
     * Return current job info. Returns null if the job is not found.
     */
    get(jobId: string): Promise<JobInfo | null>;

    /**
     * Return true if the provider is healthy (connected to backend).
     * Sync providers always return true.
     */
    isHealthy(): Promise<boolean>;

    /**
     * Gracefully shut down the provider (close connections, stop workers).
     */
    shutdown(): Promise<void>;
}
