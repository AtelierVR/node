/**
 * HTTP probes and the readiness verdict of `noxcli`.
 *
 * Readiness is deliberately *content-based*: a TCP connection (or a 200 on any
 * path) does not mean the node is usable. `/.well-known/nox` is served at the
 * root (it bypasses the global prefix), it is unauthenticated, and it is only
 * built once the app modules — database included — are initialized, which makes
 * it the most reliable "the server is up and serving" signal.
 */
import { formatDuration } from './cli.args';

export const USER_AGENT = 'NoxCLI';

/** Result of a single GET, JSON-parsed. */
export interface HttpProbe {
  ok: boolean;
  /** HTTP status, or `null` when the request never completed. */
  status: number | null;
  /** Parsed body, or `null` when there is none / it is not JSON. */
  body: unknown;
  /** Failure reason (`ECONNREFUSED`, `timed out after 5.0s`, …). */
  error: string | null;
  duration_ms: number;
}

/** Performs a GET and parses the response as JSON. Never throws. */
export async function httpGetJson(
  url: string,
  timeoutMs: number,
): Promise<HttpProbe> {
  const started = Date.now();

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });

    const text = await response.text();
    let body: unknown = null;
    let error: string | null = null;

    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        error = `invalid JSON response (${text.trim().slice(0, 80)})`;
      }
    }

    return {
      ok: response.ok && error === null,
      status: response.status,
      body,
      error,
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    const error = e as Error;
    const timedOut =
      error.name === 'TimeoutError' || error.name === 'AbortError';
    return {
      ok: false,
      status: null,
      body: null,
      error: timedOut
        ? `no response within ${formatDuration(timeoutMs)}`
        : (unwrapCause(error) ?? error.message),
      duration_ms: Date.now() - started,
    };
  }
}

/** Fields the node must expose in `/.well-known/nox` to be considered ready. */
const REQUIRED_FIELDS: Array<{ path: string; label: string }> = [
  { path: 'id', label: 'node identifier' },
  { path: 'status', label: 'status' },
  { path: 'address', label: 'address' },
  { path: 'software.name', label: 'software name' },
  { path: 'software.version', label: 'software version' },
  { path: 'gateway.api', label: 'gateway API URL' },
  { path: 'endpoints.wellknown', label: 'well-known endpoint' },
];

export interface WellKnownVerdict {
  ok: boolean;
  /** Reported status (`online`, `maintenance`, …) or `unknown`. */
  status: string;
  /** Why the node is *not* ready (empty when it is). */
  reasons: string[];
}

/**
 * Validates the `/.well-known/nox` document: the node must report itself
 * `online` and expose the fields clients depend on.
 */
export function evaluateWellKnown(document: unknown): WellKnownVerdict {
  if (!document || typeof document !== 'object')
    return { ok: false, status: 'unknown', reasons: ['empty response body'] };

  const status = pickText(document, 'status');
  const reasons: string[] = [];

  if (status !== 'online')
    reasons.push(`status is "${status}" (expected "online")`);

  for (const field of REQUIRED_FIELDS)
    if (pick(field.path, document) === undefined)
      reasons.push(`missing ${field.label}`);

  return { ok: reasons.length === 0, status, reasons };
}

/** Reads a dotted path (`software.version`) from an unknown value. */
export function pick(path: string, source: unknown): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Reads a dotted path and renders it as text — non-primitives fall back to `fallback`. */
export function pickText(
  source: unknown,
  path: string,
  fallback = 'unknown',
): string {
  const value = pick(path, source);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  return fallback;
}

/** Renders a compact one-line summary of a well-known document. */
export function describeWellKnown(document: unknown): string {
  const software = pick('software', document) as
    | { name?: string; version?: string }
    | undefined;
  const parts = [
    `status=${pickText(document, 'status')}`,
    software?.name ? `${software.name} ${software.version ?? '?'}` : null,
    pick('address', document) === undefined
      ? null
      : `address=${pickText(document, 'address')}`,
  ].filter((part): part is string => part !== null);

  return parts.join(', ');
}

/** Unwraps an `AggregateError`/`cause` chain down to a readable message. */
function unwrapCause(error: Error): string | null {
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return cause.message;
  if (Array.isArray(cause) && cause[0] instanceof Error)
    return cause[0].message;
  return null;
}
