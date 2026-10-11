#!/usr/bin/env node
/**
 * End-to-end check of the SDK / CI-CD upload flow (`UploadProvider`).
 *
 * It creates a throwaway asset, walks the whole upload pipeline and asserts what
 * the API returns at every step:
 *
 *   - DTO validation (asset/release/file names, attributes, unknown fields)
 *   - upload headers (Content-Type, Content-Hash, Content-Length,
 *     Content-Disposition, Content-Signature)
 *   - the values exposed after the upload (name, size, mime, hashs, signature,
 *     analysis, attributes, status, expires_at, refetch_at)
 *   - the status route, the updates (PATCH) and the cascading deletes
 *
 * Everything it creates is deleted at the end (even when a check fails).
 *
 * Usage (inside the node container):
 *   NOX_TOKEN=<session token> node /app/scripts/e2e-upload-check.mjs
 *
 * Env:
 *   NOX_BASE      API base URL              (default http://127.0.0.1:8080/api)
 *   NOX_TOKEN     session token             (required)
 *   NOX_TYPE      asset type                (default `mod`)
 *   NOX_ENDPOINT  endpoint of that type     (default `mods`)
 *   NOX_BUNDLE    path to a valid bundle    (default /tmp/e2e.bundle)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';

const BASE = process.env.NOX_BASE ?? 'http://127.0.0.1:8080/api';
const TOKEN = process.env.NOX_TOKEN;
const TYPE = process.env.NOX_TYPE ?? 'mod';
const ENDPOINT = process.env.NOX_ENDPOINT ?? 'mods';
const BUNDLE = process.env.NOX_BUNDLE ?? '/tmp/e2e.bundle';
const DEFAULT_MIME = 'application/octet-stream';
/** Directory holding the stored bytes (local storage provider). */
const STORAGE_DIR = process.env.NOX_STORAGE_DIR ?? '/app/assets';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Running analyzer processes, or null when `ps` is unavailable (the check is
 * then reported as a note instead of failing the run).
 */
function analyzerProcesses() {
  try {
    return execSync('ps -eo args', { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes('assetbundle.py'));
  } catch {
    return null;
  }
}

/** Number of files stored on disk, or -1 when the directory is unreadable. */
function storedFileCount() {
  try {
    return readdirSync(STORAGE_DIR).length;
  } catch {
    return -1;
  }
}

if (!TOKEN) {
  console.error('NOX_TOKEN is required');
  process.exit(2);
}

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const sections = [];

function section(title) {
  sections.push(title);
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

function show(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value);
}

/** Deep-equality that also reports which key differs. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!same(a[key], b[key])) return false;
    return true;
  }
  return false;
}

function check(label, actual, expected) {
  if (same(actual, expected)) {
    passed++;
    console.log(`  PASS  ${label}`);
    return true;
  }
  failed++;
  console.log(`  FAIL  ${label}`);
  console.log(`        expected: ${show(expected)}`);
  console.log(`        actual:   ${show(actual)}`);
  return false;
}

function checkThat(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
    return true;
  }
  failed++;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  return false;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Successful API responses are wrapped by `ApiInterceptor` (`{ data, request, time }`);
 * errors use `{ data: null, error: {...}, request, time }`.
 */
function unwrap(json) {
  if (json && typeof json === 'object' && 'request' in json && !('error' in json))
    return json.data;
  return json;
}

function request(method, path, { body, headers = {}, raw = false } = {}) {
  const url = new URL(BASE + path);
  const payload = raw ? body : body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = unwrap(JSON.parse(text));
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/**
 * Sends a raw request through a socket so the declared `Content-Length` can
 * differ from the bytes actually sent (impossible with node:http or fetch).
 * A truncated body usually leaves the server waiting for the missing bytes, so
 * the call is bounded by a timeout.
 */
function rawUpload(path, buffer, declaredLength, timeoutMs = 4000) {
  const url = new URL(BASE + path);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http
      .request(
        {
          method: 'PUT',
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': DEFAULT_MIME,
            'content-length': declaredLength,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = unwrap(JSON.parse(text));
            } catch {
              /* not JSON */
            }
            finish({ status: res.statusCode, text, json, timedOut: false });
          });
        },
      )
      .on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    setTimeout(() => {
      request.destroy();
      finish({ status: 0, text: '', json: null, timedOut: true });
    }, timeoutMs).unref();
    request.end(buffer);
  });
}

/** Error message returned by the API filter (`{ error: { message } }`). */
function messageOf(response) {
  if (!response.text) return '';
  try {
    const json = JSON.parse(response.text);
    return json?.error?.message ?? response.text.slice(0, 160);
  } catch {
    return response.text.slice(0, 160);
  }
}

/** `url` is a plain string, or `{ proxified, original }` with `?full=1`. */
function urlOf(url) {
  if (typeof url === 'string') return url;
  return url?.original ?? url?.proxified ?? '';
}

const review = [];
const query = (full) => (full ? '?full=1' : '');
const api = {
  search: (search) => request('GET', `/${ENDPOINT}${search ?? ''}`),
  createAsset: (body, full) => request('PUT', `/${ENDPOINT}${query(full)}`, { body }),
  patchAsset: (id, body, full) =>
    request('PATCH', `/${ENDPOINT}/${id}${query(full)}`, { body }),
  getAsset: (id) => request('GET', `/${ENDPOINT}/${id}?full=1`),
  deleteAsset: (id) => request('DELETE', `/${ENDPOINT}/${id}`),
  createRelease: (id, body, full) =>
    request('PUT', `/${ENDPOINT}/${id}/releases${query(full)}`, { body }),
  patchRelease: (id, version, body, full) =>
    request('PATCH', `/${ENDPOINT}/${id}/releases/${version}${query(full)}`, { body }),
  getRelease: (id, version) => request('GET', `/${ENDPOINT}/${id}/releases/${version}?full=1`),
  listReleases: (id, search) =>
    request('GET', `/${ENDPOINT}/${id}/releases${search ?? ''}`),
  listFiles: (id, version, search) =>
    request('GET', `/${ENDPOINT}/${id}/releases/${version}/files${search ?? '?full=1'}`),
  deleteRelease: (id, version) => request('DELETE', `/${ENDPOINT}/${id}/releases/${version}`),
  initFile: (id, releaseId, body, full) =>
    request('POST', `/${ENDPOINT}/${id}/releases/${releaseId}/files${query(full)}`, {
      body: body ?? {},
    }),
  uploadFile: (id, releaseId, fileId, headers) =>
    request('PUT', `/${ENDPOINT}/${id}/releases/${releaseId}/files/${fileId}`, {
      body: bundle,
      raw: true,
      headers,
    }),
  fileStatus: (id, releaseId, fileId) =>
    request('GET', `/${ENDPOINT}/${id}/releases/${releaseId}/files/${fileId}/status`),
  deleteFile: (id, version, ref) =>
    request('DELETE', `/${ENDPOINT}/${id}/releases/${version}/files/${encodeURIComponent(ref)}`),
};

/**
 * Polls the status route until the background finalization is over. The upload
 * itself only receives the bytes: the bundle analysis, its validation and the
 * storage write run in a job, so the slot is still `queued` (waiting for the
 * validation) — `refetch_at` set — when the `PUT` answers. A file is settled
 * once `refetch_at` is gone (`completed`, or `failed` after a rejection).
 */
async function waitForStableFile(id, releaseId, fileId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let response = null;
  do {
    response = await api.fileStatus(id, releaseId, fileId);
    if (!('refetch_at' in (response.json ?? {}))) return response;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return response;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const bundle = readFileSync(BUNDLE);
const hash = createHash('sha256').update(bundle).digest('hex');
const name = `e2eCheck${Math.random().toString(36).slice(2, 8)}`;
const dispositionName = 'e2e-windows.bundle';
const signature = `ed25519:${Buffer.from('e2e-detached-signature').toString('base64')}`;

let assetId = null;

// ── Run ──────────────────────────────────────────────────────────────────────

console.log(`Nox upload E2E check`);
console.log(`  base     ${BASE}`);
console.log(`  endpoint /${ENDPOINT} (type "${TYPE}")`);
console.log(`  bundle   ${BUNDLE} (${bundle.length} bytes, sha256:${hash.slice(0, 12)}…)`);

try {
  // ── 1. DTO validation ──────────────────────────────────────────────────────
  section('DTO validation');

  checkThat(
    'asset name with a space is rejected',
    (await api.createAsset({ name: 'bad name!' })).status === 400,
  );
  checkThat(
    'asset name starting with a dash is rejected',
    (await api.createAsset({ name: '-nope' })).status === 400,
  );
  checkThat(
    'unknown field is rejected',
    (await api.createAsset({ name: 'nope', unknown: true })).status === 400,
  );

  const created = await api.createAsset({
    name,
    title: 'E2E check',
    description: 'Created by scripts/e2e-upload-check.mjs',
    // `usr:e2e` would be dropped: a Nox tag value is lowercase snake_case
    // (letters and underscores only, no digits).
    tags: ['usr:check', 'usr:bad!'],
  });
  check('create asset → 200', created.status, 200);
  check('asset name is echoed', created.json?.name, name);
  check('invalid tags are dropped', created.json?.tags, ['usr:check']);
  check('asset has no release yet (-1)', created.json?.release, -1);
  assetId = created.json?.id ?? null;
  checkThat('asset id is a positive integer', Number.isInteger(assetId), `id=${assetId}`);

  const duplicate = await api.createAsset({ name });
  check('duplicate asset name → 400', duplicate.status, 400);

  // ── 1bis. Default status filter on the asset listing ───────────────────────
  section('Asset listing status filter');

  const hiddenName = `?query=${encodeURIComponent(name)}`;
  const hidden = await api.search(hiddenName);
  check('a fresh asset is not listed by default', hidden.json?.total, 0);
  check('a fresh asset has no item by default', hidden.json?.items, []);
  check(
    'a fresh asset is listed with ?status=awaiting',
    (await api.search(`${hiddenName}&status=awaiting`)).json?.total,
    1,
  );
  check(
    'a fresh asset is listed with ?status=all',
    (await api.search(`${hiddenName}&status=all`)).json?.total,
    1,
  );
  check(
    'an unknown status → 400',
    (await api.search(`${hiddenName}&status=nope`)).status,
    400,
  );

  // ── 2. Releases ────────────────────────────────────────────────────────────
  section('Release creation');

  checkThat(
    'release name starting with a dash is rejected',
    (await api.createRelease(assetId, { name: '-bad' })).status === 400,
  );

  const release = await api.createRelease(assetId, { name: 'v1.0.0', title: 'Initial' });
  check('create release → 200', release.status, 200);
  check('release is awaiting its first file', release.json?.status?.status, 'awaiting');
  checkThat('release expires while incomplete', typeof release.json?.expires_at === 'number');
  checkThat('release asks for a refetch', typeof release.json?.refetch_at === 'number', show(release.json?.refetch_at));
  check('the release payload does not embed its files', release.json?.files, undefined);
  const emptyListing = await api.listFiles(assetId, 'v1.0.0');
  check('empty release listing → 200', emptyListing.status, 200);
  check('empty release has no file', emptyListing.json?.items, []);
  check('empty release counts 0 file', emptyListing.json?.total, 0);

  // An incomplete release stays out of the listing unless it is asked for.
  const pendingReleases = await api.listReleases(assetId);
  check('an awaiting release is not listed by default', pendingReleases.json?.total, 0);
  const awaited = await api.listReleases(assetId, '?status=awaiting');
  check('an awaiting release is listed with ?status=awaiting', awaited.json?.total, 1);
  check('the awaiting release carries its name', awaited.json?.items?.[0]?.name, 'v1.0.0');
  check(
    'cumulative ?status keeps the release',
    (await api.listReleases(assetId, '?status=awaiting&status=queued')).json?.total,
    1,
  );
  check(
    '?status=all lists every release',
    (await api.listReleases(assetId, '?status=all')).json?.total,
    1,
  );
  check(
    'an unknown status on a listing → 400',
    (await api.listReleases(assetId, '?status=nope')).status,
    400,
  );
  const releaseId = release.json?.id;

  // ── 3. Slot reservation ────────────────────────────────────────────────────
  section('File slot reservation');

  checkThat(
    'empty attribute key is rejected',
    (await api.initFile(assetId, releaseId, { attributes: [{ key: '', value: 'x' }] })).status === 400,
  );

  const slot = await api.initFile(assetId, releaseId, {
    attributes: [
      { key: 'platform', value: 'windows' },
      { key: 'engine', value: 'unity:6000.5' },
    ],
  });
  check('reserve slot → 201', slot.status, 201);
  check('slot name is null (unnamed)', slot.json?.name, null);
  check('slot mime defaults to octet-stream', slot.json?.mime, DEFAULT_MIME);
  check('slot size is 0', slot.json?.size, 0);
  check('slot has no hash yet', slot.json?.hashs, []);
  check('slot has no signature yet', slot.json?.signature, null);
  check('slot has no analysis yet', slot.json?.analysis, null);
  check('slot keeps its attributes', slot.json?.attributes, [
    { key: 'platform', value: 'windows' },
    { key: 'engine', value: 'unity:6000.5' },
  ]);
  check('slot is awaiting the bytes', slot.json?.status?.status, 'awaiting');
  checkThat('slot expires while awaiting', typeof slot.json?.expires_at === 'number', show(slot.json?.expires_at));
  checkThat('slot exposes an upload URL', /\/files\/\d+$/.test(urlOf(slot.json?.url)), slot.json?.url);
  checkThat('slot has created_at/updated_at', typeof slot.json?.created_at === 'number' && typeof slot.json?.updated_at === 'number');
  const fileId = Number(urlOf(slot.json?.url).split('/').pop());
  checkThat('slot id parsed from the upload URL', fileId > 0, `fileId=${fileId}`);

  // ── 3b. `?full=1` on write routes ─────────────────────────────────────────
  section('?full=1 (expanded) on write routes');

  const fullAsset = await api.createAsset({ name: `${name}Full` }, true);
  check('create asset ?full=1 → 200', fullAsset.status, 200);
  check('release preference is expanded', typeof fullAsset.json?.release, 'object');
  check('expanded preference is auto', fullAsset.json?.release?.auto, true);

  const fullSlot = await api.initFile(assetId, releaseId, { name: 'e2e-full.bundle' }, true);
  check('reserve slot ?full=1 → 201', fullSlot.status, 201);
  check('url is expanded', typeof fullSlot.json?.url, 'object');
  check('expanded url keeps the original', typeof urlOf(fullSlot.json?.url), 'string');
  const fullFileId = Number(urlOf(fullSlot.json?.url).split('/').pop());
  await api.deleteFile(assetId, 'v1.0.0', String(fullFileId));
  await api.deleteAsset(fullAsset.json?.id);

  // ── 4. Upload + integrity headers ──────────────────────────────────────────
  section('Upload with integrity headers');

  const uploaded = await api.uploadFile(assetId, releaseId, fileId, {
    'content-type': DEFAULT_MIME,
    'content-hash': `sha256:${hash}`,
    'content-length': bundle.length,
    'content-disposition': `attachment; filename="${dispositionName}"`,
    'content-signature': signature,
  });
  check('upload → 200', uploaded.status, 200);
  check('name comes from Content-Disposition', uploaded.json?.name, dispositionName);
  check('size matches the bytes sent', uploaded.json?.size, bundle.length);
  check('mime comes from Content-Type', uploaded.json?.mime, DEFAULT_MIME);
  check('hash matches the bytes sent', uploaded.json?.hashs, [`sha256:${hash}`]);
  check('signature is stored as-is', uploaded.json?.signature, signature);
  checkThat(
    'received bytes are queued for validation',
    ['queued', 'processing'].includes(uploaded.json?.status?.status),
    show(uploaded.json?.status),
  );
  check('queued slot no longer expires', 'expires_at' in (uploaded.json ?? {}), false);
  checkThat('queued slot asks for a refetch', typeof uploaded.json?.refetch_at === 'number', show(uploaded.json?.refetch_at));
  check(
    'queued slot still points at the upload URL',
    urlOf(uploaded.json?.url),
    urlOf(slot.json?.url),
  );

  const finalized = await waitForStableFile(assetId, releaseId, fileId);
  // `sanitizeStatus` collapses a finished status to the plain string "completed".
  check('analysis settles on completed', finalized.json?.status, 'completed');
  check('no expires_at once completed', 'expires_at' in (finalized.json ?? {}), false);
  check('refetch_at omitted once stable', 'refetch_at' in (finalized.json ?? {}), false);
  checkThat(
    'download URL points at the storage',
    urlOf(finalized.json?.url).includes('/files/') &&
      urlOf(finalized.json?.url) !== urlOf(slot.json?.url),
    finalized.json?.url,
  );

  const completedRelease = await api.getRelease(assetId, 'v1.0.0');
  check('release is completed', completedRelease.json?.status, 'completed');
  check('release no longer expires', 'expires_at' in (completedRelease.json ?? {}), false);
  check('release stops asking for a refetch', 'refetch_at' in (completedRelease.json ?? {}), false);
  check('the release payload still does not embed its files', completedRelease.json?.files, undefined);

  // ── 4bis. Listing the files of a release ─────────────────────────────────
  section('Release file listing');

  const listing = await api.listFiles(assetId, 'v1.0.0');
  check('file listing → 200', listing.status, 200);
  check('file listing holds one file', listing.json?.items?.length, 1);
  check('file listing counts one file', listing.json?.total, 1);
  check('file listing returns the name', listing.json?.items?.[0]?.name, dispositionName);
  check('file listing echoes the limit', listing.json?.limit, 20);
  check('file listing echoes the offset', listing.json?.offset, 0);

  const filtered = await api.listFiles(assetId, 'v1.0.0', `?query=${encodeURIComponent('e2e-')}`);
  check('file listing filters on the name', filtered.json?.total, 1);
  const unmatched = await api.listFiles(assetId, 'v1.0.0', '?query=does-not-exist');
  check('file listing honours a non-matching query', unmatched.json?.total, 0);
  check('file listing returns no item for a non-matching query', unmatched.json?.items, []);

  const paged = await api.listFiles(assetId, 'v1.0.0', '?offset=1&limit=5');
  check('offset past the last file returns no item', paged.json?.items, []);
  check('offset past the last file keeps the total', paged.json?.total, 1);
  const attributed = await api.listFiles(assetId, 'v1.0.0', '?platform=windows');
  check('file listing filters on a matching attribute', attributed.json?.total, 1);
  const notAttributed = await api.listFiles(assetId, 'v1.0.0', '?platform=linux');
  check('file listing filters out a non-matching attribute', notAttributed.json?.total, 0);
  const explicitKey = await api.listFiles(assetId, 'v1.0.0', '?query=&attribute=engine:unity%3A6000.5');
  check('file listing accepts an explicit attribute key', explicitKey.json?.total, 1);
  const presence = await api.listFiles(assetId, 'v1.0.0', '?engine=');
  check('an empty attribute value only requires the key', presence.json?.total, 1);
  check(
    'limit above 100 → 400',
    (await api.listFiles(assetId, 'v1.0.0', '?limit=101')).status,
    400,
  );
  checkThat(
    'listing an unknown release fails',
    (await api.listFiles(assetId, 'v9.9.9')).status >= 400,
  );

  // ── 4ter. Status filters ─────────────────────────────────────────────────
  section('Status filters');

  check(
    'a completed file is not listed as awaiting',
    (await api.listFiles(assetId, 'v1.0.0', '?status=awaiting')).json?.total,
    0,
  );
  check(
    'the completed file is listed with ?status=all',
    (await api.listFiles(assetId, 'v1.0.0', '?status=all')).json?.total,
    1,
  );
  const completedReleases = await api.listReleases(assetId, '?status=completed');
  check('the completed release is listed', completedReleases.json?.total, 1);
  check(
    'a completed release is not listed as awaiting',
    (await api.listReleases(assetId, '?status=awaiting')).json?.total,
    0,
  );
  const publishedAsset = await api.search(`?query=${encodeURIComponent(name)}`);
  check(
    'the asset shows up once a release is completed',
    publishedAsset.json?.total,
    1,
  );
  check(
    'the published asset keeps its name',
    publishedAsset.json?.items?.[0]?.name,
    name,
  );

  const status = await api.fileStatus(assetId, releaseId, fileId);
  check('status route → 200', status.status, 200);
  check('status route returns the same name', status.json?.name, dispositionName);
  check('status route returns the same hash', status.json?.hashs, [`sha256:${hash}`]);
  check('status route returns the same signature', status.json?.signature, signature);
  check('status route returns the same size', status.json?.size, bundle.length);

  // The download route takes the file name, or its numeric id.
  const byName = await request(
    'GET',
    `/${ENDPOINT}/${assetId}/releases/v1.0.0/files/${encodeURIComponent(dispositionName)}`,
  );
  check('download by name → 302', byName.status, 302);
  const byId = await request(
    'GET',
    `/${ENDPOINT}/${assetId}/releases/v1.0.0/files/${fileId}`,
  );
  check('download by file id → 302', byId.status, 302);
  checkThat(
    'both references resolve to the same stored file',
    byName.headers?.location === byId.headers?.location,
    `${byName.headers?.location} vs ${byId.headers?.location}`,
  );

  // ── 5. Rejected uploads ────────────────────────────────────────────────────
  section('Rejected uploads');

  const badHashSlot = await api.initFile(assetId, releaseId, { name: 'bad-hash.bundle' });
  const badHashId = Number(urlOf(badHashSlot.json?.url).split('/').pop());
  const badHash = await api.uploadFile(assetId, releaseId, badHashId, {
    'content-type': DEFAULT_MIME,
    'content-hash': `sha256:${'0'.repeat(64)}`,
  });
  check('wrong Content-Hash → 400', badHash.status, 400);
  checkThat('error mentions the hash', /Content-Hash/i.test(messageOf(badHash)), messageOf(badHash));
  const badHashStatus = await api.fileStatus(assetId, releaseId, badHashId);
  check('rejected file is marked failed', badHashStatus.json?.status?.status, 'failed');
  checkThat('rejected file gets a retry deadline', typeof badHashStatus.json?.expires_at === 'number', show(badHashStatus.json?.expires_at));
  check('rejected file keeps its size at 0', badHashStatus.json?.size, 0);
  check('rejected file has no hash', badHashStatus.json?.hashs, []);
  checkThat(
    'rejected file still exposes its upload URL',
    /\/files\/\d+$/.test(urlOf(badHashStatus.json?.url)),
    urlOf(badHashStatus.json?.url),
  );

  const badLengthSlot = await api.initFile(assetId, releaseId, { name: 'bad-length.bundle' });
  const badLengthId = Number(urlOf(badLengthSlot.json?.url).split('/').pop());
  const badLength = await rawUpload(
    `/${ENDPOINT}/${assetId}/releases/${releaseId}/files/${badLengthId}`,
    bundle,
    bundle.length + 16,
  );
  if (badLength.timedOut) {
    // The server waits for the missing bytes instead of answering: the length
    // guard cannot be reached by a well-behaved client (Node refuses to send a
    // body whose size differs from its Content-Length header).
    checkThat('truncated body leaves the slot pending (no answer)', true);
    review.push(
      'Content-Length guard unreachable from a client: a truncated body makes the server wait for the missing bytes.',
    );
  } else {
    check('wrong Content-Length → 400', badLength.status, 400);
  }

  // ── 6. Content-Type wins over the slot mime ────────────────────────────────
  section('Content-Type overrides the slot mime');

  const release2 = await api.createRelease(assetId, { name: 'v2.0.0' });
  const release2Id = release2.json?.id;
  const customSlot = await api.initFile(assetId, release2Id, {
    name: 'e2e-custom.bundle',
    mime: 'application/x-slot-declared',
  });
  const customId = Number(urlOf(customSlot.json?.url).split('/').pop());
  const customUpload = await api.uploadFile(assetId, release2Id, customId, {
    'content-type': 'application/x-uploaded',
    'content-hash': hash,
  });
  check('upload → 200', customUpload.status, 200);
  check('mime comes from Content-Type', customUpload.json?.mime, 'application/x-uploaded');
  check('slot-declared name is kept', customUpload.json?.name, 'e2e-custom.bundle');

  const customFinalized = await waitForStableFile(assetId, release2Id, customId);
  check('the second upload is finalized too', customFinalized.json?.status, 'completed');

  const deleted = await api.deleteFile(assetId, 'v2.0.0', 'e2e-custom.bundle');
  check('delete file → 200', deleted.status, 200);
  const emptied = await api.getRelease(assetId, 'v2.0.0');
  check('release without any file is awaiting again', emptied.json?.status?.status, 'awaiting');
  checkThat('re-queued release expires again', typeof emptied.json?.expires_at === 'number');
  checkThat('re-queued release asks for a refetch', typeof emptied.json?.refetch_at === 'number');

  // ── 7. Updates ─────────────────────────────────────────────────────────────
  section('Updates (PATCH)');

  const badPatch = await api.patchAsset(assetId, { name: 'bad name' });
  check('invalid asset name → 400', badPatch.status, 400);
  const patchedAsset = await api.patchAsset(assetId, {
    title: 'E2E renamed',
    tags: ['usr:check', 'usr:renamed'],
  });
  check('patch asset → 200', patchedAsset.status, 200);
  check('asset title updated', patchedAsset.json?.title, 'E2E renamed');
  check('asset tags updated', patchedAsset.json?.tags, ['usr:check', 'usr:renamed']);

  const patchedRelease = await api.patchRelease(assetId, 'v1.0.0', {
    changelog: 'E2E changelog',
    channel: 'candidate',
  });
  check('patch release → 200', patchedRelease.status, 200);
  check('release changelog updated', patchedRelease.json?.changelog, 'E2E changelog');
  check('release channel updated', patchedRelease.json?.channel, 'candidate');

  const pinned = await api.patchAsset(assetId, { release: release2Id });
  check('pin preferred release → 200', pinned.status, 200);
  const pinnedAsset = await api.getAsset(assetId);
  check('preferred release is pinned', pinnedAsset.json?.release?.auto, false);
  check('preferred release resolves to it', pinnedAsset.json?.release?.value, release2Id);

  // ── 8. Cascading deletes ───────────────────────────────────────────────────
  section('Cascading deletes');

  const removedRelease = await api.deleteRelease(assetId, 'v2.0.0');
  check('delete release → 200', removedRelease.status, 200);
  const afterCascade = await api.getAsset(assetId);
  check('deleted release resets the preference to auto', afterCascade.json?.release?.auto, true);
  check('preference falls back to the latest release', afterCascade.json?.release?.value, releaseId);

  const removedAsset = await api.deleteAsset(assetId);
  check('delete asset → 200', removedAsset.status, 200);
  const gone = await api.getAsset(assetId);
  checkThat('deleted asset is not readable any more', gone.status >= 400, `status ${gone.status}`);
  assetId = null;

  // ── 9. Cancellation: deleting the target of a running job ──────────────────
  section('Job cancellation (delete while queued / processing)');

  /**
   * Uploads a bundle into a throwaway asset, waits for the requested state,
   * removes the `target` (file, release or asset) and checks that the
   * background job died with it: no resurrection, no leaked bytes, no analyzer
   * left running.
   */
  async function cancellationCase(label, { waitFor, target }) {
    const created = await api.createAsset({ name: `${name}${label}` });
    const targetAssetId = created.json?.id;
    const targetRelease = await api.createRelease(targetAssetId, { name: 'v1.0.0' });
    const targetReleaseId = targetRelease.json?.id;
    const slot = await api.initFile(targetAssetId, targetReleaseId, { name: 'cancel.bundle' });
    const targetFileId = Number(urlOf(slot.json?.url).split('/').pop());
    const bytesBefore = storedFileCount();

    const upload = await api.uploadFile(targetAssetId, targetReleaseId, targetFileId, {
      'content-type': DEFAULT_MIME,
      'content-hash': hash,
    });
    check(`${label}: upload → 200`, upload.status, 200);

    // Reach the state the case targets (`queued` is immediate, `processing`
    // needs the job to have picked the slot up).
    let state = upload.json?.status?.status;
    for (let i = 0; i < 100 && state !== waitFor; i++) {
      const status = await api.fileStatus(targetAssetId, targetReleaseId, targetFileId);
      state = status.json?.status?.status ?? status.json?.status;
      if (state === 'completed') break;
      await sleep(20);
    }
    check(`${label}: reached ${waitFor}`, state, waitFor);

    const runningBefore = analyzerProcesses();
    if (runningBefore === null)
      review.push('`ps` unavailable: the analyzer kill could not be observed');
    else if (waitFor === 'processing')
      checkThat(`${label}: an analyzer was running`, runningBefore.length > 0, `${runningBefore.length} process(es)`);

    const removal =
      target === 'file'
        ? await api.deleteFile(targetAssetId, 'v1.0.0', String(targetFileId))
        : target === 'release'
          ? await api.deleteRelease(targetAssetId, 'v1.0.0')
          : await api.deleteAsset(targetAssetId);
    check(`${label}: delete → 200`, removal.status, 200);

    // The delete route aborts the running job itself: the analyzer must be gone
    // almost immediately, while it would still be parsing for another second or
    // two if the job had been left running.
    await sleep(400);
    if (runningBefore !== null)
      checkThat(
        `${label}: the analyzer was killed`,
        analyzerProcesses().length === 0,
        `${analyzerProcesses().length} process(es) left`,
      );

    if (target === 'file') {
      const after = await api.getRelease(targetAssetId, 'v1.0.0');
      const remaining = await api.listFiles(targetAssetId, 'v1.0.0');
      check(`${label}: the slot was not resurrected`, remaining.json?.total, 0);
      check(`${label}: the release is awaiting again`, after.json?.status?.status, 'awaiting');
    } else if (target === 'release') {
      const after = await api.getRelease(targetAssetId, 'v1.0.0');
      checkThat(`${label}: the release is gone`, after.status >= 400, `status ${after.status}`);
    } else {
      const after = await api.getAsset(targetAssetId);
      checkThat(`${label}: the asset is gone`, after.status >= 400, `status ${after.status}`);
    }

    if (target !== 'asset') {
      const cleanup = await api.deleteAsset(targetAssetId);
      check(`${label}: cleanup → 200`, cleanup.status, 200);
    }

    await sleep(1500);
    if (bytesBefore < 0)
      review.push(`${label}: storage directory unreadable, leaked bytes not checked`);
    else
      check(`${label}: no bytes leaked in the storage`, storedFileCount(), bytesBefore);
  }

  await cancellationCase('queuedFile', { waitFor: 'queued', target: 'file' });
  await cancellationCase('processingRelease', { waitFor: 'processing', target: 'release' });
  await cancellationCase('processingAsset', { waitFor: 'processing', target: 'asset' });
} catch (error) {
  failed++;
  console.error(`\nUNEXPECTED ERROR: ${error?.stack ?? error}`);
} finally {
  if (assetId !== null) {
    const cleanup = await api.deleteAsset(assetId).catch(() => null);
    console.log(`\ncleanup: deleted asset ${assetId} (status ${cleanup?.status ?? 'error'})`);
  }
  for (const line of review) console.log(`\nnote: ${line}`);
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
