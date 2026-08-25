# 0258c — two of the three shipped payloads live in an `example/` directory

- **Status:** open
- **Reported by:** the operator, 2026-08-25 — surveyed and recorded by agent-c
- **Kind:** decision
- **Symptom:** none — a name that misleads a reader about what a file is for

The operator, on `packages/wac/example/wac.wac`:

> a point on style: `wac.wac` is the primary reason for the wac package, so it's not an example

That one is fixed — it is `packages/wac/src/wac.wac`. Asked to check whether other packages have the
same problem: **two do, and they are the other two things the binary ships.** `tools/seed.sh`:

    ENTRY=packages/wac/src/wac.wac                  the command
    SH_ENTRY=packages/box/example/boxsh.wac         `wac sh`
    UPDATE_ENTRY=packages/wacpkg/example/fetch.wac  `wac update`

A file compiled into the released binary is not an example of anything. Both are the *reason* their
side of the package exists — `fetch.wac` is what `wac update` **is**, and `boxsh.wac` is what `wac sh`
**is** — and a reader who opens `example/` is told the opposite.

## The repository already has the convention, applied unevenly

    packages/box/src/box.wac      the multi-call binary; `example/` holds demos beside it
    packages/sh/src/sh.wac        the shell as a program
    packages/wac/src/wac.wac      the command, as of today

So `src/` for the thing the package is, `example/` for things that show it off, is already the rule in
three places. These two are the exceptions, and nothing distinguishes them except history.

## Not a mechanical move, which is why this is a decision and not a commit

`wac.wac` moved cheaply because its consumers were seven constants. These two are different:

- **`boxsh.wac` is in `packages/box`, and it is a shell** — while `packages/sh` exists and its own
  program is already `src/sh.wac`. So "move it to `src/`" has to answer *which package's* `src/`
  first, and that is a question about what box's shell is for relative to sh's.
- **`fetch.wac`'s sibling is `plan.wac`**, which really is an inspection tool rather than a shipped
  thing. Moving one and leaving the other splits a pair that reads as a pair today.
- Both are named in `tools/seed.sh`, `native/v8/build.rs`'s payload embedding, and the docs that
  describe the three payloads. The last of those matters more than the count: `issues/system/0257c` is
  about `sh` and `update` **stopping being separate payloads at all** and joining the one wac program.
  If that lands, these files move for a better reason and to a place that issue decides — and doing it
  now would be moving them twice.

**Recommendation: wait for `0257c` step 4.** The names are wrong today and the cost of them being
wrong is a reader's minute; the cost of moving twice is two rounds of repointing a build. If `0257c`
stalls, move them then — the shape to copy is `packages/box/src/box.wac`.
