import {
  describeWellKnown,
  evaluateWellKnown,
  httpGetJson,
  pick,
} from './cli.probe';

const DOCUMENT = {
  id: 'nox:9f0d',
  status: 'online',
  address: 'example.com',
  port: 8080,
  software: { name: 'nox', version: '0.2.0' },
  gateway: {
    web: 'https://example.com',
    api: 'https://example.com/api',
    ws: 'wss://example.com/api/ws',
  },
  endpoints: { wellknown: 'https://example.com/.well-known/nox' },
  versions: { node: '22.20.0', terms: '1.0' },
};

const realFetch = globalThis.fetch;

function stubFetch(handler: () => Promise<Response> | Response): jest.Mock {
  const mock = jest.fn(handler);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('evaluateWellKnown', () => {
  it('accepts a complete online document', () => {
    expect(evaluateWellKnown(DOCUMENT)).toEqual({
      ok: true,
      status: 'online',
      reasons: [],
    });
  });

  it('refuses a node that is not online', () => {
    const verdict = evaluateWellKnown({ ...DOCUMENT, status: 'maintenance' });

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([
      'status is "maintenance" (expected "online")',
    ]);
  });

  it('lists every missing field', () => {
    const { software, gateway, ...partial } = DOCUMENT;
    void software;
    void gateway;

    const verdict = evaluateWellKnown(partial);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toContain('missing software name');
    expect(verdict.reasons).toContain('missing gateway API URL');
  });

  it('refuses an empty body', () => {
    expect(evaluateWellKnown(null).reasons).toEqual(['empty response body']);
  });
});

describe('pick / describeWellKnown', () => {
  it('reads dotted paths', () => {
    expect(pick('software.version', DOCUMENT)).toBe('0.2.0');
    expect(pick('software.nope', DOCUMENT)).toBeUndefined();
    expect(pick('a.b.c', null)).toBeUndefined();
  });

  it('summarizes the document', () => {
    expect(describeWellKnown(DOCUMENT)).toBe(
      'status=online, nox 0.2.0, address=example.com',
    );
  });
});

describe('httpGetJson', () => {
  it('returns the parsed body', async () => {
    stubFetch(() => jsonResponse(DOCUMENT));

    const probe = await httpGetJson('http://x/.well-known/nox', 1_000);

    expect(probe.ok).toBe(true);
    expect(probe.status).toBe(200);
    expect(pick('id', probe.body)).toBe('nox:9f0d');
  });

  it('reports a non-JSON body instead of throwing', async () => {
    stubFetch(() => new Response('<html>oops</html>', { status: 200 }));

    const probe = await httpGetJson('http://x/', 1_000);

    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/invalid JSON response/);
  });

  it('reports an unreachable server', async () => {
    stubFetch(() => Promise.reject(new Error('fetch failed')));

    const probe = await httpGetJson('http://x/', 500);

    expect(probe.ok).toBe(false);
    expect(probe.status).toBeNull();
    expect(probe.error).toBe('fetch failed');
  });

  it('unwraps an AggregateError cause', async () => {
    const error = new Error('fetch failed');
    (error as { cause?: unknown }).cause = new Error(
      'connect ECONNREFUSED 127.0.0.1:8080',
    );
    stubFetch(() => Promise.reject(error));

    const probe = await httpGetJson('http://x/', 500);

    expect(probe.error).toBe('connect ECONNREFUSED 127.0.0.1:8080');
  });
});
