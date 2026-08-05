# wac

A C-family language for WebAssembly GC. See [README.md](README.md) for what
it is and [spec/](spec/) for the language definition.

To learn the language itself, read [spec/tour.wac](spec/tour.wac) first — the
whole of wac in one annotated file that compiles and self-tests. It is much
faster than reading `spec/spec/*.md`, and is the right starting point before
writing or reviewing any wac code.

Breaking changes are logged in `~/notes/living/wac/breaking-changes.md` — check there first if a
program that used to compile has stopped.

**Anyone may change the compiler.** It used to have one owner (agent-a) and a rule that
sent everyone else to [issues/](issues/) instead; that is no longer the case. If you are
building something *in* wac and hit a compiler bug or need a language feature, fixing it
is ordinary work.

File an issue when the blocker is a *decision* rather than the work — a change that would
make the shared test suite red for everyone, or one where two reasonable answers exist and
picking wrong is expensive to undo. A reproduction is still worth more than a patch when
you are not going to write the patch. Open issues are listed in
[issues/INDEX.md](issues/INDEX.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) before touching `atoms/wac/` — it
defines the atom rules, pure-TypeScript/cap conventions, and testing
discipline this codebase follows. Apply it to any change in that directory,
not just new features.
