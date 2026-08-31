# 0301 — `async` cannot be written on a method, and the refusal does not say so

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** `error: expected a type … found 'async'`, which reads as a syntax mistake

## Measured

```wac
struct Holder {
  Cli cli;
  async i32 sizeOf(this, string path) {
    FileResult f = await this.cli.readFile(path);
    return f.ok ? f.bytes.len() : 0 - 1;
  }
}
```

    error: expected a type
     --> mprobe.wac:5:3
      |
    5 |   async i32 sizeOf(this, string path) {
      |   ^^^^^ found 'async'
      = help: a type is a name like `i32`, `string`, or one this file declares

    error: a keyword cannot be used as a name

The parser is reading a member declaration and expecting a type, so `async` lands as a name. The
diagnostic is about *that* rather than about the feature, and its help line offers to accept a
type — which is advice that cannot be followed.

`spec/spec/async.md` says `async` is written "after any `export` and before the return type" and does
not mention members. Its **"What is not covered yet"** list has four entries and this is not one of
them, so a reader has no way to learn it short of trying.

## Why it matters more than it looks

`design/lang/0014` A6 and `issues/system/0294c` are a migration of servers from blocking loops to
`async`. The next one after `dird` is `packages/ssh/src/sshd.wac`, whose reads are unbounded — so it
is *not* blocked by `issues/lang/0300b` — and it reads through `Conn.readPacket`, used at eleven
sites, which calls `Conn.fill`. **Both are methods**, so the port stops here.

This is likely to be the common shape rather than a corner: a connection, a session or a link that
owns a socket is naturally a struct with read methods on it, and those are exactly the functions that
want to suspend. `packages/tor`'s `Link` and `packages/fs`'s `Chan` are the same.

## The workaround, and why it is not free

Turn the methods into free functions taking the receiver — `readPacket(Conn c)` for `c.readPacket()`.
Mechanical, and it works, but it is an API shape imposed on a package by a parser limitation, and it
has to be done to every type that reads. It also splits a type's interface across two spellings, so
the next reader cannot tell which methods are "the ones that could not be async".

## What would close it

`async` accepted in a member declaration, lowered exactly as it is for a free function — the receiver
is a parameter either way, so the machine that already survives a suspension over parameters should
need nothing new. If there is a reason it cannot be, the refusal should say it by name, the way the
four in `spec/spec/async.md` do, rather than arriving as *expected a type*.
