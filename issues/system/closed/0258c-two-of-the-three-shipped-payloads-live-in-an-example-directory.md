# 0258c — two of the three shipped payloads live in an `example/` directory

- **Status:** closed — the payloads stopped being payloads, 2026-08-25
- **Reported by:** the operator, 2026-08-25 — surveyed and recorded by agent-c
- **Kind:** decision
- **Symptom:** none — a name that misleads a reader about what a file is for

The operator, on `packages/wac/example/wac.wac`:

> a point on style: `wac.wac` is the primary reason for the wac package, so it's not an example

That one is fixed — it is `packages/wac/src/wac.wac`. Asked to check whether other packages have the
same problem: **two did, and they were the other two things the binary ships.** `tools/seed.sh` now
reads:

    ENTRY=packages/wac/src/wac.wac                  the command
    SH_ENTRY=packages/box/example/boxsh.wac         `wac sh`          <- still an example
    UPDATE_ENTRY=packages/wacpkg/src/fetch.wac      `wac update`      <- moved, see below

A file compiled into the released binary is not an example of anything. Both are the *reason* their
side of the package exists — `fetch.wac` is what `wac update` **is**, and `boxsh.wac` is what `wac sh`
**is** — and a reader who opens `example/` is told the opposite.

**The fetcher moved the same day, for the better reason this issue said to wait for.** `0257c` step 4
needs the command to *import* it, and importing from an `example/` directory is the smell itself. So
it is `packages/wacpkg/src/fetch.wac`, its `main` is a four-line wrapper around a `fetchAll` the
command calls, and it moved once rather than twice. `plan.wac` stays in `example/`: it is an
inspection tool rather than something the binary ships, which is what that directory is for.

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
- Both are named in `tools/seed.sh`, `native/v8/build.rs`'s payload embedding, and the docs that
  describe the three payloads. The last of those matters more than the count: `issues/system/0257c` is
  about `sh` and `update` **stopping being separate payloads at all** and joining the one wac program.
  If that lands, these files move for a better reason and to a place that issue decides — and doing it
  now would be moving them twice.

**What was left was `boxsh.wac`, and the recommendation was to wait for `0257c` step 4.** That was
the right call, and it did not resolve the way this issue expected.

## Closed because the question dissolved — 2026-08-25

`0257c` step 4 landed: `wac sh` and `wac update` are dispatched inside the one `wac` program, and
`tools/seed.sh` builds one payload where it built three. So **nothing compiles `boxsh.wac` into the
released binary any more.** The complaint here was that "a file compiled into the released binary is
not an example of anything" — and it is no longer compiled into it. What still builds it is
`tools/wac/frontpage_test.wac`, which uses it to check that the website's own transcript reproduces,
and that is exactly what `example/` is for.

`fetch.wac` had already moved to `packages/wacpkg/src/`, for the better reason this issue said to wait
for: step 4 needed the command to *import* it, and importing from an `example/` directory is the smell
itself.

So the resolution is neither of the two options written above. The file did not move, and it did not
stay wrongly named — the thing that made the name wrong went away. **Worth keeping as a shape:** a
naming complaint that is downstream of a structural one is often better waited out than fixed, because
fixing it first would have meant moving the file twice and the second move would have been back.
