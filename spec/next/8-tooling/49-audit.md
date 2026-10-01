# 49 — Audit

`wac audit main.wac` answers which files in a program can reach the world, and through what — grouped by the
dependency each came from, because a reader chooses dependencies, not files.

```sh
$ wac audit main.wac
geometry (4 files): sealed
logger   (2 files): reaches — src/sink.wac (Sys)
./       (3 files): reaches — main.wac (Sys), src/net.wac (Socket, via Sys)
9 files read, 3 reach, 6 sealed
```

`[§wac-cli-audit-6pn3wtq]` `wac audit` reports, per dependency, whether any file in it can reach a host capability, and names
those files and the type that lets them. `--verbose` adds the file-by-file table.

## The answer is static

wac has no ambient authority ([07](../1-programs/07-programs.md)): every effect is reached through a `Sys`, or through a
value a `Sys` gave out ([44](../7-library/44-std.md)). A function not handed one cannot use one, whatever its body says. So
*what can this dependency touch* is a property of declared types, and a file can be cleared without reading its bodies.

```wac
// fragment — two files of the logger package
// ---- logger/src/sink.wac ----
import { Sys } from "std";

export struct Sink {
  Sys sys;                                     // a Sink holds the whole capability
  void write(const this, string line) { sys.log(line); }
}

// ---- logger/src/format.wac ----
import { Sink } from "./sink.wac";

export void report(Sink s, string what) {     // never names Sys, and still reaches
  s.write("[report] \{what}");
}
```

`[§wac-cli-audit-bearing-9km4txr]` A **bearing type** is `Sys`, a type `std` declares whose methods reach the host — `Listener`,
`Socket`, `Child` — or any type with a field, a variant payload or a method result whose type is bearing, to a fixpoint. A
file **reaches** if any declaration in it names a bearing type in a field, a parameter or a result; otherwise it is
**sealed**.

`Sink` is bearing because its field is, so `format.wac` reaches without ever writing `Sys`. The fixpoint is what catches it.

## One way sound

`[§wac-cli-audit-sound-3tq8mnp]` `sealed` is never wrong; `reaches` over-approximates. A file that takes a `Sys` only to pass it
on, or names a bearing type it never uses, is reported as reaching, because the unit is the type, not the use.

A tool that might clear a file that can act is worth nothing; one that names a file that cannot costs the reader a minute.

A type parameter bound to a bearing type only at a distant call site is not tracked: `Vec<Sys>` names `Sys` and is caught,
and a `T` is not. A generic container therefore reports as sealed, and the file that instantiates it with a bearing type
reports as reaching — which is where the authority actually comes in.

## Every report has a denominator

`[§wac-cli-audit-denominator-2wq7knx]` Every report says how many files it read, including when nothing reaches and including
when an internal bound was hit. A table cut short that says `sealed` about a file it ran out of room for is the one failure
the audit must not have.
