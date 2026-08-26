# 0270a — a build differs by how its entry was spelled, so byte-identity is conditional on the command line

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-26
- **Kind:** bug
- **Symptom:** wrong answer — two builds of one source disagree, and nothing says why

## Measured

The same program, the same compiler, the same working directory, built twice — once naming the entry
relatively and once absolutely:

    cd /tmp/pathA
    wac build m.wac      -o rel     82,436 bytes
    wac build $PWD/m.wac -o abs     82,436 bytes
    cmp rel.wasm abs.wasm        →   differ at byte 63977

One byte, and it is in the `wac.manifest` section:

    "entry": "m.wac",
    "entry": "/tmp/pathA/m.wac",

**And it is not only the manifest.** A generic instantiated over a *user* type carries the defining
file's key in its symbol name:

    m_Map__core_map$string$Thing__lib_create          entry spelled relatively
    m_Map__core_map$string$Thing___tmp_pathA_lib      entry spelled absolutely

so an absolute entry moves the export section as well. Built from two different directories with
*relative* entries, the same source is byte-identical; with absolute ones it is not.

## Why it matters, and why nothing has noticed

Everything in this repository builds with a relative entry — `tools/seed.sh` has
`ENTRY=packages/wac/src/wac.wac`, and every test spells its fixture relatively. So the claims that rest
on byte-identity are all true today and all conditional on that:

- **the rung-5 fixpoint** — "the compiler the binary produces, used to build the compiler again, is
  byte-identical" — holds because both rounds spell the entry the same way, not because the property
  is about the source;
- **`wac build`'s cache** keys on the compiler, the sources, the grants and the output name
  (`issues/system/0204`); two spellings of one entry are two entries with one key's worth of
  difference between the artefacts;
- **`wac app`'s byte-identity across the three hosts**, measured on 2026-08-26, was measured with one
  spelling on all three.

None of those is wrong. Each is a narrower statement than it reads as.

## What the right answer probably is

**Normalise the key to the project root before it reaches the manifest or a symbol name.** The compiler
already computes the root each file sits in — `design/lang/0009` D7, threaded through
`covTableFilesIn` and the resolver — so the fact is in hand at the point the key is chosen. A key
relative to the project is the same for every caller, which is what makes the artefact a function of
the source.

**The manifest's `entry` is the easier half and the more debatable.** It records what was built, and
"what was built" arguably *is* the path the person typed. But a field whose value changes the artefact's
bytes without changing its behaviour is a field that breaks every comparison downstream of it, and
`wasmName` beside it is already a basename.

## What this is not

Not the `$bind$` names in a *host* boundary — those embed the path for the same reason and are
generated per program, so two programs having different glue is correct.

Not a difference between agents' checkouts as such: two agents building relatively from their own trees
get identical bytes, because the key is relative to the entry rather than to the filesystem. It is
absolute *spelling* that does it, not absolute *location*.

## How it was found

Following `wac audit`'s host comparison, where a Deno-hosted build and the native seed disagreed by
14,256 bytes in the export section and one byte in the manifest. The export difference was the
absolute-entry effect — `build.ts` was handed `$W/packages/wac/src/wac.wac` and `seed.sh` uses a
relative path — and it looked at first like a host divergence, which is what makes it worth writing
down: **a build that varies with its command line reads as a build that varies with its host.**
