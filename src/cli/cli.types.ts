/**
 * Shared types for `noxcli`, the small command-line companion shipped inside
 * the Nox container image (see `Dockerfile`) and available in the repo through
 * `npm run noxcli`.
 *
 * The CLI must stay dependency-free — Node built-ins only, no NestJS, no
 * Prisma, no config service — so it can run *before* or *next to* the server:
 * container healthchecks, entrypoints waiting for readiness, and debugging on
 * a box where only the image is available.
 */
import type { Output } from './cli.output';

/** Exit codes of `noxcli`. Stable: container healthchecks rely on them. */
export const EXIT = {
  /** Success — the server is ready (or the command succeeded). */
  OK: 0,
  /** The server is unreachable, or not ready yet. */
  NOT_READY: 1,
  /** Bad command line. */
  USAGE: 2,
  /** Unexpected internal error. */
  ERROR: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Bad command line: caught by the entry point, printed, exits with `EXIT.USAGE`. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export type OptionType = 'boolean' | 'string';

/** Declaration of one option — used both to parse the arguments and to print the help. */
export interface OptionSpec {
  /** Long name, used as `--name`. */
  name: string;
  /** Optional one-letter alias, used as `-n`. */
  alias?: string;
  type: OptionType;
  description: string;
  /** Value placeholder shown in the help, e.g. `<url>`. */
  value?: string;
  /** Default value (string options only), shown in the help. */
  default?: string;
}

/** Result of `parseArgs()`. */
export interface ParsedArgs {
  /** First positional argument (`ready`, `status`, `version`, …), if any. */
  command: string | null;
  /** Remaining positional arguments. */
  args: string[];
  /** Option values, keyed by long name. */
  values: Record<string, string | boolean>;
  /** Long names the user actually passed (to tell a default from an explicit value). */
  provided: string[];
}

/** Result of one probe, reported by `ready` and `status`. */
export interface CheckResult {
  /** Short check name (`http`, `well-known`, `configs`). */
  name: string;
  ok: boolean;
  /** Human-readable outcome, e.g. `200 OK (12ms)`. */
  detail: string;
  duration_ms: number;
}

/** Everything a command needs to run. */
export interface CommandContext {
  args: ParsedArgs;
  out: Output;
  env: NodeJS.ProcessEnv;
}

/** A `noxcli` sub-command. */
export interface CliCommand {
  /** Command name, as typed: `noxcli <name>`. */
  name: string;
  /** One-line description shown in the global help. */
  summary: string;
  /** Usage line shown in the command help. */
  usage: string;
  /** Options accepted by the command. */
  options: OptionSpec[];
  /** Extra paragraphs appended to the command help. */
  notes?: string[];
  run(ctx: CommandContext): Promise<ExitCode>;
}
