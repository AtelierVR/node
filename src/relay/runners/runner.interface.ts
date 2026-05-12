/**
 * Relay Runner abstraction layer.
 *
 * A "runner" is a backend that can manage the lifecycle of a relay process:
 * start, stop, restart, kill, and introspect.
 *
 * Implementations:
 *   - DockerRunner  — manages relay Docker containers
 *   - ExternalRunner — no-op for relays managed outside the node
 *   - (future) KubernetesRunner, ProxmoxRunner, …
 */

// ── Runner info returned by getInfo() ────────────────────────────────────────

export type RelayRunnerStatus = 'running' | 'stopped' | 'dead' | 'unknown';

export interface RelayRunnerInfo {
    /** Provider-specific identifier (e.g. Docker container short ID) */
    providerId: string | null;
    /** Current lifecycle status */
    status: RelayRunnerStatus;
    /** When the process/container was started, if known */
    startedAt: Date | null;
    /** Provider-specific metadata (image name, node name, …) */
    meta: Record<string, string>;
}

// ── Config passed to start() ──────────────────────────────────────────────────

export interface RelayStartConfig {
    /** Relay DB row ID */
    relayId: number;
    /** Authentication token for the relay to connect to the node */
    token: string;
    /** Base URL of the node (e.g. "https://example.com/") - relay will append /api/ws */
    nodeGateway: string;
    /** Max number of instances this relay may host */
    maxInstances: number;
    /** Optional human-readable label */
    label?: string;
}

// ── The provider interface ────────────────────────────────────────────────────

export interface IRelayRunner {
    /** Provider name — must match the `provider` column in the DB */
    readonly name: string;

    /**
     * Start the relay process/container.
     * Returns the provider-specific ID (e.g. container ID) to store in `providerId`.
     */
    start(config: RelayStartConfig): Promise<string>;

    /**
     * Gracefully stop the relay (SIGTERM / docker stop).
     * @param providerId The value stored in `Relay.providerId`.
     */
    stop(providerId: string): Promise<void>;

    /**
     * Restart the relay process.
     * Default implementation: stop → start.
     */
    restart(providerId: string, config: RelayStartConfig): Promise<string>;

    /**
     * Forcefully kill the relay (SIGKILL / docker kill).
     */
    kill(providerId: string): Promise<void>;

    /**
     * Return current runtime info for a relay.
     */
    getInfo(providerId: string | null): Promise<RelayRunnerInfo>;

    /**
     * Return true if the relay process is currently running.
     */
    isRunning(providerId: string | null): Promise<boolean>;
}
