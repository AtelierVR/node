import {
  flag,
  formatDuration,
  parseArgs,
  parseDuration,
  renderOptions,
  str,
} from './cli.args';
import { CliUsageError, type OptionSpec } from './cli.types';

const SPECS: OptionSpec[] = [
  { name: 'url', alias: 'u', type: 'string', description: 'Server URL' },
  {
    name: 'timeout',
    alias: 't',
    type: 'string',
    description: 'Budget',
    default: '5s',
  },
  { name: 'wait', alias: 'w', type: 'boolean', description: 'Wait' },
];

describe('parseArgs', () => {
  it('reads positionals, string options and their default values', () => {
    const args = parseArgs(['ready', '--url', 'http://x', 'extra'], SPECS);

    expect(args.command).toBe('ready');
    expect(args.args).toEqual(['extra']);
    expect(str(args.values, 'url')).toBe('http://x');
    expect(str(args.values, 'timeout')).toBe('5s');
    expect(args.provided).toEqual(['url']);
  });

  it('supports aliases, inline values and flags', () => {
    const args = parseArgs(['-w', '-u=http://x?a=b', '-t', '300ms'], SPECS);

    expect(flag(args.values, 'wait')).toBe(true);
    expect(str(args.values, 'url')).toBe('http://x?a=b');
    expect(str(args.values, 'timeout')).toBe('300ms');
    expect(args.provided).toEqual(['wait', 'url', 'timeout']);
  });

  it('rejects unknown options with a suggestion', () => {
    expect(() => parseArgs(['--urll'], SPECS)).toThrow(CliUsageError);
    expect(() => parseArgs(['--urll'], SPECS)).toThrow(/did you mean --url/);
  });

  it('rejects a missing value', () => {
    expect(() => parseArgs(['--url'], SPECS)).toThrow(
      /Missing value for --url/,
    );
  });

  it('treats everything after -- as positional', () => {
    const args = parseArgs(['ready', '--', '--url'], SPECS);

    expect(args.args).toEqual(['--url']);
  });

  it('validates booleans passed inline', () => {
    expect(flag(parseArgs(['--wait=false'], SPECS).values, 'wait')).toBe(false);
    expect(() => parseArgs(['--wait=maybe'], SPECS)).toThrow(/Invalid boolean/);
  });
});

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['5s', 5_000],
    ['2m', 120_000],
    ['1h', 3_600_000],
    ['5', 5_000],
    ['1.5s', 1_500],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('soon')).toThrow(CliUsageError);
  });
});

describe('formatDuration', () => {
  it('picks a readable unit', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(1_500)).toBe('1.5s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('∞');
  });
});

describe('renderOptions', () => {
  it('aligns names and shows defaults', () => {
    const lines = renderOptions(SPECS).split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^ {2}-u, --url +Server URL$/);
    expect(lines[1]).toMatch(/^ {2}-t, --timeout +Budget \(default: 5s\)$/);
  });
});
