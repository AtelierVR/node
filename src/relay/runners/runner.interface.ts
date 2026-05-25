/**
 * Relay Runner abstraction layer.
 *
 * A "runner" is a backend that can manage the lifecycle of a relay process:
 * start, stop, restart, kill, and introspect.
 *
 * Implementations:
 *   - ContainerRunner — manages relay containers
 *   - ExternalRunner  — no-op for relays managed outside the node
 *   - (future) KubernetesRunner, ProxmoxRunner, …
 */

// ── Runner info returned by getInfo() ────────────────────────────────────────

export type RelayRunnerStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'destroyed' | 'unknown';

export interface RelayRunnerPort {
    /** Transport protocol (e.g. 'quic', 'tcp', 'udp') */
    protocol: string;
    /** Host address the port is bound to */
    host: string;
    /** Port number (0–65535) */
    port: number;
}

export interface RelayRunnerInfo {
    /** Provider-specific identifier (e.g. Docker container short ID) */
    providerId: string | null;
    /** Current lifecycle status */
    status: RelayRunnerStatus;
    /** When the process/container was started, if known */
    startedAt: Date | null;
    /** Provider-specific metadata (image name, node name, …) */
    meta: Record<string, string>;
    /** Open ports and their associated protocol */
    ports: RelayRunnerPort[];
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
    maxLink: number;
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
     * @param kill Whether to forcefully kill the relay if it doesn't stop gracefully.
     */
    stop(providerId: string, kill: boolean): Promise<void>;

    /**
     * Restart the relay process.
     * Default implementation: stop → start.
     */
    restart(providerId: string): Promise<void>;

    /**
     * Return current runtime info for a relay.
     */
    getInfo(providerId: string | null): Promise<RelayRunnerInfo>;

    /**
     * Return true if the relay process is currently running.
     */
    isRunning(providerId: string | null): Promise<boolean>;

    /**
     * Return true if this runner can accept a new relay to manage.
     * Managers should call this before requesting a new relay from this runner.
     */
    hasCapacity(): Promise<boolean>;
}
