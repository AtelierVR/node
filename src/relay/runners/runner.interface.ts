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
    /** ISO 3166-1 alpha-2 region code (e.g. "fr"), null if unknown */
    region: string | null;
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

// ── Instances & lifecycle events (discovery) ──────────────────────────────────

/** One relay process/container the provider currently knows about. */
export interface RelayRunnerInstance {
    /** Provider-specific identifier (e.g. Docker container id). */
    providerId: string;
    /** Relay DB id when the provider can map the instance back to a Nox relay, null otherwise. */
    relayId: number | null;
    /** True when the process is currently up. */
    running: boolean;
}

/** Lifecycle transitions a runner reports. */
export type RelayRunnerEventAction = 'start' | 'die' | 'destroy';

export interface RelayRunnerEvent {
    /** Provider-specific identifier of the process the event is about. */
    providerId: string;
    /** Relay DB id the process belongs to, null when it cannot be resolved. */
    relayId: number | null;
    action: RelayRunnerEventAction;
}

// ── The provider interface ────────────────────────────────────────────────────

export interface IRelayRunner {
    /** Provider name — must match the `provider` column in the DB */
    readonly name: string;

    /**
     * True when the node can discover and control this provider's relay processes
     * (list them, remove them, subscribe to their lifecycle).
     *
     * False for providers whose relays are managed outside the node (e.g. `external`):
     * the auto-manager must never reconcile or delete them.
     */
    readonly manages: boolean;

    /**
     * Selection priority for spawning a **new** relay when the node needs one.
     * The highest value wins; `-1` means "impossible right now" (provider managed
     * outside the node, backend unreachable, …) and is never selected.
     *
     * @returns the priority (higher = preferred), or -1 when this provider cannot
     *          create relays.
     */
    priority(): Promise<number>;

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
     * Stop (when needed) and permanently destroy the relay process/container.
     * Called when a relay is dropped (delete, dead, or idle cleanup).
     *
     * @param providerId The value stored in `Relay.providerId`.
     * @param kill Whether to kill the relay outright instead of stopping it first.
     */
    remove(providerId: string, kill: boolean): Promise<void>;

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
     * List every relay process this provider manages for this node.
     * Used for health checks and orphan reconciliation.
     * Providers with `manages === false` return an empty list.
     */
    list(): Promise<RelayRunnerInstance[]>;

    /**
     * Subscribe to the provider's lifecycle events (start / die / destroy).
     *
     * @returns an unsubscribe function — providers that cannot report events
     *          return a no-op.
     */
    subscribe(handler: (event: RelayRunnerEvent) => void): Promise<() => void>;

    /**
     * Return true if this runner can accept a new relay to manage.
     * Managers should call this before requesting a new relay from this runner.
     */
    hasCapacity(): Promise<boolean>;
}
