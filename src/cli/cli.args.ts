/**
 * Minimal argument parser for `noxcli`. No dependency on `commander`/`yargs`:
 * the image must stay slim and the option set is tiny and fully declared by
 * each command (`OptionSpec[]`), which also drives the help output.
 */
import { CliUsageError, type OptionSpec, type ParsedArgs } from './cli.types';

/**
 * Parses arguments against the declared options.
 *
 * Supported forms: `--name value`, `--name=value`, `-n value`, `-n=value`,
 * `--flag`, `-f`, and `--` to stop option parsing. Unknown options are
 * rejected (a typo in a healthcheck must fail loudly, not silently pass).
 */
export function parseArgs(argv: string[], specs: OptionSpec[]): ParsedArgs {
  const byName = new Map<string, OptionSpec>();
  for (const spec of specs) {
    byName.set(spec.name, spec);
    if (spec.alias) byName.set(spec.alias, spec);
  }

  const values: Record<string, string | boolean> = {};
  for (const spec of specs)
    if (spec.default !== undefined) values[spec.name] = spec.default;

  const provided: string[] = [];
  const positionals: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (positionalOnly || !arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }

    if (arg === '--') {
      positionalOnly = true;
      continue;
    }

    const [rawName, inline] = splitOnce(arg.replace(/^--?/, ''), '=');
    const spec = byName.get(rawName);
    if (!spec)
      throw new CliUsageError(
        `Unknown option: ${arg}${suggest(rawName, specs)}`,
      );

    provided.push(spec.name);

    if (spec.type === 'boolean') {
      values[spec.name] =
        inline === undefined ? true : parseBoolean(rawName, inline);
      continue;
    }

    const value = inline ?? argv[++index];
    if (value === undefined)
      throw new CliUsageError(`Missing value for --${spec.name}`);
    values[spec.name] = value;
  }

  return {
    command: positionals[0] ?? null,
    args: positionals.slice(1),
    values,
    provided,
  };
}

/** Reads a boolean option. */
export function flag(
  values: Record<string, string | boolean>,
  name: string,
): boolean {
  return values[name] === true;
}

/** Reads a string option (declared defaults included). */
export function str(
  values: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

/** Multipliers for `parseDuration()`. */
const DURATIONS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

/**
 * Parses a duration: `500ms`, `5s`, `2m`, `1h`. A bare number counts as
 * seconds (`--timeout 5` is five seconds, not five milliseconds).
 */
export function parseDuration(input: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(input.trim());
  if (!match)
    throw new CliUsageError(
      `Invalid duration: "${input}" (expected e.g. 500ms, 5s, 2m)`,
    );

  const unit = match[2]?.toLowerCase();
  const factor = unit ? DURATIONS[unit] : 1_000;
  return Math.max(1, Math.round(Number(match[1]) * factor));
}

/** Formats a duration for humans: `120ms`, `1.5s`, `3m`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Renders the option list of a command help, aligned. */
export function renderOptions(options: OptionSpec[]): string {
  const left = options.map((option) => {
    const names = option.alias
      ? `-${option.alias}, --${option.name}`
      : `    --${option.name}`;
    return option.value ? `${names} ${option.value}` : names;
  });
  const width = Math.max(...left.map((entry) => entry.length)) + 2;

  return options
    .map((option, index) => {
      const suffix =
        option.default !== undefined ? ` (default: ${option.default})` : '';
      return `  ${left[index].padEnd(width)}${option.description}${suffix}`;
    })
    .join('\n');
}

/** Every command accepts `--help`. */
export const HELP_OPTION: OptionSpec = {
  name: 'help',
  alias: 'h',
  type: 'boolean',
  description: 'Show the help of this command.',
};

/** Splits on the first occurrence only (`--url=http://x?a=b` keeps the `=`). */
function splitOnce(input: string, separator: string): [string, string?] {
  const index = input.indexOf(separator);
  if (index === -1) return [input];
  return [input.slice(0, index), input.slice(index + separator.length)];
}

function parseBoolean(name: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new CliUsageError(`Invalid boolean for --${name}: "${value}"`);
}

/** "Did you mean --url?" hint for a mistyped option. */ function suggest(
  name: string,
  specs: OptionSpec[],
): string {
  const match = specs.find(
    (spec) =>
      spec.name.startsWith(name.slice(0, 2)) ||
      name.slice(0, 2).startsWith(spec.name.slice(0, 2)),
  );
  return match ? ` (did you mean --${match.name}?)` : '';
}
