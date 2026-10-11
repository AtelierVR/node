import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { NestLogger } from './logger';

const logger = new NestLogger();
const CTX = 'AssetBundle';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnalyzedAssetBundle {
  name: string;
  engine: string;
  version: string;
  /** Numeric platform ID as returned by UnityPy */
  platform: number;
  data: {
    MonoBehaviour?: MonoBehaviourEntry[];
    MonoScript?: MonoScriptEntry[];
    [key: string]: any;
  };
}

export interface MonoBehaviourEntry {
  path_id: number;
  raw_tree?: {
    m_Script?: { m_PathID?: number };
    [key: string]: any;
  };
}

export interface MonoScriptEntry {
  path_id: number;
  raw_tree?: {
    m_Namespace?: string;
    m_ClassName?: string;
  };
}

// ── Platform map ──────────────────────────────────────────────────────────────

export const Platform: Record<number, string> = {
  2: 'macos',
  9: 'ios',
  13: 'android',
  19: 'windows',
  24: 'linux',
  47: 'visionos',
};

// ── Execution ─────────────────────────────────────────────────────────────────

/** Absolute path to the shared Python analysis tool */
const ASSETBUNDLE_PY = join(process.cwd(), 'tools', 'assetbundle.py');
const PYTHON3_BIN = process.env.PYTHON3_BIN ?? 'python3';

/**
 * A live update reported by the analyzer through a `::name::value` line
 * (GitHub-Actions style — see `tools/assetbundle.py`).
 */
export type AnalyzerEvent =
  | {
      type: 'progress';
      /** Steps already processed, or null when the analyzer does not count them. */
      current: number | null;
      /** Steps in total, or null when unknown (`0` in the directive). */
      total: number | null;
      message: string | null;
    }
  | { type: 'message'; message: string }
  | { type: 'error'; message: string };

export interface AnalyzerOptions {
  /**
   * Called for every directive line while the analysis runs, so the caller can
   * stream the progress to a client (`::message::`, `::progress::`,
   * `::error::`).
   */
  onEvent?: (event: AnalyzerEvent) => void;
  /**
   * Aborts the analysis: the analyzer process is killed and the promise rejects
   * with an `AbortError`. Used when the resource being analyzed disappears
   * (deleted asset/release/file) so no CPU is spent on a dead upload.
   */
  signal?: AbortSignal;
}

/** `::name::value` — the analyzer's live output protocol. */
const DIRECTIVE_PATTERN = /^::([a-z_]+)::([\s\S]*)$/;

/**
 * Spawns `python3 tools/assetbundle.py <path>`.
 *
 * The analyzer reports what it is doing through `::progress::` lines —
 * `<current> <total> <message>` — forwarded to {@link AnalyzerOptions.onEvent},
 * and its result through a `::result::<json>` line. `::message::<text>` (plain
 * text) and `::error::<text>` are supported too. Any other output is kept as a
 * fallback payload, so an analyzer that only prints the JSON still works.
 *
 * Throws on non-zero exit or JSON parse failure.
 */
export async function checkValidAssetFile(
  filePath: string,
  options: AnalyzerOptions = {},
): Promise<AnalyzedAssetBundle> {
  return new Promise<AnalyzedAssetBundle>((resolve, reject) => {
    let buffer = '';
    let stderr = '';
    let result: string | null = null;
    const plain: string[] = [];
    const errors: string[] = [];

    const handleLine = (line: string): void => {
      const match = DIRECTIVE_PATTERN.exec(line);
      if (!match) {
        if (line.trim()) plain.push(line);
        return;
      }
      const [directive, name, value] = match;
      switch (name) {
        case 'message':
          logger.debug(value, CTX);
          options.onEvent?.({ type: 'message', message: value });
          break;
        case 'progress': {
          // `::progress::<current> <total> <message…>` — a `total` of 0 means the
          // analyzer cannot estimate the remaining work yet.
          const [currentToken, totalToken, ...rest] = value.trim().split(/\s+/);
          const current = Number(currentToken);
          const total = Number(totalToken);
          options.onEvent?.({
            type: 'progress',
            current: Number.isFinite(current) ? current : null,
            total: Number.isFinite(total) && total > 0 ? total : null,
            message: rest.join(' ').trim() || null,
          });
          break;
        }
        case 'error':
          errors.push(value);
          logger.error(value, undefined, CTX);
          options.onEvent?.({ type: 'error', message: value });
          break;
        case 'result':
          result = value;
          break;
        default:
          logger.debug(`Ignoring unknown directive ${directive}`, CTX);
      }
    };

    logger.debug(
      `Spawning ${PYTHON3_BIN} ${ASSETBUNDLE_PY} for file: ${filePath}`,
      CTX,
    );
    const proc = spawn(PYTHON3_BIN, [ASSETBUNDLE_PY, filePath]);

    // Killing the child is enough: the `close` handler turns an aborted run into
    // an `AbortError` instead of a failure.
    const abort = (): void => {
      logger.debug(`Killing the analyzer of ${filePath}`, CTX);
      proc.kill('SIGKILL');
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });

    proc.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('error', (err) => {
      logger.error(
        `Failed to spawn analysis tool: ${err.message}`,
        err.stack,
        CTX,
      );
      reject(new Error(`Failed to spawn analysis tool: ${err.message}`));
    });

    proc.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort);
      // The result directive is not followed by a newline: flush the tail.
      if (buffer.trim()) handleLine(buffer);

      logger.debug(
        `python3 process exited with code ${code} for file: ${filePath}`,
        CTX,
      );
      if (stderr.trim()) logger.warn(`python3 stderr: ${stderr.trim()}`, CTX);

      if (options.signal?.aborted) {
        const error = new Error(`Asset analysis aborted: ${filePath}`);
        error.name = 'AbortError';
        return reject(error);
      }

      if (code !== 0) {
        const detail =
          errors.at(-1) ?? stderr.trim() ?? plain.join(' ').trim() ?? '';
        const msg = `Asset analysis failed (exit ${code}): ${detail}`;
        logger.error(msg, undefined, CTX);
        return reject(new Error(msg));
      }

      const payload = result ?? plain.join('\n');
      try {
        const analyzed = JSON.parse(payload) as AnalyzedAssetBundle;
        logger.debug(
          `Analysis succeeded — engine: ${analyzed.engine}, platform: ${analyzed.platform}, name: ${analyzed.name}`,
          CTX,
        );
        resolve(analyzed);
      } catch {
        const msg = `Asset analysis produced invalid JSON: ${payload.slice(0, 200)}`;
        logger.error(msg, undefined, CTX);
        reject(new Error(msg));
      }
    });
  });
}
