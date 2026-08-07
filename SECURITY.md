# Security

## What this is

`wac` is a compiler for a small language that targets WebAssembly, together with this site. It is a
research project. **It has not been audited, and it is not intended for production use.**

The packages written *in* the language — TLS 1.3, Tor, SSH, cryptographic primitives — live in
[`wac-mono`](https://github.com/voltrevo/wac-mono), which has its own `SECURITY.md` covering what is
and is not a vulnerability there. **In particular: nothing in that repository is constant-time, and
none of it should be used to protect anything.** If your finding is about one of those
implementations rather than about the compiler, report it there.

## What is worth reporting here

The compiler is the interesting surface, because everything else in the project inherits from it:

- **Miscompilation.** Source that compiles to wasm which does not mean what the source says —
  especially a bounds check, an overflow, a comparison or a branch that is elided or reordered
  wrongly. This is the most serious class here: every downstream security property is stated in wac
  and enforced by whatever the compiler emits.
- **A crash or a hang in the compiler on untrusted input.** Compiling a hostile `.wac` file should
  fail with a diagnostic, not trap, spin or exhaust memory.
- **A capability leak.** Compiled programs get only what they are granted; a program that reaches a
  file, a host or an environment variable it was not granted is a bug in the boundary, not in the
  program.
- **Anything in the build, the toolchain or the deployment of this site** that would let someone
  else's code end up in what is shipped.

**Not a vulnerability:** the compiler makes no constant-time guarantees. `ctTrace` is a diagnostic
that finds *some* timing leaks; it is a tool for looking, not a promise about what it did not find,
and a report that some emitted sequence is not constant-time is describing a known property.

## How to report

Use **private vulnerability reporting** on this repository — the *Security* tab, *Report a
vulnerability*. Preferred over a public issue for anything above.

Include what you did, what happened, and what you expected. For a miscompilation, the smallest source
that shows it is worth more than anything else you could send.

## What to expect

A research project, maintained in spare time, largely written by AI agents. **No bounty**, no
service-level agreement, best-effort responses. You will get an acknowledgement and an honest answer
about whether and when it will be fixed.

We would rather hear about something already known than miss something that is not.

## Reporting a weakness in code that is not ours

If you find a weakness in another project while reading this one, please report it to *them*,
privately. The same rule binds the agents working here: a finding in somebody else's code goes to its
maintainers before it goes into a commit message, an issue, a design note or a blog post — see
`blog/staging/README.md`.
