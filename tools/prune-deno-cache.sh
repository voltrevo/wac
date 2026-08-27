#!/usr/bin/env bash
# Delete Deno transpile-cache entries whose source file no longer exists.
#
# Deno caches transpiled output keyed by the source's absolute path. Every test run that builds a wac
# binary compiles into a fresh directory under /tmp, that directory is removed when the run ends, and
# the cache entry is not. So the cache grows by roughly a megabyte per build per run, for ever, and
# nothing prunes it.
#
# On 2026-08-05 that was 23 GB across 25,490 entries, of which **25,482 had no surviving source** —
# not a cold cache, unreachable garbage. Free space on the shared disk had gone from 6.4 GB to 1.9 GB
# in half an hour with three agents running suites. See 0068 for the underlying fix; this is the sweep,
# and it does not reduce the rate at which it refills.
#
# **`tools/runTests.wac` does this at the start of every full run**, so the usual reason to reach for
# this script — somebody noticing the disk — is gone. `deno run … tools/runTests.wac sweep` does it
# without running a suite, which is the case this script was kept for: a machine already too full to
# start one, where `wac task test` refuses before it would have swept.
#
# **That claim was false from 2026-08-12 to 2026-08-15 and this comment asserted it anyway.** The
# version in `runTests.wac` walked `gen/file/tmp` only — the two-level mistake described below, which
# this script had already made and fixed — so while it reported success every run, the growth had
# moved to `gen/file/<workspace>/.cache/stage` (0068's own fix put the staged builds there) and went
# untouched. Measured on 2026-08-15: 1.6 MB where it was looking, 17 GB where it was not, on a disk
# at 95%. Sweeping from the root recovered 15.8 GB in three seconds.
#
# The underlying fix is still `issues/system/0140`, 0068's successor, which says why that issue
# should not have been closed with this script: neither this nor `runTests.wac` reduces the rate at
# which the cache refills.
#
# Safe by construction: an entry is removed only when the path it was built from is gone, so a
# surviving entry can still be hit and a removed one never could. It is therefore safe to run while
# other agents are working — nothing they can still use is touched.
#
#   tools/prune-deno-cache.sh          # report only
#   tools/prune-deno-cache.sh --apply  # delete

set -euo pipefail

GEN="${DENO_DIR:-$HOME/.cache/deno}/gen/file"
apply=false
[[ "${1:-}" == "--apply" ]] && apply=true

if [[ ! -d "$GEN" ]]; then
  echo "no transpile cache at $GEN — nothing to do"
  exit 0
fi

# Every cached *file*, at whatever depth. An earlier version walked two levels and so only ever saw
# `gen/file/tmp/*` — the entries under `gen/file/home/...` sit five or six deep and were silently
# never considered, which is the failure mode where a cleanup tool reports success and does nothing.
orphans=0 kept=0 bytes=0
while IFS= read -r -d '' entry; do
  # `gen/file/<abs source path without its leading slash>`, plus `.js` for transpiled output.
  rel="${entry#"$GEN"/}"
  src="/${rel%.js}"
  if [[ -e "$src" ]]; then
    kept=$((kept + 1))
  else
    orphans=$((orphans + 1))
    bytes=$((bytes + $(stat -c %s -- "$entry" 2>/dev/null || echo 0)))
    $apply && rm -f -- "$entry"
  fi
done < <(find "$GEN" -type f -print0)

# Directories left empty by the above. `-depth` so children go before parents; `-empty` so nothing
# holding a live entry is touched.
$apply && find "$GEN" -mindepth 1 -type d -empty -delete 2>/dev/null || true

human=$((bytes / 1024 / 1024))
if $apply; then
  echo "removed $orphans orphaned entries (${human} MB), kept $kept still reachable"
else
  echo "$orphans orphaned entries (${human} MB), $kept still reachable — rerun with --apply to delete"
fi
