/**
 * `noxcli status` — what does this node say about itself?
 *
 * Prints the `/.well-known/nox` discovery document in a readable form (identity,
 * gateway, endpoints, versions, uptime) or raw with `--json`. Handy inside the
 * container: `docker exec nox.node noxcli status`.
 */
import {
  HELP_OPTION,
  flag,
  formatDuration,
  parseDuration,
  str,
} from '../cli.args';
import { OUTPUT_OPTIONS } from '../cli.output';
import {
  describeWellKnown,
  evaluateWellKnown,
  httpGetJson,
  pick,
  pickText,
} from '../cli.probe';
import { TARGET_OPTIONS, joinUrl, resolveBaseUrl } from '../cli.target';
import {
  EXIT,
  type CliCommand,
  type CommandContext,
  type ExitCode,
} from '../cli.types';
import { DEFAULT_PATH } from './ready.command';

export const statusCommand: CliCommand = {
  name: 'status',
  summary:
    'Show what the server reports about itself (identity, gateway, uptime).',
  usage: 'noxcli status [options]',
  options: [
    ...TARGET_OPTIONS,
    {
      name: 'path',
      type: 'string',
      value: '<path>',
      default: DEFAULT_PATH,
      description: 'Discovery document path, served at the root of the server.',
    },
    {
      name: 'timeout',
      alias: 't',
      type: 'string',
      value: '<duration>',
      default: '5s',
      description: 'Request budget (500ms, 5s, 2m).',
    },
    ...OUTPUT_OPTIONS,
    HELP_OPTION,
  ],
  notes: [
    'Exit codes: 0 the server answered · 1 it is unreachable · 2 bad usage.',
  ],
  run: runStatus,
};

export async function runStatus(ctx: CommandContext): Promise<ExitCode> {
  const { values } = ctx.args;
  const out = ctx.out;

  const base = resolveBaseUrl(values, ctx.env);
  const url = joinUrl(base, str(values, 'path') ?? DEFAULT_PATH);
  const timeout = parseDuration(str(values, 'timeout') ?? '5s');

  const probe = await httpGetJson(url, timeout);
  if (!probe.ok) {
    if (flag(values, 'json'))
      out.raw(
        JSON.stringify(
          { reachable: false, url, error: probe.error, status: probe.status },
          null,
          2,
        ),
      );
    else out.fail(`${base} is unreachable — ${describeFailure(probe)}`);
    return EXIT.NOT_READY;
  }

  if (flag(values, 'json')) {
    out.raw(JSON.stringify(probe.body, null, 2));
    return EXIT.OK;
  }

  const verdict = evaluateWellKnown(probe.body);
  const gateway = pick('gateway', probe.body) as
    | Record<string, string>
    | undefined;
  const endpoints = pick('endpoints', probe.body) as
    | Record<string, string>
    | undefined;
  const versions = pick('versions', probe.body) as
    | Record<string, string>
    | undefined;
  const software = pick('software', probe.body) as
    | { name?: string; version?: string }
    | undefined;
  const started = Number(pick('started', probe.body));
  // Labels are padded *before* coloring, otherwise the escape codes break the alignment.
  const row = (label: string, value: string) =>
    out.info(`${out.label(label.padEnd(11))} ${value}`);

  out.info(out.label(base));
  row(
    'status',
    verdict.ok
      ? verdict.status
      : `${verdict.status} — ${verdict.reasons.join('; ')}`,
  );
  row('id', pickText(probe.body, 'id'));
  row('address', pickText(probe.body, 'address'));
  row('port', pickText(probe.body, 'port'));
  row(
    'software',
    `${software?.name ?? 'unknown'} ${software?.version ?? ''}`.trimEnd(),
  );
  row('node', pickText(probe.body, 'versions.node', process.version));
  if (Number.isFinite(started) && started > 0)
    row(
      'uptime',
      `${formatDuration(Date.now() - started)} (started ${new Date(started).toISOString()})`,
    );

  if (gateway)
    for (const [key, value] of Object.entries(gateway))
      row(`gateway.${key}`, value);

  if (endpoints) row('endpoints', Object.keys(endpoints).join(', '));
  if (versions)
    row(
      'versions',
      Object.entries(versions)
        .map(([key, value]) => `${key} ${value}`)
        .join(', '),
    );

  out.detail(describeWellKnown(probe.body));
  return verdict.ok ? EXIT.OK : EXIT.NOT_READY;
}

function describeFailure(probe: {
  status: number | null;
  error: string | null;
}): string {
  if (probe.status === null) return probe.error ?? 'no response';
  return `HTTP ${probe.status}${probe.error ? ` — ${probe.error}` : ''}`;
}
