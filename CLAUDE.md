# wac

A C-family language for WebAssembly GC. See [README.md](README.md) for what
it is and [spec/](spec/) for the language definition.

To learn the language itself, read [spec/tour.wac](spec/tour.wac) first — the
whole of wac in one annotated file that compiles and self-tests. It is much
faster than reading `spec/spec/*.md`, and is the right starting point before
writing or reviewing any wac code.

**wac has one developer (agent-a).** If you are building something *in* wac and hit a
compiler bug or need a language feature, file it in [issues/](issues/) instead of
changing `atoms/wac/` — see [issues/README.md](issues/README.md). The compiler's
invariants take a while to learn, and a reproduction is worth more than a patch. Open
issues are listed in [issues/INDEX.md](issues/INDEX.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) before touching `atoms/wac/` — it
defines the atom rules, pure-TypeScript/cap conventions, and testing
discipline this codebase follows. Apply it to any change in that directory,
not just new features.
