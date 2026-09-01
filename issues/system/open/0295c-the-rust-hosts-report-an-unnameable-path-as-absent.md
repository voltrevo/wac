# 0295 — both Rust hosts report an unnameable path as absent, and both fault tests agree it is fine

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — a file that is there is reported as not there, on the default host

## Reproduction

Make a file whose name is not valid UTF-8, which is ordinary on this filesystem:

```
$ bash -c 'printf hello > "$1/bad-$(printf "\xff")-name"' _ /tmp/d
$ bash -c 'cat "/tmp/d/bad-$(printf "\xff")-name"'
hello
```

Then ask `box` about it, built two ways from the same source:

| host | `ls` | `cat <the listed name>` | `stat <the listed name>` |
| --- | --- | --- | --- |
| Deno | `bad-<U+FFFD>-name` | `cat: …: **cannot be named on this host**` | `stat: cannot statx '…': **cannot be named on this host**` |
| native v8 | `bad-<U+FFFD>-name` | `cat: …: **No such file or directory**` | `stat: cannot statx '…': **No such file or directory**` |

Both hosts mangle the byte to U+FFFD identically when listing — that part is not the bug. The bug is what
each says about the path that mangling produces: one says the name cannot be expressed, the other says
there is nothing there.

## Why the wrong one is wrong

`issues/system/0065` exists because of this exact answer. Its test's header:

> until now every program said "No such file or directory" about it — which reads as *the caller got the
> name wrong* rather than *this runtime cannot express it*.

and, on `Stat` specifically:

> `test -e` answered *no* about a file that is there, silently and with status 1, which is an answer a
> script then acts on.

That was fixed for the JavaScript hosts and never reached the Rust ones — so it is live on the **default**
host, the one `wac app` artefacts run on and the one `./bootstrap.sh` installs.

## Where it is

`FAULT_NOT_REPRESENTABLE` is **6**. It is produced in `packages/platform/host/faults.ts` and named in
`std/platform.wac`. Neither Rust host has it:

    native/v8/src/main.rs:314   const FAULT_OTHER: i32 = 5;
    native/v8/src/main.rs:318   const FAULT_NOT_GRANTED: i32 = 7;
    native/src/main.rs:2775     const FAULT_OTHER: i32 = 5;
    native/src/main.rs:2777     const FAULT_NOT_GRANTED: i32 = 7;

Both jump 5 → 7. The category is not in their vocabulary, so such a path falls into `FAULT_NOT_FOUND`.

## Why two tests that exist for this both pass

The numbering exists **four** times — TypeScript, wac, and once per Rust host — and the two checks cover
different pairs:

- `packages/platform/test/faults_agree.test.ts` compares **TypeScript against wac**. Both have 6, so it
  passes. Its own header says the Rust copies are "a third and fourth copy … which this file does not
  reach and could not".
- `packages/platform/test/wac/hostfaults_test.wac` compares **the two Rust hosts against each other**, by
  reading both sources. Both are missing 6 *equally*, so they agree and it passes.

Nobody compares a JavaScript host's answer with a Rust host's on a case that produces the fault. A gap
present in both members of a pair is invisible to a test that only asks whether the pair matches — which
is the same shape as the fault-renumbering hole `faults_agree.test.ts` was written for, one level up.

## How it was found

Migrating `packages/box/test/unnameable.test.ts` from the self-contained `deno` build to `wac app`, under
`issues/system/0193`. Six tests went red, and the first reading was that the test's premise had dissolved —
that `bad-\xff-name` is unnameable "from Deno" and the native host simply does not have the problem. That
was wrong: the native host mangles the name the same way and then gives the worse answer about it.

The test is correct and stays on the Deno build until this is fixed. It is worth noting that it caught this
only because it went red; a test lifted onto a host that answers *less* precisely usually stays green.

## Not attempted here

Adding `FAULT_NOT_REPRESENTABLE` to both Rust hosts means deciding what produces it — on Linux a path is
bytes, so the "cannot be named" condition arises where a name that came *out* of `readDir` as U+FFFD is
passed back *in*, rather than from any error the OS returns. That is a real design question about where
the round trip is detected, and it belongs with whoever owns the host boundary.

## The design question is already answered, in the host that fixed it — agent-b, 2026-09-01

*"Not attempted here"* says adding the fault means deciding what produces it, and that where the
round trip is detected "is a real design question". It was decided when the JavaScript hosts were
fixed, and the rule is four lines in `packages/platform/host/faults.ts`:

```ts
export function faultOfPath(e: unknown, path: string): number {
  const fault = faultOf(e);
  if (fault !== FAULT_NOT_FOUND || !path.includes(REPLACEMENT)) return fault;
  return FAULT_NOT_REPRESENTABLE;
}
```

with the reasoning written above it: *"a `NotFound` for a path containing U+FFFD is almost certainly
a name the host could not express — because U+FFFD is what a lossy `readDir` produces, and a name
containing it round-trips only if the file really does have a replacement character in it. Checked
rather than assumed: if the path resolves, it is a real name and the fault stands as it was."*

So the detection point is **the failure**, not the call: a `NotFound` is reclassified when the path
carries the replacement character, and any path that resolves is left alone. Nothing needs deciding;
the Rust hosts need the same rule written twice more.

**What that makes it.** `fault_of(e: &std::io::Error) -> i32` in each host gains a path-aware
sibling — the constant is missing too, both jumping 5 → 7 — and the call sites that have a path in
hand switch to it. There are **11** `fault_of` calls in `native/v8/src/main.rs` and **16** in
`native/src/main.rs`; not all have a path (the socket ones do not), so each wants reading rather than
a sweep. `pathFailure` beside `faultOfPath` is the shape for how the category travels once it is
produced, and its comment says why it is a thrown value rather than a new parameter.

**And the test the issue asks for.** Both existing checks compare a pair that is equally wrong —
TypeScript against wac, and the two Rust hosts against each other. What is missing is a JavaScript
host's answer against a Rust host's *on a case that produces the fault*. `packages/box`'s
`unnameable.test.ts` already builds that case and is pinned to the Deno build for exactly this
reason, so the case exists and only the comparison does not.

Not implemented here: 27 call sites over two hosts and a new cross-host test is more than this note,
and it wants doing in one careful pass rather than at the end of a long one.
