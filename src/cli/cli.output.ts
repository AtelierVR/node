/**
 * Output helper for `noxcli`. Colors are only emitted on a TTY (and honor
 * `NO_COLOR`), so the output stays clean in `docker logs`, healthchecks and
 * CI — and the JSON mode (`--json`) is never decorated.
 */
import { flag } from './cli.args';
import type { OptionSpec } from './cli.types';

const COLORS = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
} as const;

const useColor =
  Boolean(process.stdout.isTTY) &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb';

function paint(color: keyof typeof COLORS, text: string): string {
  return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

export interface OutputOptions {
  /** Print nothing at all — the exit code is the only result (healthchecks). */
  quiet?: boolean;
  /** Print each probe and each retry. */
  verbose?: boolean;
}

/** Options shared by every command that prints something on stdout. */
export const OUTPUT_OPTIONS: OptionSpec[] = [
  {
    name: 'json',
    type: 'boolean',
    description: 'Print the result as JSON instead of text.',
  },
  {
    name: 'quiet',
    alias: 'q',
    type: 'boolean',
    description: 'Print nothing; the exit code is the only output.',
  },
  {
    name: 'verbose',
    alias: 'v',
    type: 'boolean',
    description: 'Print every probe and every retry.',
  },
];

/** Builds the `Output` for a parsed command line. */
export function outputFromFlags(
  values: Record<string, string | boolean>,
): Output {
  return new Output({
    quiet: flag(values, 'quiet'),
    verbose: flag(values, 'verbose'),
  });
}

export class Output {
  private readonly silence: boolean;
  private readonly chatty: boolean;

  constructor(options: OutputOptions = {}) {
    this.silence = options.quiet === true;
    this.chatty = options.verbose === true;
  }

  get quiet(): boolean {
    return this.silence;
  }

  get verbose(): boolean {
    return this.chatty;
  }

  /** Success line: `✓ ready …`. */
  ok(message: string): void {
    if (!this.silence)
      process.stdout.write(`${paint('green', '✓')} ${message}\n`);
  }

  /** Failure line: `✗ not ready …`. */
  fail(message: string): void {
    if (!this.silence)
      process.stdout.write(`${paint('red', '✗')} ${message}\n`);
  }

  /** Neutral information. */
  info(message: string): void {
    if (!this.silence) process.stdout.write(`${message}\n`);
  }

  /** Indented detail line, hidden unless `--verbose`. */
  detail(message: string, ok = true): void {
    if (this.silence || !this.chatty) return;
    const mark = ok ? paint('green', '·') : paint('red', '·');
    process.stdout.write(`  ${mark} ${paint('dim', message)}\n`);
  }

  /** Warning line, shown unless `--quiet`. */
  warn(message: string): void {
    if (!this.silence)
      process.stdout.write(`${paint('yellow', '!')} ${message}\n`);
  }

  /** Raw line, always printed unless `--quiet` (used by `--json`). */
  raw(payload: string): void {
    if (!this.silence) process.stdout.write(`${payload}\n`);
  }

  /** Error line — goes to stderr, even in `--quiet` mode (never hides a real error). */
  error(message: string): void {
    process.stderr.write(`${paint('red', 'error')} ${message}\n`);
  }

  /** Highlighted label, e.g. `status`. */
  label(text: string): string {
    return paint('cyan', text);
  }
}
