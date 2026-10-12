#!/usr/bin/env node
/**
 * `noxcli` — operate a Nox node from the command line.
 *
 * Shipped in the container image (`/usr/local/bin/noxcli`, see `Dockerfile`)
 * and runnable from the repo with `npm run noxcli -- <args>`. It talks HTTP to
 * the server only: no database, no config service, no credentials.
 *
 *   noxcli ready      # exit 0 when the server is up and ready (healthchecks)
 *   noxcli status     # identity, gateway, endpoints, uptime
 *   noxcli version    # CLI / Node / server versions
 *
 * ```
 * HEALTHCHECK CMD noxcli ready --quiet
 * ```
 */
import { HELP_OPTION, flag, parseArgs, renderOptions } from './cli.args';
import { outputFromFlags } from './cli.output';
import { EXIT, CliUsageError, type CliCommand } from './cli.types';
import { readyCommand } from './commands/ready.command';
import { statusCommand } from './commands/status.command';
import { versionCommand } from './commands/version.command';

/** Every command, in the order shown by the help. */
export const COMMANDS: CliCommand[] = [
  readyCommand,
  statusCommand,
  versionCommand,
];

/** Global usage message. */
export function globalHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length)) + 2;

  return [
    'noxcli — operate a Nox node from the command line',
    '',
    'Usage:',
    '  noxcli <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map(
      (command) => `  ${command.name.padEnd(width)}${command.summary}`,
    ),
    '',
    'Options:',
    renderOptions([HELP_OPTION]),
    '',
    'Examples:',
    '  noxcli ready --quiet                 # container healthcheck',
    '  noxcli ready --wait --timeout 5m     # wait for a booting server',
    '  noxcli ready --deep                  # also check the API/DB path',
    '  noxcli status --json                 # raw discovery document',
    '',
    'Run `noxcli help <command>` for the options of a command.',
  ].join('\n');
}

/** Help of one command. */
export function commandHelp(command: CliCommand): string {
  return [
    `noxcli ${command.name} — ${command.summary}`,
    '',
    'Usage:',
    `  ${command.usage}`,
    '',
    'Options:',
    renderOptions(command.options),
    ...(command.notes?.length
      ? ['', 'Notes:', ...command.notes.map((note) => `  ${note}`)]
      : []),
  ].join('\n');
}

/** Runs the CLI and returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  // `noxcli`, `noxcli help`, `noxcli --help`, `noxcli help ready`
  if (!first || first === 'help' || first === '--help' || first === '-h') {
    const requested = first === 'help' ? argv[1] : undefined;

    if (requested) {
      const command = COMMANDS.find((entry) => entry.name === requested);
      if (!command) {
        process.stderr.write(
          `error: unknown command "${requested}"\n\n${globalHelp()}\n`,
        );
        return EXIT.USAGE;
      }
      process.stdout.write(`${commandHelp(command)}\n`);
      return EXIT.OK;
    }

    process.stdout.write(`${globalHelp()}\n`);
    return EXIT.OK;
  }

  // `noxcli --version` is a shortcut for the `version` command.
  const name =
    first === '--version' || first === '-V' ? versionCommand.name : first;
  const rest = first === '--version' || first === '-V' ? [] : argv.slice(1);
  const command = COMMANDS.find((entry) => entry.name === name);

  if (!command) {
    process.stderr.write(
      `error: unknown command "${first}"\n\n${globalHelp()}\n`,
    );
    return EXIT.USAGE;
  }

  const args = parseArgs(rest, command.options);
  if (flag(args.values, 'help')) {
    process.stdout.write(`${commandHelp(command)}\n`);
    return EXIT.OK;
  }

  return command.run({
    args,
    out: outputFromFlags(args.values),
    env: process.env,
  });
}

/** Entry point: never leaks a raw stack trace on a usage error. */
function bootstrap(): void {
  void main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof CliUsageError) {
        process.stderr.write(`error: ${error.message}\n`);
        process.stderr.write('Run `noxcli --help` for usage.\n');
        process.exitCode = EXIT.USAGE;
        return;
      }

      process.stderr.write(
        `error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = EXIT.ERROR;
    });
}

bootstrap();
