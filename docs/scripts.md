# Scripts & Development

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Development mode with watch |
| `npm run build` | Compile TypeScript |
| `npm run start:prod` | Production mode |
| `npm run lint` | ESLint |
| `npx prisma migrate dev` | Apply DB migrations |
| `npx ts-node scripts/generate-openapi.ts` | Regenerate `_openapi.yaml` (git-ignored) |
| `cp _openapi.yaml ../docs/public/openapi.yaml` | Publish the spec to the docs site (this file **is** tracked, and the API reference is generated from it) |

## Tests

```bash
npm run lint        # ESLint check
npm run test        # Unit tests
npm run test:e2e    # End-to-end tests
```

## CLI — `noxcli`

`noxcli` is a dependency-free command-line companion **shipped in the image** as
`/usr/local/bin/noxcli`. It only talks HTTP to a running server: no database, no
config service, no credentials.

```bash
noxcli ready      # exit 0 when the server is up and ready
noxcli status     # identity, gateway, endpoints, uptime
noxcli version    # CLI / runtime / server versions
```

### `noxcli ready`

Readiness is content-based: it GETs `/.well-known/nox` (served at the root, so the API
prefix does not matter) and requires `status: "online"` **and** a complete document — a
200 on any route is not enough. The document is only built once the app modules,
database included, are initialized.

| Option | Description |
|---|---|
| `-u, --url <url>` | Base URL. Defaults to `$NOX_URL`, then `http://127.0.0.1:$HTTP_PORT` |
| `--prefix <path>` | API prefix used by `--deep`. Defaults to `$HTTP_PREFIX`, then `api` |
| `--path <path>` | Readiness path (default `/.well-known/nox`) |
| `-t, --timeout <d>` | Total budget (default `5s`; `500ms`, `5s`, `2m`, bare number = seconds) |
| `-i, --interval <d>` | Delay between two attempts (default `500ms`) |
| `-w, --wait` | Retry until ready — no timeout unless `--timeout` is given |
| `-d, --deep` | Also probe the API (`/configs`) to validate the database and the cache |
| `--json` | Machine-readable result (attempts, checks, reasons) |
| `-q, --quiet` | Print nothing; the exit code is the only output |
| `-v, --verbose` | Print every probe and every retry |

Exit codes: `0` ready · `1` not ready · `2` bad usage · `3` internal error.

### Inside a container

The image declares `HEALTHCHECK CMD noxcli ready --quiet --timeout 5s`, so
`docker ps` reports `(healthy)`:

```bash
docker exec nox.node noxcli ready --verbose
docker exec nox.node noxcli ready --deep    # is the database reachable too?
docker exec nox.node noxcli status
```

Waiting for a node that is still migrating, from another container or an entrypoint:

```bash
noxcli ready --url http://node:8080 --wait --timeout 5m
```

### From the repository

```bash
npm run build                        # produces dist/cli/noxcli.js
npm run noxcli -- ready --verbose    # run the built CLI
npm run noxcli:dev -- status         # same, without building (ts-node)
```
