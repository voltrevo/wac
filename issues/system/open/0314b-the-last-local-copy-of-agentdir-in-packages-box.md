# 0314b — the last local copy of `agentDir`, in `packages/box`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** not a failure today — a duplicate of a shared helper, left where I should not edit

## What

`packages/wactest/src/host.wac` exports `agentDir`, and its header says why it exists:

> Ten test files had answered them with the same twenty lines copied verbatim — byte-identical,
> which is what makes it worth having once rather than a difference worth preserving.

Twenty-one files still carried their own copy. Twenty of them now import the export instead;
`packages/box/test/wac/frontpage_test.wac` is the twenty-first and is left alone, because
`packages/box` is another agent's working area.

The change is the same one made twenty times:

```wac
import { agentDir } from "../../../wactest/src/host.wac";
```

and delete the local `agentDir` together with its doc-comment line.

## Why it is worth doing rather than leaving

All twenty-two copies were **byte-identical** when this was filed — checked by hashing each body,
so there is no behavioural difference to preserve and no bug to fix today. That is the point: it is
the state `dirOf` was in before it drifted. Five copies of *that* helper had reached four different
answers for a path at the filesystem root, none of them reachable from its own call sites, and
nobody noticed because copies only ever diverge where the author had no use case.

What makes this one worth more than tidiness is what `agentDir` decides. `host.wac`'s header again:

> Several agents share this filesystem, which is the whole reason `scratch` takes a name and stirs
> the agent into it. Two agents running the same test at the same time against one fixed `/tmp`
> path do not fail: they interleave, and the one whose file was overwritten reports a mismatch in
> whatever it was actually testing. That is the worst kind of red — a true failure message about
> the wrong thing.

A copy that drifts into returning `""` gives its file a scratch path with no agent in it, and the
failure that produces is a real assertion failing about the wrong subject in a *different* agent's
run. So the cost of the drift is paid by whoever is unlucky, not by whoever wrote the copy.

## Notes

Nothing here is urgent and nothing is red. Filed rather than fixed only because of the directory
it is in — see `CLAUDE.md`, *"file something when it crosses a line you should not cross yourself:
a package or file someone else is working in"*.

The twenty that were done are in the commit that adds this file, so `grep -rl "^string agentDir("`
returning exactly one path is the check that this is finished.

## `agentDir` is the largest of a class, and the rest is not filed as work

Measured while doing the twenty, by parsing every top-level function in `packages/`, `core/`,
`std/` and `tools/`, hashing each body with whitespace stripped, and keeping only the private
definitions whose hash equals that of a function **exported somewhere else**:

**37 names, 105 byte-identical duplicate definitions.** `agentDir` is 21 of them. The tail is
`joinedWith` 9, `trimmed` 6 and 5 (two different bodies under one name), `sameBytes` 6, `has` 6,
`objectOf` 5, then a long run of ones and twos.

Deliberately **not** filed as a sweep, for two reasons. Several of the exporters are themselves test
helpers or probes — `rung3_probe.wac`, `source_probe.wac`, `cases.wac` — where a copy that does not
depend on the thing it probes is the point rather than an oversight; `packages/wacc/test/wac/source_probe.wac`
keeps its own `dirOf` for exactly that reason. And the counts are small enough per name that each is
a judgement about that helper rather than one mechanical change.

The number is recorded here so it is findable, not as a claim that 105 edits are wanted.
