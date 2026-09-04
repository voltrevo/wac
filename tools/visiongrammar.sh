#!/usr/bin/env bash
# What vision's syntax adds to today's, computed rather than remembered.
#
# Runs the *current* compiler's parser over every `.wac` under `vision/` and reports where it
# refuses. Each refusal is one place the proposed grammar differs from the one that exists, so the
# output is a diff of two grammars derived from code instead of from somebody's memory of what they
# wrote — and it is the specification for a parser that would accept vision.
#
# Two things it has to do to get a parse-stage answer:
#
#   - **Strip the imports.** `vision/` imports modules the compiler does not carry — its own
#     `vision/core/queue.wac` and the rest — and that fails during resolution, before parsing, so
#     the file's real syntax is never reached. Blanking the import lines gets past it.
#   - **Keep only parse-stage diagnostics.** Everything after the parser will complain about the
#     types the stripped imports took away, and none of that is about grammar.
#
# `…` in a body is this repository's convention for *elided, see the original* and is not a proposed
# construct. It is removed along with the imports, leaving `{ }`, because a lexical error is emitted
# before every parse error whatever line it is on — so filtering it out of the *output* is not
# enough, and one `…` anywhere in a file used to hide every grammar difference in it.
#
# **The first refusal per file is a lower bound and this cannot do better.** A parser stops at the
# first thing it cannot read, so one run reports one construct per file and says nothing about what
# is behind it. Blanking the offending line and running again — the obvious fix, and what a previous
# instrument here did successfully — does not work: the lines are inside struct bodies, so removing
# one breaks the body and every line after it is reported as a cascade. A complete enumeration is
# what a parser that *accepts* vision would give, which is the argument for writing one.
#
#     tools/visiongrammar.sh            # first refusal per file
#     tools/visiongrammar.sh --raw      # every diagnostic, unfiltered
set -euo pipefail

cd "$(dirname "$0")/.."
WAC=${WAC:-./native/v8/target/release/wac}
[ -x "$WAC" ] || { echo "no wac binary at $WAC — run ./bootstrap.sh" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

raw=${1:-}

for f in $(find vision -name '*.wac' | sort); do
  # Blank the imports rather than delete them, so reported line numbers still match the real file,
  # and take out the `…` so `{ … }` becomes an empty body the lexer accepts. Both have to go before
  # the parser is reached at all: an unresolved import aborts during resolution, and a lexical error
  # is emitted *before every parse error regardless of line*, so one `…` anywhere in a file hides
  # every grammar difference in it.
  sed -e 's/^import .*$//' -e 's/…//g' "$f" > "$work/one.wac"

  out=$("$WAC" build "$work/one.wac" -o "$work/out.wasm" --allow-read 2>&1 || true)

  if [ "$raw" = "--raw" ]; then
    printf '%s\n' "=== $f"
    printf '%s\n' "$out"
    continue
  fi

  # The parser's own refusals, and only the first — everything after it is cascade.
  first=$(printf '%s\n' "$out" \
    | grep -E "^(error: unexpected token|error: expected)" -A 5 \
    | grep -E "expected .*, found|found '" \
    | head -1 || true)

  if [ -n "$first" ]; then
    printf '%-46s %s\n' "$f" "$(echo "$first" | sed 's/^ *| *//')"
  fi
done

# ── Spellings that parse and are still wrong ─────────────────────────────────────────────────────
#
# The pass above finds where vision is *ahead* of today's parser. It is structurally blind to where
# vision code is *behind* a vision decision: `else:` is a valid arm today and `DECISIONS.md`
# replaced it with `default:`, so nothing rejects it and nothing reported it until a human read the
# file. Same for a `trap("…")` that should be `trap "…";` and a `static` that is not a keyword.
#
# This is a list of spellings already known to be wrong, not a parser. It cannot find a *new* kind
# of mistake, which is the honest limit of it — the general instrument for that is reading
# `spec/spec/grammar.md`, and `vision/GRAMMAR.md` says so.
echo
echo "-- spellings that parse and are still wrong --"
stale=0
check() {   # pattern, what to write instead
  hits=$(grep -rn --include='*.wac' -E "$1" vision || true)
  if [ -n "$hits" ]; then
    stale=1
    printf '%s\n' "$hits" | sed "s|^|  |; s|$| → $2|"
  fi
}
check '^[[:space:]]*else[[:space:]]*:'        'default: — DECISIONS.md, `_` is reserved for the payload wildcard'
check '^[[:space:]]*case [A-Za-z_]'           'drop `case` — vision arms name the shape directly'
check 'trap\('                                'trap "message"; — grammar.md has trap_stmt taking an expr'
check '(^|[^A-Za-z_])static '                 'nothing — a method with no `this` is already static'
check 'fn\['                                  'fn<…> — vision replaced the brackets'
check '\bOption<'                             'T? — `?` nests, so there is no Option'
check '\bPending<'                            'Ticket<'
# No check for `scheduler`. It was a keyword and is not one now, but the *word* is ordinary English
# in these files — "the scheduler in force where it was called" is prose about a concept, not a
# stale spelling. A check that fires on three comments every run trains the reader to skip the
# section, which costs more than the one spelling it would catch.
[ "$stale" = 0 ] && echo "  none"

exit 0
