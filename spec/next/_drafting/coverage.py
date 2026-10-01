#!/usr/bin/env python3
"""Generate spec/next/_drafting/COVERAGE.md: every section of every source, and where it goes.

Run from the repository root:  python3 spec/next/_drafting/coverage.py <proposals-dir>

A drafting aid, deleted when the spec is done. The point is that nothing can go missing quietly:
every heading in every source gets a row, and a row with no chapter is listed at the end.
"""
import os, re, sys
from collections import defaultdict

PROPOSALS = sys.argv[1] if len(sys.argv) > 1 else None

CHAPTERS = {
    "01": "1-programs/01-names-and-identity", "02": "1-programs/02-modules-and-imports",
    "03": "1-programs/03-namespaces", "04": "1-programs/04-packages",
    "05": "1-programs/05-reachability", "06": "1-programs/06-checking-a-project",
    "07": "1-programs/07-programs",
    "08": "2-types/08-primitives", "09": "2-types/09-numeric-literals",
    "10": "2-types/10-nullability", "11": "2-types/11-never-and-uninhabited",
    "12": "2-types/12-structs", "13": "2-types/13-enums", "14": "2-types/14-tuples",
    "15": "2-types/15-arrays", "16": "2-types/16-strings", "17": "2-types/17-const",
    "18": "2-types/18-unions", "19": "2-types/19-generics",
    "20": "2-types/20-functions-and-funcrefs", "21": "2-types/21-symbols",
    "22": "3-expressions/22-operators", "23": "3-expressions/23-interpolation-and-markup",
    "24": "3-expressions/24-casts", "25": "3-expressions/25-control-flow",
    "26": "3-expressions/26-errors-and-results",
    "27": "4-static/27-static-declarations", "28": "4-static/28-static-evaluation",
    "29": "4-static/29-static-dependencies", "30": "4-static/30-computed-types",
    "31": "4-static/31-static-control",
    "32": "5-inference/32-widening", "33": "5-inference/33-placeholders",
    "34": "5-inference/34-recursive-inference",
    "35": "6-concurrency/35-tickets-and-await", "36": "6-concurrency/36-coroutines-and-generators",
    "37": "7-library/37-core", "38": "7-library/38-vec", "39": "7-library/39-map-and-hash",
    "40": "7-library/40-option-and-result", "41": "7-library/41-read", "42": "7-library/42-buf",
    "43": "7-library/43-markup-types", "44": "7-library/44-std",
    "45": "8-tooling/45-cli", "46": "8-tooling/46-manifest-and-lock", "47": "8-tooling/47-testing",
    "48": "8-tooling/48-bindgen", "49": "8-tooling/49-audit",
    "A": "appendices/A-grammar", "B": "appendices/B-diagnostics",
    "CUT-wapy": "excluded: wapy", "CUT-impl": "excluded: implementation detail, not language",
    "CUT-hist": "excluded: history of the implementation",
}

# (source file basename, heading regex or None for the file default) -> chapter key.
# First match wins, so overrides come before the default for the same file.
RULES = [
    # ---- proposals ----
    ("01-symbols.md", None, "21"),
    ("02-symbol-dispatch.md", r"Interpolation|Markup|Imports preserve|Built-in conversions", "23"),
    ("02-symbol-dispatch.md", None, "22"),
    ("03-namespaces.md", None, "03"),
    ("04-static-evaluation.md", None, "28"),
    ("05-static-dependencies.md", r"two-pass generic", "19"),
    ("05-static-dependencies.md", None, "29"),
    ("06-early-tree-shaking.md", None, "05"),
    ("07-lazy-imports-and-project-checking.md", r"route|Namespace exports", "05"),
    ("07-lazy-imports-and-project-checking.md", None, "06"),
    ("10-spec-corrections.md", r"Positional", "12"),
    ("10-spec-corrections.md", r"numeric array", "15"),
    ("10-spec-corrections.md", r"file I/O", "44"),
    ("10-spec-corrections.md", r"Const receiver", "17"),
    ("10-spec-corrections.md", r"coroutine", "36"),
    ("10-spec-corrections.md", None, "CUT-hist"),
    ("11-package-entry-points.md", None, "04"),
    ("12-computed-type-bodies.md", None, "30"),
    ("13-static-declarations.md", None, "27"),
    ("14-type-widening-and-array-literals.md", None, "15"),
    ("15-number-literals-and-inference.md", r"User-defined operators", "22"),
    ("15-number-literals-and-inference.md", r"choose by range", "18"),
    ("15-number-literals-and-inference.md", None, "09"),
    ("16-widening-and-unions.md", r"Normalisation|Const and array", "18"),
    ("16-widening-and-unions.md", r"Null is never", "10"),
    ("16-widening-and-unions.md", None, "32"),
    ("17-inference-placeholders.md", None, "33"),
    ("18-recursive-inference.md", r"Recursion and never", "11"),
    ("18-recursive-inference.md", None, "34"),
    ("19-recursive-unions.md", None, "18"),
    ("20-const-permissions-in-unions.md", None, "18"),
    ("README.md#proposals", None, "CUT-hist"),
    # ---- spec/spec ----
    ("arrays.md", None, "15"), ("async.md", None, "35"), ("bindgen.md", None, "48"),
    ("buffer.md", None, "42"), ("casts.md", None, "24"),
    ("control.md", r"Hex literals", "08"), ("control.md", r"trap", "26"),
    ("control.md", None, "25"),
    ("enums.md", r"Result|try", "26"), ("enums.md", None, "13"),
    ("errors.md", r"Soundness", "26"), ("errors.md", None, "B"), ("funcrefs.md", None, "20"),
    ("functions.md", r"^Export", "07"), ("functions.md", r"shadows a function", "01"),
    ("functions.md", None, "20"),
    ("generics.md", None, "19"), ("grammar.md", None, "A"),
    ("imports.md", r"written type name|Same-name|Aliases preserve", "01"),
    ("imports.md", r"Name mangling|Import resolution", "CUT-impl"),
    ("imports.md", r"mapped specifier", "04"),
    ("imports.md", None, "02"),
    ("jsx.md", None, "23"),
    ("linkedlist.md", None, "12"),
    ("naming.md", None, "01"),
    ("operators.md", None, "22"), ("strings.md", None, "16"),
    ("structs.md", r"Exporting", "02"), ("structs.md", r"Deep const", "17"),
    ("structs.md", None, "12"),
    ("types.md", r"literals", "09"), ("types.md", r"Nullability", "10"),
    ("types.md", None, "08"),
    ("variables.md", r"Module-level", "27"), ("variables.md", r"Type inference", "33"),
    ("variables.md", None, "17"),
    ("wapy.md", None, "CUT-wapy"),
    # ---- spec/cli ----
    ("wac.md", None, "45"),
    # ---- vision ----
    ("TECHNICAL.md", r"verbatim|`@` on a name|quoted tag and a quoted name", "01"),
    ("TECHNICAL.md", r"Literal tags|hyphenated attribute", "23"),
    ("TECHNICAL.md", r"test names itself", "47"),
    ("TECHNICAL.md", r"Const through", "17"),
    ("TECHNICAL.md", r"[Mm]atch|arm|`default`|`matches`|nullable subject", "25"),
    ("TECHNICAL.md", r"never", "11"),
    ("TECHNICAL.md", r"`try`", "26"),
    ("TECHNICAL.md", r"Ticket\.any|`pop`|popped slot|Capacity", "38"),
    ("TECHNICAL.md", r"generator|coroutine|Step|machine|`for await`|Async is the same|nested pause|Three constructs", "36"),
    ("TECHNICAL.md", r"unawaited|`schedule`|continuation|drain|wait|await|[Tt]icket|boundary because", "35"),
    ("TECHNICAL.md", r"T\?\?|`\?\.`|`\?\?", "10"),
    ("TECHNICAL.md", r"[Pp]acked", "08"),
    ("TECHNICAL.md", r"constant condition|folded-away|`static_`|`static_if`|`static_for`", "31"),
    ("TECHNICAL.md", r"`static_match`", "31"),
    ("TECHNICAL.md", r"Type logic|`type\(", "30"),
    ("TECHNICAL.md", r"virtual|overridden|default|initialiser|[Bb]races|defaultless", "12"),
    ("TECHNICAL.md", r"[Tt]uple|variadic|`==` compares", "14"),
    ("TECHNICAL.md", r"`main`|hung|program", "07"),
    ("DECISIONS.md", r"`_`", "01"),
    ("DECISIONS.md", r"`default`|ternary|nullable subject", "25"),
    ("DECISIONS.md", r"[Pp]acked", "08"),
    ("DECISIONS.md", r"tuple", "14"),
    ("DECISIONS.md", r"hashable", "39"),
    ("IDIOMS.md", r"Imports name", "02"),
    ("IDIOMS.md", r"Ordinary code|caller supplies", "19"),
    ("IDIOMS.md", r"Iterate", "25"),
    ("IDIOMS.md", r"wait|turn", "35"),
    ("IDIOMS.md", r"stream", "41"),
    ("IDIOMS.md", r"several types", "18"),
    ("IDIOMS.md", r"might not be there|more than one absence", "10"),
    ("SHOWCASE.md", r"server|Authority", "07"),
    ("SHOWCASE.md", r"JavaScript", "48"),
    ("SHOWCASE.md", r"Markup", "23"),
    ("SHOWCASE.md", r"Const is deep", "17"),
    ("SHOWCASE.md", r"compiler is a library", "44"),
    ("SHOWCASE.md", r"iterator", "36"),
    ("SHOWCASE.md", r"ticket", "35"),
    ("SHOWCASE.md", r"failure", "26"),
    ("QUESTIONS.md", r"`wait`", "35"), ("QUESTIONS.md", r"`defer`", "25"),
    ("QUESTIONS.md", r"keyword", "01"), ("QUESTIONS.md", r"finished machine", "36"),
    ("QUESTIONS.md", r"`auto`", "33"), ("QUESTIONS.md", r"default type argument", "19"),
    ("QUESTIONS.md", r"number rendered", "23"),
    # ---- vision/spec example files ----
    ("values.wac", None, "08"), ("variables.wac", None, "17"), ("casts.wac", None, "24"),
    ("operators.wac", None, "22"), ("control.wac", None, "25"), ("functions.wac", None, "20"),
    ("funcrefs.wac", None, "20"), ("generics.wac", None, "19"), ("types.wac", None, "12"),
    ("naming.wac", None, "01"), ("nullable.wac", None, "10"), ("arrays.wac", None, "15"),
    ("strings.wac", None, "16"), ("tuples.wac", None, "14"), ("enums.wac", None, "13"),
    ("coretypes.wac", None, "37"), ("async.wac", None, "35"), ("typelogic.wac", None, "30"),
    ("markup.wac", None, "23"), ("imports.wac", None, "02"), ("bindgen.wac", None, "48"),
    ("program.wac", None, "07"), ("diagnostics.wac", None, "B"), ("examples.wac", None, "12"),
]

TAG = re.compile(r"\[§([a-z0-9-]+)\]")


def assign(base, heading):
    for f, rx, ch in RULES:
        if f != base:
            continue
        if rx is None or re.search(rx, heading):
            return ch
    return None


def md_sections(path, levels):
    """(heading, [tags]) for each heading of the given levels, tags counted until the next one."""
    out, cur, tags = [], "(preamble)", []
    pat = re.compile(r"^(#{%d,%d}) (.*)" % (min(levels), max(levels)))
    for line in open(path, encoding="utf-8"):
        m = pat.match(line)
        if m:
            out.append((cur, tags))
            cur, tags = m.group(2).strip(), []
            continue
        for t in TAG.findall(line):
            if t not in tags:
                tags.append(t)
    out.append((cur, tags))
    return [s for s in out if not (s[0] == "(preamble)" and not s[1])]


rows = []  # (chapter, source, heading, tags)


def add_md(path, label, levels, base=None):
    base = base or os.path.basename(path)
    for h, tags in md_sections(path, levels):
        rows.append((assign(base, h), label, h, tags))


if PROPOSALS:
    for f in sorted(os.listdir(PROPOSALS)):
        if f.endswith(".md"):
            base = "README.md#proposals" if f == "README.md" else f
            add_md(os.path.join(PROPOSALS, f), "proposal " + f, (1, 2), base)
for f in sorted(os.listdir("spec/spec")):
    if f.endswith(".md"):
        add_md(os.path.join("spec/spec", f), "spec/spec/" + f, (2, 3))
add_md("spec/cli/wac.md", "spec/cli/wac.md", (2, 3))
for f in ("TECHNICAL.md", "DECISIONS.md", "IDIOMS.md", "SHOWCASE.md", "QUESTIONS.md"):
    for h, tags in md_sections(os.path.join("vision", f), (2, 2)):
        rows.append((assign(f, h), "vision/" + f, h, tags))
for f in sorted(os.listdir("vision/spec")):
    if f.endswith(".wac"):
        rows.append((assign(f, ""), "vision/spec/" + f, "(whole file)", []))

by_ch = defaultdict(list)
for r in rows:
    by_ch[r[0]].append(r)


def order(k):
    if k is None:
        return (3, "")
    if k.startswith("CUT"):
        return (2, k)
    if k in ("A", "B"):
        return (1, k)
    return (0, k)


ntags = sum(len(r[3]) for r in rows)
out = ["# Coverage map", "",
       "Generated by `coverage.py` — do not edit by hand; change its rules and rerun.", "",
       "Every heading of every source, the chapter it goes to, and the clause tags under it. "
       "A tag listed here either reappears unchanged in its chapter (the rule is the same) or is "
       "replaced by a new one (the rule changed) — appendix E will record which.", "",
       f"**{len(rows)} sections, {ntags} tags.** Assignment is by section; a chapter may still move "
       "an individual paragraph when it is written.", ""]
for k in sorted(by_ch, key=order):
    title = "UNASSIGNED — a gap in the rules" if k is None else f"{k} — {CHAPTERS[k]}"
    out += [f"## {title}", "", "| source | section | tags |", "|---|---|---|"]
    for _, src, h, tags in by_ch[k]:
        t = " ".join(f"`{x}`" for x in tags) if tags else ""
        out.append(f"| {src} | {h.replace('|', '\\|')} | {t} |")
    out.append("")
missing = [CHAPTERS[k] for k in CHAPTERS if k not in by_ch and not k.startswith("CUT")]
out += ["## Chapters no source feeds", "",
        "Written from scratch or from the gaps list in DECISIONS.md.", ""]
out += [f"- {m}" for m in missing] + [""]
open("spec/next/_drafting/COVERAGE.md", "w").write("\n".join(out))
print(f"{len(rows)} sections, {ntags} tags; unassigned: {len(by_ch.get(None, []))}")
