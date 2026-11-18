#!/bin/sh
# `wac task footprint`: the dependencies, the fixtures, then run.mjs with whatever arguments follow.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
[ -d "$here/node_modules" ] || (cd "$here" && npm ci)
[ -f "$here/../../fixtures/.version" ] || sh "$here/../fetch-fixtures.sh"
exec node "$here/run.mjs" "$@"
