/**
 * Resolves *what* the CLI should talk to. Everything is overridable on the
 * command line, but the defaults are the ones that make sense inside the
 * container: the local server on `127.0.0.1:$HTTP_PORT`, using the same
 * environment variables as the server itself (`HTTP_PORT`, `HTTP_SSL`,
 * `HTTP_PREFIX`).
 */
import { str } from './cli.args';
import type { OptionSpec } from './cli.types';

/** Default port, matching the image `EXPOSE` and the compose stack. */
const DEFAULT_PORT = 8080;
/** Default host for in-container probes: never leave the container. */
const DEFAULT_HOST = '127.0.0.1';

/** Options shared by every command that talks to a server. */
export const TARGET_OPTIONS: OptionSpec[] = [
  {
    name: 'url',
    alias: 'u',
    type: 'string',
    value: '<url>',
    description:
      'Base URL of the server. Defaults to $NOX_URL, then http://127.0.0.1:$HTTP_PORT.',
  },
  {
    name: 'prefix',
    type: 'string',
    value: '<path>',
    description:
      'Global API prefix (e.g. "api"). Defaults to $HTTP_PREFIX, then "api".',
  },
];

/** Returns the base URL to probe, without a trailing slash. */
export function resolveBaseUrl(
  values: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = str(values, 'url') ?? env.NOX_URL ?? env.NOXCLI_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const protocol = isTrue(env.HTTP_SSL) ? 'https' : 'http';
  const host =
    env.HTTP_HOST && env.HTTP_HOST !== '0.0.0.0' ? env.HTTP_HOST : DEFAULT_HOST;
  const port = env.HTTP_PORT?.trim() || String(DEFAULT_PORT);

  return `${protocol}://${host}:${port}`;
}

/** Returns the API prefix (`''` when the server is configured without one). */
export function resolvePrefix(
  values: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const prefix = str(values, 'prefix') ?? env.HTTP_PREFIX ?? 'api';
  return trimSlashes(prefix);
}

/** Joins URL segments, keeping exactly one slash between them. */
export function joinUrl(base: string, ...segments: string[]): string {
  let url = base.replace(/\/+$/, '');
  for (const segment of segments) {
    const part = trimSlashes(segment);
    if (part) url += `/${part}`;
  }
  return url;
}

/** Builds an API URL (prefix included), e.g. `http://x/api/configs`. */
export function apiUrl(
  base: string,
  prefix: string,
  ...segments: string[]
): string {
  return joinUrl(base, prefix, ...segments);
}

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function isTrue(value: string | undefined): boolean {
  return (
    value !== undefined &&
    ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  );
}
