# 0356a — four stale issue cross-references, and a fifth no mechanical check can see

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** a comment cites an issue about something else, and the caution it carries has expired

## The one found by reading

`packages/fmt/src/bigint.wac`, explaining its own name:

> Named `FixedBig` rather than `Big` to stay clear of `packages/bignum`, which is the general one.
> That is not only taste: two structs with the same name in one program compile to invalid wasm
> rather than to an error — see `issues/lang/closed/0006`.

`issues/lang/closed/0006` is *"break inside a match arm was not seen by the return checker"*.
`issues/system/0006` is *"streaming gzip is now representable"*. Neither is about struct names.

The issue meant is **`issues/lang/closed/0041` — "same struct name in two modules emits invalid
wasm"** — which is **closed**, fixed in `b090bc7`, and covered by `§wac-samename-struct-4jhq7wn`.

So the sentence is stale twice: the citation points at an unrelated issue, and the hazard it warns
about was fixed. The naming decision is still right for the taste reason the sentence opens with;
only the *"not only taste"* half has expired. Same shape as `packages/fmt/src/atof.wac`'s `bisect32`,
where a false reason sits above a conclusion that survives it — **a reader who acts on the reason
rather than the conclusion is the one who gets hurt.**

## The mechanical check, and what it found

Every `issues/<tree>[/<state>]/<number>` reference in `packages/*/src/*.wac` and `tools/**/*.wac`,
checked against the issue trees for three things: does the number exist, is it in the tree named, is
it in the state named.

**410 files, 856 citations, 852 good.** The discipline here is strong and that is the headline. Four
are wrong:

    packages/wacc/src/bindgen.wac:382    issues/system/0265c     — that number is in lang/open
    tools/docsOnly.wac:29                issues/lang/open/0235a  — it is closed
    tools/wac/docsonly_test.wac:85       issues/lang/open/0235a  — it is closed
    tools/wac/links_test.wac:603         issues/lang/open/0154   — it is closed

All four are one-word fixes. None is urgent; a reader following any of them lands somewhere real and
is briefly confused rather than misled.

## What the check cannot see, which is the point

**It does not find the `bigint.wac` case.** `issues/lang/closed/0006` exists, is in the tree it
names, and is in the state it names. It is simply *about something else*. Structural validity and
referential correctness are different properties, and only the first is a grep.

So: **four is a floor**, the class the check catches is the cheap one, and the class that actively
misleads a reader is the one that still needs a person. Worth stating because the natural reading of
"852 of 856 good" is that this is a solved problem, and the one defect that mattered is in the 852.

## The script

Twenty-five lines, no dependencies. Left here rather than added to `tools/` because whether this
should be a repo guard is a decision, not a chore — it would want a home beside
`tools/wac/links_test.wac`, which already walks every tracked file for a related class of rot, and
folding it in there is probably better than a new tool.

```python
import os, re, glob
os.chdir('/path/to/wac')
index = {}
for tree in ('lang', 'system'):
    for state in ('open', 'closed'):
        for f in glob.glob(f'issues/{tree}/{state}/*.md'):
            m = re.match(r'(\d{4}[a-z]?)-', os.path.basename(f))
            if m: index.setdefault(m.group(1), []).append((tree, state))
CITE = re.compile(r'issues/(lang|system)/(?:(open|closed)/)?(\d{4}[a-z]?)')
for path in sorted(glob.glob('packages/*/src/*.wac')) + sorted(glob.glob('tools/**/*.wac', recursive=True)):
    for lineno, line in enumerate(open(path, encoding='utf-8'), 1):
        for tree, state, num in (m.groups() for m in CITE.finditer(line)):
            got = index.get(num, [])
            if not got:                                   print(f'{path}:{lineno} {num} missing')
            elif not any(t == tree for t, _ in got):      print(f'{path}:{lineno} {num} wrong tree')
            elif state and not any(s == state for t, s in got if t == tree):
                                                          print(f'{path}:{lineno} {num} wrong state')
```

## Related

- `issues/lang/0354a` — stale *language* claims in comments, and the 38 in-place corrections across
  23 files that show the tree already polices them. This is the same rot in a form that is
  machine-checkable, which is why it is worth a separate number and a cheaper fix.
