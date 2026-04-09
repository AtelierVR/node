import { promises as dns, SrvRecord } from 'node:dns';
import { NoxWellKnown, NodeInfoLinks } from 'src/fediverse/fediverse.types';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NoxWellKnownDto } from 'src/fediverse/dto/nox-well-known.dto';

const WELL_KNOWN_PATH = '/.well-known/nox';
const NODEINFO_PATH = '/.well-known/nodeinfo';
const NOX_NODEINFO_REL = 'nox/1.0';
const FALLBACK_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface DiscoveredWellKnown {
    url: string;
    data: NoxWellKnown;
    /** Milliseconds until cache expiry, derived from HTTP response headers. */
    ttlMs: number;
}

/**
 * Parses cache TTL in milliseconds from HTTP response headers.
 * Priority: Cache-Control max-age → Expires → fallback (5 min).
 */
function parseTtlMs(headers: Headers): number {
    const cc = headers.get('cache-control');
    if (cc) {
        const m = /max-age=(\d+)/.exec(cc);
        if (m) {
            const s = parseInt(m[1], 10);
            if (s > 0) return s * 1000;
        }
    }
    const expires = headers.get('expires');
    if (expires) {
        const ttl = new Date(expires).getTime() - Date.now();
        if (ttl > 0) return ttl;
    }
    return FALLBACK_TTL_MS;
}

/**
 * GETs a URL, parses the JSON body as NoxWellKnown, and reads TTL from headers.
 * Returns null on any error (network, non-2xx, JSON parse failure).
 */
async function tryFetchWellKnown(url: string): Promise<DiscoveredWellKnown | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const raw = await res.json();
        const data = plainToInstance(NoxWellKnownDto, raw);
        const errors = validateSync(data, { whitelist: true });
        if (errors.length > 0) return null;
        return { url, data: data as NoxWellKnown, ttlMs: parseTtlMs(res.headers) };
    } catch {
        return null;
    }
}

/**
 * Strategy 1 — DNS SRV: _nox._tcp.<address>
 * Each record provides a target hostname and port.
 * We try https then http for each record in priority order.
 */
async function discoverViaSrv(address: string): Promise<DiscoveredWellKnown | null> {
    let records: SrvRecord[];
    try {
        records = await dns.resolveSrv(`_nox._tcp.${address}`);
    } catch {
        return null; // NXDOMAIN or resolver error
    }

    // Sort by priority (lower = preferred), then weight (higher = preferred)
    records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);

    for (const { name, port } of records)
        for (const scheme of ['https', 'http'] as const) {
            const url = `${scheme}://${name}:${port}${WELL_KNOWN_PATH}`;
            const result = await tryFetchWellKnown(url);
            if (result) return result;
        }
    return null;
}

/**
 * Strategy 2 — DNS TXT: _nox.<address>
 * Looks for a record containing "ng=<url>" and fetches it.
 */
async function discoverViaTxt(address: string): Promise<DiscoveredWellKnown | null> {
    let records: string[][];
    try {
        records = await dns.resolveTxt(`_nox.${address}`);
    } catch {
        return null; // NXDOMAIN or resolver error
    }

    for (const parts of records) {
        const line = parts.join('');
        const match = line.match(/(?:^|[;\s])ng=([^\s;]+)/);
        if (!match?.[1]) continue;
        const result = await tryFetchWellKnown(match[1]);
        if (result) return result;
    }
    return null;
}

/**
 * Strategy 3 — ActivityPub NodeInfo: /.well-known/nodeinfo
 * Fetches the nodeinfo links document and follows the link with rel="nox/1.0".
 * Tries https then http.
 */
async function discoverViaNodeInfo(address: string): Promise<DiscoveredWellKnown | null> {
    for (const scheme of ['https', 'http'] as const) 
        try {
            const res = await fetch(`${scheme}://${address}${NODEINFO_PATH}`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) continue;
            const doc: NodeInfoLinks = await res.json();
            const link = doc.links?.find(e => e.rel === NOX_NODEINFO_REL);
            if (!link?.href) continue;
            const result = await tryFetchWellKnown(link.href);
            if (result) return result;
        } catch {
            // network error — try next scheme
        }
    return null;
}

/**
 * Strategy 4 — Manual fallback: try /.well-known/nox directly.
 * Tries https then http.
 */
async function discoverManual(address: string): Promise<DiscoveredWellKnown | null> {
    for (const scheme of ['https', 'http'] as const) {
        const url = `${scheme}://${address}${WELL_KNOWN_PATH}`;
        const result = await tryFetchWellKnown(url);
        if (result) return result;
    }
    return null;
}

/**
 * Discovers /.well-known/nox for a given address.
 *
 * Tries four strategies in order, returning the first successful result:
 *   1. DNS SRV  — _nox._tcp.<address>
 *   2. DNS TXT  — _nox.<address>, record value: ng=<url>
 *   3. NodeInfo — /.well-known/nodeinfo, link rel="nox/1.0"
 *   4. Manual   — /.well-known/nox directly (https then http)
 *
 * Returns null if all strategies fail.
 */
export async function discoverWellKnown(address: string): Promise<DiscoveredWellKnown | null> {
    return (
        (await discoverViaSrv(address)) ??
        (await discoverViaTxt(address)) ??
        (await discoverViaNodeInfo(address)) ??
        (await discoverManual(address))
    );
}
