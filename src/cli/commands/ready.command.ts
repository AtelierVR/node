/**
 * `noxcli ready` — is the server up *and* ready to serve?
 *
 * This is the command the container healthcheck runs. It exits 0 only when the
 * node answers `/.well-known/nox` with `status: "online"` and a complete
 * document; `--deep` additionally probes an API route backed by the database so
 * a node that is up but cannot reach Postgres is reported as *not* ready.
 * It never throws: no credentials, no database connection, one HTTP GET.
 */
import {
  HELP_OPTION,
  flag,
  formatDuration,
  parseDuration,
  str,
} from '../cli.args';
import { OUTPUT_OPTIONS, type Output } from '../cli.output';
import {
  describeWellKnown,
  evaluateWellKnown,
  httpGetJson,
  type HttpProbe,
} from '../cli.probe';
import {
  TARGET_OPTIONS,
  apiUrl,
  joinUrl,
  resolveBaseUrl,
  resolvePrefix,
} from '../cli.target';
import {
  EXIT,
  type CheckResult,
  type CliCommand,
  type CommandContext,
  type ExitCode,
} from '../cli.types';

/** Root-level path (it bypasses the API prefix): the discovery document. */
export const DEFAULT_PATH = '/.well-known/nox';

/** Upper bound for a single HTTP attempt, so `--wait` stays responsive. */
const ATTEMPT_CAP_MS = 10_000;

export const readyCommand: CliCommand = {
  name: 'ready',
  summary: 'Check that the server is up and ready (exit 0 when it is).',
  usage: 'noxcli ready [options]',
  options: [
    ...TARGET_OPTIONS,
    {
      name: 'path',
      type: 'string',
      value: '<path>',
      default: DEFAULT_PATH,
      description: 'Readiness path, served at the root of the server.',
    },
    {
      name: 'timeout',
      alias: 't',
      type: 'string',
      value: '<duration>',
      default: '5s',
      description: 'Total budget before giving up (500ms, 5s, 2m).',
    },
    {
      name: 'interval',
      alias: 'i',
      type: 'string',
      value: '<duration>',
      default: '500ms',
      description: 'Delay between two attempts.',
    },
    {
      name: 'wait',
      alias: 'w',
      type: 'boolean',
      description:
        'Keep retrying until the server is ready (no timeout, unless --timeout is given).',
    },
    {
      name: 'deep',
      alias: 'd',
      type: 'boolean',
      description:
        'Also probe the API (/configs) to validate the database and the cache.',
    },
    ...OUTPUT_OPTIONS,
    HELP_OPTION,
  ],
  notes: [
    'Exit codes: 0 ready · 1 not ready · 2 bad usage.',
    'Container healthcheck:  noxcli ready --quiet',
    'Wait for a server that is still booting:  noxcli ready --wait --timeout 5m',
  ],
  run: runReady,
};

export async function runReady(ctx: CommandContext): Promise<ExitCode> {
  const { values, provided } = ctx.args;
  const out: Output = ctx.out;

  const base = resolveBaseUrl(values, ctx.env);
  const prefix = resolvePrefix(values, ctx.env);
  const path = str(values, 'path') ?? DEFAULT_PATH;
  const url = joinUrl(base, path);
  const deep = flag(values, 'deep');
  const wantJson = flag(values, 'json');
  const wait = flag(values, 'wait');
  const interval = parseDuration(str(values, 'interval') ?? '500ms');

  // `--wait` drops the default 5s budget; an explicit --timeout always wins.
  const budget =
    wait && !provided.includes('timeout')
      ? Number.POSITIVE_INFINITY
      : parseDuration(str(values, 'timeout') ?? '5s');

  const started = Date.now();
  const deadline = Number.isFinite(budget) ? started + budget : Infinity;

  let attempts = 0;
  let checks: CheckResult[] = [];
  let reasons: string[] = [];

  for (;;) {
    attempts++;

    const remaining = deadline - Date.now();
    const attemptTimeout = Number.isFinite(remaining)
      ? Math.max(1, Math.min(remaining, ATTEMPT_CAP_MS))
      : ATTEMPT_CAP_MS;

    const outcome = await probeOnce(base, path, prefix, attemptTimeout, deep);
    checks = outcome.checks;
    reasons = outcome.reasons;

    for (const check of checks)
      out.detail(`${check.name.padEnd(12)} ${check.detail}`, check.ok);

    if (outcome.ok) {
      const duration = Date.now() - started;
      if (wantJson)
        out.raw(
          JSON.stringify(
            { ready: true, url, attempts, duration_ms: duration, checks },
            null,
            2,
          ),
        );
      else
        out.ok(
          `ready — ${url} (${attempts} attempt${attempts > 1 ? 's' : ''} in ${formatDuration(duration)})`,
        );
      return EXIT.OK;
    }

    if (out.verbose && Date.now() + interval < deadline)
      out.detail(
        `attempt ${attempts} failed, retrying in ${formatDuration(interval)}`,
        false,
      );

    if (Date.now() + interval >= deadline) break;
    await sleep(Math.min(interval, deadline - Date.now()));
  }

  const duration = Date.now() - started;
  if (wantJson)
    out.raw(
      JSON.stringify(
        { ready: false, url, attempts, duration_ms: duration, checks, reasons },
        null,
        2,
      ),
    );
  else {
    out.fail(
      `not ready — ${base} (${attempts} attempt${attempts > 1 ? 's' : ''} in ${formatDuration(duration)})`,
    );
    for (const reason of reasons) out.info(`  - ${reason}`);
  }

  return EXIT.NOT_READY;
}

interface ProbeOutcome {
  ok: boolean;
  checks: CheckResult[];
  reasons: string[];
}

/** Runs every probe once and reports what failed. */
export async function probeOnce(
  base: string,
  path: string,
  prefix: string,
  timeoutMs: number,
  deep: boolean,
): Promise<ProbeOutcome> {
  const checks: CheckResult[] = [];

  const url = joinUrl(base, path);
  const probe = await httpGetJson(url, timeoutMs);
  checks.push({
    name: 'http',
    ok: probe.ok,
    detail: describeHttp(probe),
    duration_ms: probe.duration_ms,
  });
  if (!probe.ok) return { ok: false, checks, reasons: [describeHttp(probe)] };

  const verdict = evaluateWellKnown(probe.body);
  checks.push({
    name: 'well-known',
    ok: verdict.ok,
    detail: describeWellKnown(probe.body),
    duration_ms: 0,
  });
  if (!verdict.ok) return { ok: false, checks, reasons: verdict.reasons };

  if (deep) {
    const deepUrl = apiUrl(base, prefix, 'configs');
    const config = await httpGetJson(deepUrl, timeoutMs);
    const valid = config.ok && isRecord(config.body);
    checks.push({
      name: 'api/configs',
      ok: valid,
      detail: describeHttp(config),
      duration_ms: config.duration_ms,
    });
    if (!valid)
      return {
        ok: false,
        checks,
        reasons: [
          config.ok
            ? `GET ${deepUrl} did not return an object (is the database up?)`
            : `GET ${deepUrl} failed: ${describeHttp(config)}`,
        ],
      };
  }

  return { ok: true, checks, reasons: [] };
}

/** One-line description of an HTTP probe result. */
export function describeHttp(probe: HttpProbe): string {
  if (probe.status === null) return probe.error ?? 'unreachable';
  if (probe.error) return `HTTP ${probe.status} — ${probe.error}`;
  return `${probe.status} OK in ${formatDuration(probe.duration_ms)}`;
}

function isRecord(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
