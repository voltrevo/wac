# 0177 — `wac run` and `wac build` take grants on opposite sides, and getting `run` wrong is silent

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a grant flag becomes a program argument, with no error

`wac build` wants its grants **after** the entry file and `wac run` wants them **before** it. That
alone is a papercut. What makes it worth an issue is that the wrong order on `run` does not fail:
the flag is handed to the program as `argv[0]`, so the program runs **without the grant it asked
for** and with a bogus first argument, and whatever it says next is about the bogus argument.

## Reproduction

```sh
wac build packages/wacpkg/example/plan.wac --allow-read -o plan   # exit 0
wac build --allow-read packages/wacpkg/example/plan.wac -o plan   # exit 1

wac run --allow-read packages/wacpkg/example/plan.wac DIR         # works
wac run packages/wacpkg/example/plan.wac --allow-read DIR         # runs, without the grant
```

The last line prints

    wacplan: --allow-read/wac.json5 could not be read, so --allow-read is not a project

Expected: either the grant is recognised, or the run fails saying the flag is in the wrong place.

Actual: `--allow-read` is `argv[0]`. The program is doing exactly the right thing with the argument
it was given; nothing in the output suggests the command line was the problem.

It cost me two wrong attempts and a detour into "does `wac run` support `main(Core, Cli)` at all"
before I tried the other order — it does, which is the good news buried under this.

## Why it is not obviously "just use the right order"

A program may legitimately take `--allow-read` as its own argument, so `run` cannot simply scan the
whole line for grants. That is the argument for the current design, and it is a real one. But the
two commands then disagree about where a grant goes, and only one of them says so.

Three ways out, and the choice is the point of filing rather than fixing:

- **Accept grants on both sides of the entry for both commands**, and require `--` before program
  arguments. Clearest, and breaks any invocation that passes a `--allow-*` string positionally.
- **Keep the split and make the wrong order an error**: `run` refuses a leading argument that looks
  like a grant it knows, telling the caller to move it. Cheap, and still wrong for a program whose
  first argument is genuinely `--allow-read`.
- **Make `build` accept them before as well**, so at least the orders overlap rather than exclude.
  Smallest, and leaves the silent case exactly as it is.

The second and third together cover the papercut and the silent failure without breaking anything,
which is the combination I would pick — but it is a CLI contract, and `spec/cli/main.md` is where
it is written down.

## Not a defect, for the record

`spec/cli/main.md`'s `run` section documents calling a **named exported function** —
`wacx run math.wac gcd 48 18`. A `main(Core, Cli)` program runs too, with the arguments going to
the program. Both work; the spec only describes the first, which is part of why the wrong order
looked like "run cannot do this" rather than "the flag is in the wrong place".
