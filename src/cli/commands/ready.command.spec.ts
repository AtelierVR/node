import { parseArgs } from '../cli.args';
import { Output } from '../cli.output';
import { EXIT, type CommandContext, type ExitCode } from '../cli.types';
import { readyCommand, runReady } from './ready.command';

const DOCUMENT = {
  id: 'nox:9f0d',
  status: 'online',
  address: 'example.com',
  port: 8080,
  software: { name: 'nox', version: '0.2.0' },
  gateway: { api: 'https://example.com/api' },
  endpoints: { wellknown: 'https://example.com/.well-known/nox' },
  versions: { node: '22.20.0' },
};

const realFetch = globalThis.fetch;

function stubFetch(
  handler: (url: string) => Promise<Response> | Response,
): jest.Mock {
  const mock = jest.fn((input: string | URL) => handler(String(input)));
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** URLs the stubbed fetch was called with. */
function fetchUrls(mock: jest.Mock): string[] {
  return (mock.mock.calls as unknown as Array<[string]>).map((call) => call[0]);
}

function context(argv: string[], env: NodeJS.ProcessEnv = {}): CommandContext {
  return {
    args: parseArgs(argv, readyCommand.options),
    out: new Output({ quiet: true }),
    env,
  };
}

/** Runs `ready` with quiet output and a short budget. */
async function ready(
  argv: string[],
  env?: NodeJS.ProcessEnv,
): Promise<ExitCode> {
  return runReady(context(argv, env));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('noxcli ready', () => {
  it('exits 0 when the server reports itself online', async () => {
    const mock = stubFetch(() => jsonResponse(DOCUMENT));

    await expect(ready(['--url', 'http://nox'])).resolves.toBe(EXIT.OK);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(fetchUrls(mock)[0]).toBe('http://nox/.well-known/nox');
  });

  it('defaults to the local container port and honors the prefix for --deep', async () => {
    const mock = stubFetch((url) =>
      url.endsWith('/configs')
        ? jsonResponse({ regions: [] })
        : jsonResponse(DOCUMENT),
    );

    await expect(
      ready(['--deep'], { HTTP_PORT: '8081', HTTP_PREFIX: 'v1' }),
    ).resolves.toBe(EXIT.OK);

    expect(fetchUrls(mock)).toEqual([
      'http://127.0.0.1:8081/.well-known/nox',
      'http://127.0.0.1:8081/v1/configs',
    ]);
  });

  it('exits 1 when the node is not online', async () => {
    stubFetch(() => jsonResponse({ ...DOCUMENT, status: 'maintenance' }));

    await expect(
      ready([
        '--url',
        'http://nox',
        '--timeout',
        '200ms',
        '--interval',
        '50ms',
      ]),
    ).resolves.toBe(EXIT.NOT_READY);
  });

  it('exits 1 when the server is unreachable, after retrying', async () => {
    const mock = stubFetch(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );

    await expect(
      ready([
        '--url',
        'http://127.0.0.1:1',
        '--timeout',
        '300ms',
        '--interval',
        '50ms',
      ]),
    ).resolves.toBe(EXIT.NOT_READY);
    expect(mock.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps retrying with --wait until the server answers', async () => {
    let calls = 0;
    const mock = stubFetch(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error('connect ECONNREFUSED'));
      return jsonResponse(DOCUMENT);
    });

    await expect(
      ready(['--url', 'http://nox', '--wait', '--interval', '10ms']),
    ).resolves.toBe(EXIT.OK);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('fails the deep check when the API route answers something unexpected', async () => {
    stubFetch((url) =>
      url.endsWith('/configs')
        ? jsonResponse(['nope'])
        : jsonResponse(DOCUMENT),
    );

    await expect(
      ready([
        '--url',
        'http://nox',
        '--deep',
        '--timeout',
        '50ms',
        '--interval',
        '10ms',
      ]),
    ).resolves.toBe(EXIT.NOT_READY);
  });

  it('rejects an unknown option before probing anything', async () => {
    const mock = stubFetch(() => jsonResponse(DOCUMENT));

    await expect(ready(['--nope'])).rejects.toThrow(/Unknown option/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('reports the failure reasons in JSON mode', async () => {
    stubFetch(() => jsonResponse({ ...DOCUMENT, status: 'maintenance' }));

    const chunks: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string,
    ) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

    const code = await runReady({
      args: parseArgs(
        [
          '--url',
          'http://nox',
          '--json',
          '--timeout',
          '50ms',
          '--interval',
          '10ms',
        ],
        readyCommand.options,
      ),
      out: new Output(),
      env: {},
    });
    write.mockRestore();

    const payload = JSON.parse(chunks.join('')) as {
      ready: boolean;
      reasons: string[];
    };
    expect(code).toBe(EXIT.NOT_READY);
    expect(payload.ready).toBe(false);
    expect(payload.reasons[0]).toMatch(/status is "maintenance"/);
  });
});
