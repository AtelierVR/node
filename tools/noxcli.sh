#!/bin/sh
# `noxcli` inside the *development* container.
#
# The dev stage never compiles anything: the sources are bind-mounted and
# compiled on the fly by `nest start --watch`, so this wrapper runs the compiled
# bundle as soon as it exists and falls back to executing the TypeScript sources
# with `tsx` (a dev dependency) while the first build is still running.
# The production image ships a plain symlink to the bundle instead.
set -e

BUNDLE=/app/dist/cli/noxcli.js
SOURCES=/app/src/cli/noxcli.ts
TSX=/app/node_modules/.bin/tsx

if [ -f "$BUNDLE" ]; then
    exec node "$BUNDLE" "$@"
fi

if [ -x "$TSX" ]; then
    exec "$TSX" "$SOURCES" "$@"
fi

echo "noxcli: neither $BUNDLE nor $TSX is available (run 'npm install' first)" >&2
exit 3
