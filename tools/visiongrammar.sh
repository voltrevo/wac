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
#   - **Skip `vision/bench/`.** Those files are the one thing under `vision/` written in *today's*
#     language on purpose — they measure a proposal's cost with a struct standing in for the type
#     it proposes — so a tool asking where today's parser refuses vision syntax has nothing to say
#     about them, and the stale-spelling pass would be asking them to use spellings that do not
#     exist.
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

# **The seed is the instrument.** Every answer below comes from the compiler carried inside the
# binary as `native/v8/seed/wacc.wasm`, not from `packages/wacc/src`. A stale one does not fail — it
# answers as of whenever it was built — so this whole report can be confidently a few commits out of
# date with nothing looking wrong. That happened: `async` on a method was reported as a construct
# this syntax adds, for as long as the seed predated the commit that added it.
if ! "$WAC" test tools/wac/seedfresh_test.wac --allow-read --allow-run >/dev/null 2>&1; then
  echo "the seed is older than the sources it is built from — run ./bootstrap.sh --no-install" >&2
  echo "every measurement below would be as of whenever it was last built" >&2
  exit 3
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

raw=${1:-}

for f in $(find vision -name '*.wac' -not -path 'vision/bench/*' | sort); do
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

# ── Constructs nobody has accounted for: gone, and where it went ─────────────────────────────────
#
# This pass desugared every construct `vision/GRAMMAR.md` lists into the nearest thing today's
# parser accepts and parsed again, so whatever was *still* refused was something nobody had written
# down. It found three that way, all invisible before: `yield`, an enum variant with an unnamed
# payload, and inheriting from a generic instantiation — the last used five times and load-bearing
# for the whole ticket design.
#
# **`vision/GRAMMAR.ebnf` answers the same question directly**, and better. That file is the vision
# additions as productions, and `tools/specparse.ts` parses every file under `vision/` with it:
#
#     deno run --allow-read tools/specparse.ts vision
#
# A construct nobody has accounted for is exactly a construct that grammar has no rule for, so it
# comes back as a refusal naming a line and a token rather than as a diagnostic about whatever the
# desugaring turned it into. It also needs no rule maintained by hand per construct, and no canary:
# the desugarer needed one because a `sed` version of it once reported every file as accounted for
# while not running at all, and a grammar that stopped working would report forty-five refusals
# rather than none.
#
# So the pass and the desugarer are deleted rather than kept beside it — a backticked path to a
# deleted file is what the link guard refuses, which is why neither is named here. Two producers of
# one artefact is one producer too many, and the one that goes is the one whose answer has to be
# maintained.

# ── Whichever subject has moved since the rewrite was written ────────────────────────────────────
#
# A rewrite is only as honest as the thing it compares itself against, and four of them here were
# written against the *oldest* file in their area: `server` against a header saying "wac has no
# sockets", `stream` against a callback pair, `vision/core/ticket.wac` against a `wait` that has since
# grown D7's trap, and `std` against a capability layer that had learned to carry the scheduler.
# Each claimed something that had already landed.
#
# The check that caught all four is one `git log`, so it belongs here rather than in somebody's
# memory: if the real package has commits newer than the vision file, the comparison may be stale.
echo
echo "-- subjects that moved after the rewrite --"
moved=0
for vdir in vision/core vision/std vision/packages/*/; do
  name=$(basename "$vdir")
  case "$name" in
    core) real="core" ;;
    std)  real="std packages/platform" ;;
    *)    real="packages/$name" ;;
  esac
  # Skip a subject with no counterpart in the tree.
  have=""
  for r in $real; do [ -e "$r" ] && have="$have $r"; done
  [ -z "$have" ] && continue

  vwhen=$(git log -1 --format=%ct -- "$vdir" 2>/dev/null || echo 0)
  rwhen=$(git log -1 --format=%ct -- $have 2>/dev/null || echo 0)
  if [ -n "$vwhen" ] && [ -n "$rwhen" ] && [ "$rwhen" -gt "$vwhen" ] 2>/dev/null; then
    moved=$((moved + 1))
    printf '  %-22s %s moved %s after it\n' "$name" "$(echo $have | tr ' ' ',')" \
      "$(python3 -c "import sys;d=(int(sys.argv[1])-int(sys.argv[2]))//86400;print(f'{d}d')" "$rwhen" "$vwhen")"
  fi
done
# `none` today is the expected answer and is not evidence the check works: every vision file was
# edited more recently than its subject while this was being written. Verified against an older
# revision instead — `vision/packages/json`'s first commit against `packages/wacc`'s latest fires.
[ "$moved" = 0 ] && echo "  none (every vision file is newer than its subject)"

echo
# ── Spellings that parse and are still wrong ─────────────────────────────────────────────────────
#
# The first pass finds where vision is *ahead* of today's parser. It is structurally blind to where
# vision code is *behind* a vision decision: `else:` is a valid arm today and `DECISIONS.md`
# replaced it with `default:`, so nothing rejects it and nothing reported it until a human read the
# file. Same for a `trap("…")` that should be `trap "…";` and a `static` that is not a keyword.
#
# This is a list of spellings already known to be wrong, not a parser. It cannot find a *new* kind
# of mistake, which is the honest limit of it — the general instrument for that is reading
# `spec/spec/grammar.md`, and `vision/GRAMMAR.md` says so.
echo "-- spellings that parse and are still wrong --"
stale=0

# A hit inside backticks is a **quotation**, not a spelling in use.
#
# `vision/packages/gzip` quotes the shipped `gunzipStream(fn[Read()] read, fn[bool(u8[])] write)`
# three times, because quoting the code an argument is about is how every file in this directory is
# grounded — and all three came back asking to be rewritten as `fn<…>`, which would falsify the
# quotation. The three were the first hits this pass had ever produced, so its clean run had never
# been tested against a file that quotes the thing it is replacing.
#
# Each hit line therefore has its backtick spans removed and the pattern is re-tested against what
# is left. **A fenced example still counts** — lines inside a ```wac block carry no backticks of
# their own — which is the half worth keeping, because that is where vision code actually gets
# written inside a comment.
#
# Same judgement as the `scheduler` note at the end of this file: a check that fires on prose every
# run trains the reader to skip the section, which costs more than what it catches.
outsideTicks() {
  python3 -c 'import re,sys
pat = re.compile(sys.argv[1].replace("[[:space:]]", r"\s"))
for line in sys.stdin.read().splitlines():
    parts = line.split(":", 2)
    if len(parts) < 3: continue
    if pat.search(re.sub(r"`[^`]*`", "", parts[2])): print(line)
' "$1"
}

check() {   # pattern, what to write instead
  hits=$(grep -rn --include='*.wac' -E "$1" vision | outsideTicks "$1" || true)
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
