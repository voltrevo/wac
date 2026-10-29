#!/bin/sh
# Put each git import `wac.lock` pins into wac's package cache, with `git` rather than `wac update`.
#
#     sh tools/fill-cache.sh
#
# **Because `wac update` cannot authenticate.** git.voltrevo.com answers its fetcher 401, where `git`
# has credentials (a helper, or a proxy that adds them). A checkout already in the cache is left alone,
# so running this every time costs a directory lookup per import. The cache is `$WAC_HOME/cache/git`,
# `$HOME/.wac` by default — where `wac` looks for a locked dependency — one plain checkout per commit, the
# repository's URL escaped as `packages/wacpkg/src/cache.wac`'s `escapeRepo` does it.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cache="${WAC_HOME:-$HOME/.wac}/cache/git"

# One `<url> <commit>` per import; a repository two imports share is fetched once.
sed -n 's/.*"git": "\([^"]*\)".*"commit": "\([0-9a-f]\{40\}\)".*/\1 \2/p' "$root/wac.lock" | sort -u |
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
