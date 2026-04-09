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
 * Spawns `python3 tools/assetbundle.py <path>` and parses the JSON output.
 * Throws on non-zero exit or JSON parse failure.
 */
export async function checkValidAssetFile(filePath: string): Promise<AnalyzedAssetBundle> {
    return new Promise<AnalyzedAssetBundle>((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        logger.debug(`Spawning ${PYTHON3_BIN} ${ASSETBUNDLE_PY} for file: ${filePath}`, CTX);
        const proc = spawn(PYTHON3_BIN, [ASSETBUNDLE_PY, filePath]);

        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('error', (err) => {
            logger.error(`Failed to spawn analysis tool: ${err.message}`, err.stack, CTX);
            reject(new Error(`Failed to spawn analysis tool: ${err.message}`));
        });

        proc.on('close', (code) => {
            logger.debug(`python3 process exited with code ${code} for file: ${filePath}`, CTX);
            if (stderr.trim()) logger.warn(`python3 stderr: ${stderr.trim()}`, CTX);

            if (code !== 0) {
                const msg = `Asset analysis failed (exit ${code}): ${stderr.trim() || stdout.trim()}`;
                logger.error(msg, undefined, CTX);
                return reject(new Error(msg));
            }

            try {
                const result = JSON.parse(stdout) as AnalyzedAssetBundle;
                logger.debug(`Analysis succeeded — engine: ${result.engine}, platform: ${result.platform}, name: ${result.name}`, CTX);
                resolve(result);
            } catch {
                const msg = `Asset analysis produced invalid JSON: ${stdout.slice(0, 200)}`;
                logger.error(msg, undefined, CTX);
                reject(new Error(msg));
            }
        });
    });
}
