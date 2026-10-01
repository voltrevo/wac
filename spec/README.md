# spec

- **[next/](next/README.md)** — the definition of wac, written as examples. It is being implemented
  (`design/lang/0016`); [next/_drafting/STATUS.md](next/_drafting/STATUS.md) says which examples the
  compiler in this tree meets, and `packages/wacc/test/wac/specexamples_test.wac` holds every one that is
  met to staying met.
- **[tour.wac](tour.wac)** — the language as the compiler implements it today, in one annotated file that
  compiles, and whose `selfTest()` returns `true`.
- **[cases/](cases/)** — whole programs, each with its expected outcome, run by
  `packages/wacc/test/wac/cases_test.wac`: the regression corpus for bugs found and fixed.

spec/spec and spec/cli, the previous definition, were retired when `next/` became the target; appendix D
of `next/` says what became of each of their tags.
