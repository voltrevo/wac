#!/bin/sh
# Fetch what is pinned on GitHub from git.voltrevo.com, where development happens.
#
#     sh tools/use-mirror.sh
#
# **Every pin names GitHub** (`https://github.com/voltrevo/<repo>.git`), which is where these repositories are
# public and where a GitHub Actions run fetches them. git.voltrevo.com holds the same commits, and holds them first:
# a commit is pushed there, and to GitHub when the owner syncs. So a checkout working ahead of GitHub fetches
# GitHub's URLs from git.voltrevo.com — one git setting, which every `git` fetch obeys (`tools/fill-cache.sh`, a
# clone, wac's gate), while wac's package cache stays keyed by the URL as pinned. A push is not affected: each
# repository's `origin` names git.voltrevo.com itself.
#
# The same script is in each of wac, wac-web, wac-ide and wac-desktop. `--unset` takes the setting away.
set -eu
key='url.https://git.voltrevo.com/.insteadOf'
if [ "${1:-}" = "--unset" ]; then
  git config --global --unset-all "$key" 'https://github.com/voltrevo/' || true
  echo "use-mirror: GitHub's URLs are fetched from GitHub again"
  exit 0
fi
git config --global --replace-all "$key" 'https://github.com/voltrevo/' 'https://github.com/voltrevo/'
echo "use-mirror: https://github.com/voltrevo/* is fetched from https://git.voltrevo.com/*"
