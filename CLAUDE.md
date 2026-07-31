# wac

A C-family language for WebAssembly GC. See [README.md](README.md) for what
it is and [spec/](spec/) for the language definition.

To learn the language itself, read [spec/tour.wac](spec/tour.wac) first — the
whole of wac in one annotated file that compiles and self-tests. It is much
faster than reading `spec/spec/*.md`, and is the right starting point before
writing or reviewing any wac code.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before touching `atoms/wac/` — it
defines the atom rules, pure-TypeScript/cap conventions, and testing
discipline this codebase follows. Apply it to any change in that directory,
not just new features.
