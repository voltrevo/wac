#!/bin/sh
# Put each git import `wac.lock` pins into wac's package cache, with `git` rather than `wac update`.
#
#     sh tools/fill-cache.sh
#     sh tools/fill-cache.sh --list [lock]   # the `<url> <commit>` pairs it would fetch, and nothing else
#
# **Because `wac update` cannot authenticate.** git.voltrevo.com answers its fetcher 401, where `git`
# has credentials (a helper, or a proxy that adds them). A checkout already in the cache is left alone,
# so running this every time costs a directory lookup per import. The cache is `$WAC_HOME/cache/git`,
# `$HOME/.wac` by default — where `wac` looks for a locked dependency — one plain checkout per commit, the
# repository's URL escaped as `packages/wacpkg/src/cache.wac`'s `escapeRepo` does it.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cache="${WAC_HOME:-$HOME/.wac}/cache/git"
lock="$root/wac.lock"
list=""
if [ "${1:-}" = "--list" ]; then list=1; lock="${2:-$lock}"; fi

# **One `<url> <commit>` per import, whatever the lines.** This read each line for a `"git"` and then a
# `"commit"` on it, which only the hand-written lock here satisfies: `wac update` writes one key per line, so
# a lock it wrote filled nothing and exited 0, and two entries on one line filled the last, the `.*` being
# greedy (`issues/system/0374d`). So the file is one line first, each `{ … }` holding a `"git"` is an import
# — a lock's entries hold no braces of their own — and its two fields are read from it alone, in either
# order. An import with a `git` and no full commit is a lock `wac update` has not finished, said rather than
# skipped: skipping is how the first version passed while fetching nothing.
pairs=$(tr '\n' ' ' < "$lock" | grep -o '{[^{}]*"git"[^{}]*}' | while IFS= read -r entry; do
  url=$(printf '%s' "$entry" | sed -n 's/.*"git" *: *"\([^"]*\)".*/\1/p')
  commit=$(printf '%s' "$entry" | sed -n 's/.*"commit" *: *"\([0-9a-f]\{40\}\)".*/\1/p')
  if [ -z "$commit" ]; then
    echo "fill-cache: $lock: $url has no commit — run wac update to write one" >&2
    echo "-"
  else
    echo "$url $commit"
  fi
done)
if printf '%s\n' "$pairs" | grep -qx -- '-'; then exit 1; fi
if [ -n "$list" ]; then printf '%s\n' "$pairs" | sort -u | grep -v '^$' || true; exit 0; fi

# A repository two imports share is fetched once.
printf '%s\n' "$pairs" | grep -v '^$' | sort -u |
while read -r url commit; do
  escaped=$(printf '%s' "$url" | od -An -v -tx1 | tr -s ' \n' '  ' | {
    out=""
    for h in $(cat); do
      c=$(printf "\\$(printf '%03o' "0x$h")")
      case "$c" in
        [a-z0-9._-]) out="$out$c" ;;
        [A-Z]) out="$out!$(printf '%s' "$c" | tr 'A-Z' 'a-z')" ;;
        *) out="$out%$(printf '%s' "$h" | tr 'a-f' 'A-F')" ;;
      esac
    done
    printf '%s' "$out"
  })
  dest="$cache/$escaped/$commit"
  [ -f "$dest/pack.pack" ] && continue
  tmp=$(mktemp -d)
  git -C "$tmp" init -q
  git -C "$tmp" fetch -q --depth 1 "$url" "$commit"
  mkdir -p "$dest"
  git -C "$tmp" archive "$commit" | tar -x -C "$dest"
  touch "$dest/pack.pack"     # the cache's "this checkout is complete" marker
  rm -rf "$tmp"
  echo "fill-cache: $url $commit"
done
