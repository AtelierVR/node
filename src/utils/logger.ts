import { LoggerService } from '@nestjs/common';

export type LogLevel = 'log' | 'error' | 'warning' | 'debug';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  tag: string | null;
}

const MAX_LOGS = 5000;

// ANSI color helpers
const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';
const FG_BLACK = '\x1b[30m';
const WHITE = '\x1b[37m';
const FG_CYAN = '\x1b[36m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_CYAN = '\x1b[46m';

function pad(num: number, sz: number) {
  let s = String(num);
  while (s.length < sz) s = '0' + s;
  return s;
}

function formatTime(d = new Date()): string {
  const hh = pad(d.getHours(), 2);
  const mm = pad(d.getMinutes(), 2);
  const ss = pad(d.getSeconds(), 2);
  const ms = pad(d.getMilliseconds(), 3);
  return `${hh}:${mm}:${ss}.${ms}`;
}

function levelBadge(level: LogLevel) {
  const displayMap: Record<LogLevel, string> = {
    log: 'LOG',
    error: 'ERROR',
    warning: 'WARNING',
    debug: 'DEBUG',
  };
  const text = displayMap[level];

  const width = Object.values(displayMap).reduce((max, v) => Math.max(max, v.length), 0) + 2;
  const left = Math.floor((width - text.length) / 2);
  const right = width - text.length - left;
  const padded = ' '.repeat(left) + text + ' '.repeat(right);

  switch (level) {
    case 'error': return `${BG_RED}${WHITE}${padded}${RESET}`;
    case 'warning': return `${BG_YELLOW}${FG_BLACK}${padded}${RESET}`;
    case 'debug': return `${BG_CYAN}${FG_BLACK}${padded}${RESET}`;
    default: return `${BG_GREEN}${FG_BLACK}${padded}${RESET}`;
  }
}

/**
 * Format a console line: time badge tag message
 * If no tag provided, this will try to parse a leading [tag] from the raw message.
 */
export function formatConsoleLine(level: LogLevel, tag: string | null, raw: string): string {
  let parsedTag: string | null = tag ?? null;
  let message = raw;
  if (!parsedTag) {
    const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/s);
    if (m) {
      parsedTag = m[1];
      message = m[2] ?? '';
    }
  }

  const timePart = `${GRAY}${formatTime(new Date())}${RESET}`;
  const badge = levelBadge(level);

  const tagText = parsedTag ? `[${parsedTag}]` : '';
  const tagPart = parsedTag ? `${FG_CYAN}${tagText}${RESET}` : '';

  return `${timePart} ${badge} ${tagPart} ${message}`;
}

function fmt(msg: any): string {
  if (msg instanceof Error)
    return msg.stack || msg.message;
  if (msg === undefined)
    return '<undefined>';
  if (msg === null)
    return '<null>';
  if (typeof msg === 'object')
    try {
      return JSON.stringify(msg);
    } catch { }
  return String(msg);
}

class LoggerStore {
  private static logs: LogEntry[] = [];

  private static push(level: LogLevel, message: string, tag?: string | null) {
    try {
      this.logs.push({
        timestamp: new Date(),
        level,
        message,
        tag: tag ?? null
      });
      if (this.logs.length > MAX_LOGS)
        this.logs.splice(0, this.logs.length - MAX_LOGS);
    } catch { /* best-effort */ }
  }

  private static joinParts(parts: any[]): string {
    return parts.map(p => {
      if (p instanceof Error)
        return p.stack || p.message;
      if (typeof p === 'object')
        try {
          return JSON.stringify(p);
        } catch (e) {
          return String(p) + ' (circular)';
        }
      return String(p);
    }).join(' ');
  }

  static log(...parts: any[]) { this.push('log', this.joinParts(parts)); }
  static error(...parts: any[]) { this.push('error', this.joinParts(parts)); }
  static warn(...parts: any[]) { this.push('warning', this.joinParts(parts)); }
  static debug(...parts: any[]) { this.push('debug', this.joinParts(parts)); }

  static logTagged(tag: string | null, ...parts: any[]) { this.push('log', this.joinParts(parts), tag); }
  static errorTagged(tag: string | null, ...parts: any[]) { this.push('error', this.joinParts(parts), tag); }
  static warnTagged(tag: string | null, ...parts: any[]) { this.push('warning', this.joinParts(parts), tag); }
  static debugTagged(tag: string | null, ...parts: any[]) { this.push('debug', this.joinParts(parts), tag); }

  static getLogs(limit = 500, after?: number) {
    let slice = this.logs;
    if (after !== undefined) slice = slice.filter(l => l.timestamp.getTime() > after);
    if (limit <= 0) return [] as LogEntry[];
    if (slice.length <= limit) return slice.slice();
    return slice.slice(slice.length - limit);
  }
}

/** Nest-compatible Logger that writes formatted lines and stores them. */
export class NestLogger implements LoggerService {
  log(message: any, context?: string) {
    const raw = fmt(message);
    const cleaned = context && raw.startsWith(`[${context}]`) ? raw.slice(context.length + 2).replace(/^\s*/, '') : raw;
    LoggerStore.logTagged(context ?? null, cleaned);
    try { process.stdout.write(formatConsoleLine('log', context ?? null, cleaned) + '\n'); } catch { /* ignore */ }
  }

  error(message: any, trace?: string, context?: string) {
    const raw = fmt(message);
    const cleaned = context && raw.startsWith(`[${context}]`) ? raw.slice(context.length + 2).replace(/^\s*/, '') : raw;
    const combined = cleaned + (trace ? '\n' + trace : '');
    LoggerStore.errorTagged(context ?? null, combined);
    try { process.stderr.write(formatConsoleLine('error', context ?? null, combined) + '\n'); } catch { /* ignore */ }
  }

  warn(message: any, context?: string) {
    const raw = fmt(message);
    const cleaned = context && raw.startsWith(`[${context}]`) ? raw.slice(context.length + 2).replace(/^\s*/, '') : raw;
    LoggerStore.warnTagged(context ?? null, cleaned);
    try { process.stderr.write(formatConsoleLine('warning', context ?? null, cleaned) + '\n'); } catch { /* ignore */ }
  }

  debug(message: any, context?: string) {
    const raw = fmt(message);
    const cleaned = context && raw.startsWith(`[${context}]`) ? raw.slice(context.length + 2).replace(/^\s*/, '') : raw;
    LoggerStore.debugTagged(context ?? null, cleaned);
    try { process.stdout.write(formatConsoleLine('debug', context ?? null, cleaned) + '\n'); } catch { /* ignore */ }
  }

  verbose(message: any, context?: string) {
    const raw = fmt(message);
    const cleaned = context && raw.startsWith(`[${context}]`) ? raw.slice(context.length + 2).replace(/^\s*/, '') : raw;
    LoggerStore.debugTagged(context ?? null, cleaned);
    try { process.stdout.write(formatConsoleLine('log', context ?? null, cleaned) + '\n'); } catch { /* ignore */ }
  }
}

export default LoggerStore;
