/**
 * `noxcli version` — versions of the CLI, of the Node runtime, and of the
 * server it points at (when reachable). Useful to tell *which* image actually
 * runs in a container: `docker exec nox.node noxcli version`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { HELP_OPTION, flag, parseDuration, str } from '../cli.args';
import { OUTPUT_OPTIONS } from '../cli.output';
import { httpGetJson, pick, pickText } from '../cli.probe';
import { TARGET_OPTIONS, joinUrl, resolveBaseUrl } from '../cli.target';
import {
  EXIT,
  type CliCommand,
  type CommandContext,
  type ExitCode,
} from '../cli.types';
import { DEFAULT_PATH } from './ready.command';

/** Reads the `version` of the package the CLI is shipped with. */
function packageVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version;

  // Walk up from `dist/cli` (image) or `src/cli` (repo) until a manifest is found.
  let dir = __dirname;
  for (;;) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { version?: string };
      if (manifest.version) return manifest.version;
    } catch {
      // No package.json here (or unreadable) — keep walking up.
    }

    const parent = dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
}

export const versionCommand: CliCommand = {
  name: 'version',
  summary: 'Print the CLI, Node and server versions.',
  usage: 'noxcli version [options]',
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
      default: '2s',
      description: 'Request budget for the server lookup.',
    },
    ...OUTPUT_OPTIONS,
    HELP_OPTION,
  ],
  notes: [
    'Exit codes: 0 always (the server lookup is informational; use `noxcli ready` to gate on it).',
  ],
  run: runVersion,
};

export async function runVersion(ctx: CommandContext): Promise<ExitCode> {
  const { values } = ctx.args;
  const out = ctx.out;

  const base = resolveBaseUrl(values, ctx.env);
  const url = joinUrl(base, str(values, 'path') ?? DEFAULT_PATH);
  const probe = await httpGetJson(
    url,
    parseDuration(str(values, 'timeout') ?? '2s'),
  );

  const software = pick('software', probe.body) as
    | { name?: string; version?: string }
    | undefined;
  const server = probe.ok
    ? `${software?.name ?? 'nox'} ${software?.version ?? 'unknown'} (${pickText(probe.body, 'status')})`
    : null;

  if (flag(values, 'json')) {
    out.raw(
      JSON.stringify(
        {
          noxcli: packageVersion(),
          runtime: process.version,
          server: server
            ? { name: software?.name, version: software?.version, url }
            : null,
        },
        null,
        2,
      ),
    );
    return EXIT.OK;
  }

  out.info(`${out.label('noxcli'.padEnd(9))} ${packageVersion()}`);
  out.info(`${out.label('runtime'.padEnd(9))} node ${process.version}`);
  out.info(
    `${out.label('server'.padEnd(9))} ${
      server
        ? `${server} @ ${base}`
        : `unreachable @ ${base} (${probe.error ?? 'no response'})`
    }`,
  );

  return EXIT.OK;
}
