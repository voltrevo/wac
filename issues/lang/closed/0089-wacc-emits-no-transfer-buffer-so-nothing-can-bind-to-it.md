# 0089 — wacc emits no transfer buffer, so nothing that passes bytes can bind to it

- **Status:** closed — fixed 2026-08-11 by agent-b
- **Fixed in:** the commit adding the instance method exports
- **Claimed by:** agent-b, 2026-08-10
- **Reported by:** agent-b
- **Date:** 2026-08-10
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

Run any package's tests against a module `wacc` compiled, which
`harness/wacBind.ts` will now do on request:

```sh
WAC_WASM_FROM=wacc deno test -A packages/fmt/test/
```

Expected: the tests pass, as they do against the reference-built module.

Actual:

```
TypeError: $exports.$bind$mem_ensure is not a function
    at _memEnsure (.cache/bind/….gen.ts:12:26)
```

## Notes

`wacBindgen` generates JS that reaches wasm memory through two exports the module
is expected to provide:

- `$bind$mem` — the `WebAssembly.Memory` the staging buffer lives in;
- `$bind$mem_ensure(bytes) -> i32` — grow that buffer to hold `bytes` and answer its
  new size, after which the caller re-reads `memory.buffer` because growing detaches
  the old one.

The reference builds both in `wasmBuildBin.ts` (`makeMemEnsure`, and the export named
at line 2265). `packages/wacc/src/emit.wac` contains no `$bind$mem` at all, so every
exported signature that carries a `u8[]` or a `string` across the boundary has glue
waiting for a function that is not there.

**This is what stands between wacc and being usable by this repository**, and it is
one bounded feature rather than a long tail: a linear memory, a growth helper, and the
two exports. It is independent of the type checker, which is where the recent work has
been.

**Six of the 33 packages already pass their own suites on wacc-emitted code** — `bytes`,
`ethrpc`, `rlp`, `std`, `tty`, and `tor` with 305 tests — because their exports do not
need the buffer. So the emitter is right about a great deal more than this issue makes
it sound.

Of the 27 that fail, **22 are this one feature**: 21 want `$bind$mem_ensure` and one
wants `$bind$str_len`. The rest are separate: `sh` hits `untyped member`, which is an
emitter gap `corpusEmit` already counts, and a few fail on answers rather than binding.

## Done so far — 2026-08-10, agent-b

`$bind$mem` and `$bind$mem_ensure` are emitted. wacc now writes a memory section (one
page, grown on demand) and one synthetic helper, and every package that used to stop at
`$bind$mem_ensure` now stops at the *next* helper instead.

Two things that were not obvious from outside:

- The signature has to be registered in the pre-pass beside the string helpers'. Asking
  for it while emitting grows the type table after the type section was sized, and the
  emitter declines the module rather than emit a lie — an eight-byte module is what that
  looks like.
- The start function is emitted last and numbered by hand, so inserting a helper in front
  of it without moving its index gives *"invalid start func reference"*.

## The `u8[]` family — 2026-08-10, agent-b

`$bind$arr_u8_len`, `_to_mem` and `_from_mem` are emitted too, and the measurement went from
**6 of 33 packages to 16 of 33 (743 tests)**.

Two things to know before writing the next element type:

- **`array.get` is not what a packed array wants.** `u8[]` is `i8` underneath, so it is
  `array.get_u` (0xFB 0x0D) and wasm says so by name — *"Array type 0 has type i8. Use
  array.get_s or array.get_u instead"*.
- **A `u8[]` that appears only in a signature is registered late.** `export u8[] echo(u8[] b)`
  has no `u8[]` in the array table until the pass that walks declarations for the types they
  name, so anything asking earlier answers no for exactly the modules a host most wants to
  call. Deciding whether to emit the family has to come after that pass.

There is no bulk instruction between a WasmGC array and linear memory, so both directions are
a byte-at-a-time loop rather than an `array.copy`.

**What is left**, from the sweep's own tally:

    5  $bind$arr_i32_len          the same three helpers, element type i32
    2  $bind$arr_i32_from_mem
    2  $bind$arr_u8Arr_new        an array of arrays
    2  $bind$sm_Fs_inMemory       struct methods
    2  $bind$fnref_0              a callback signature
    1  $bind$str_len              the string family
    1  untyped member             an emitter gap corpusEmit already counts
    2  wrong answer               not a missing helper — the module ran and disagreed

The `i32` family is the same code with a different width, load and store, and would be the
cheapest next step. **The two wrong answers are the interesting ones**: they are what the
whole exercise was for, and no amount of well-formedness checking would have found them.

Re-measure with `deno run -A packages/wacc/tools/runOnWacc.ts`.

## Everything but one name — 2026-08-11, agent-b

The families are done: memory, every array element type (with `_new`/`_get`/`_set`/`_len`, and
`_new0` where the element is a `string`), structs, enums, strings, methods and statics, and callbacks
through an import section (`issues/lang/0094`). The tally:

    30 of 34 packages pass their own suite on wacc-emitted code (1,391 tests)
    why the rest do not:
        2  $bind$sm_Vec__packages_std_src_vec$string_create                       (box, fs)
        1  $bind$m_Vec__packages_std_src_vec$IndexEntry__packages_git_src_index_len  (git)
        1  a static Shell.capturing, declined                                     (sh)

**What is left is one name, and it is two features rather than one.**

`box`, `fs` and `git` call a method or a static on a *generic instance*, and the glue asks for it under the reference's
spelling: `bindName("Vec__packages_std_src_vec<string>")`. Two things stand between wacc and that:

1. **The methods of an instance are not exported at all.** `bindMethodExports` walks declarations and
   skips anything generic, because an instance's methods are emitted from a substitution rather than
   from a declaration. They would need collecting from `env.instName`/`instOf` instead.
2. **wacc does not spell an instance the way the reference does.** The reference qualifies a template
   by its declaring file — `fileTag(path)` is the path minus `.wac` with every non-alphanumeric
   replaced by `_` — and wacc keys a shadowed name as `Vec@<fileno>` instead. The *paths* do not
   reach the emitter at all: `emitLinked` hands `emitModuleOf` a blob plus line boundaries, so
   `Env.fileOf(line)` knows which file a declaration came from and nothing knows what it was called.

So the work is: carry the ordered paths into `Env`, add the reference's `fileTag` spelling for
instances, and export an instance's methods from the instance tables. None of it is deep; it is three
places that have to agree, and getting the mangling wrong leaves the helper as invisible as it is now.

Worth saying: **this is the only remaining blocker that is a *name*.** Everything else in the tally is
an emitter decline with its own reason.

## Closed — 2026-08-11, agent-b

The last name is emitted:

    $bind$sm_Vec__packages_std_src_vec$string_create
    $bind$m_Vec__packages_std_src_vec$u8_arr_len

which needed the three things the note above scoped, and one it did not:

1. **The ordered paths reach the emitter.** `linkFiles` records what each file was called beside the
   line it starts on, and `Env.filePaths` holds them by file index. Nothing else here needs a path —
   every other key comes from `declare` — so it is carried for the boundary alone.
2. **`mangleType`'s spelling, mirrored.** A template is qualified by its declaring file
   (`fileTagOf`), each argument is mangled after a `$`, an array is `_arr`, a nullable is `_opt` and
   a funcref is `fn_…_to_…`. Read off `compiler/wacResolve.ts` rather than derived: `Vec<u8[]>` is
   `Vec__packages_std_src_vec$u8_arr`, and guessing `u8` there would have left the helper as
   invisible as it was.
3. **An instance's methods are exported from the instance table**, not from declarations — a
   template's methods are emitted from a substitution and no `StructDecl` carries them.
4. **The thing the note missed:** a template is never `declare`d at all, so there is no name-table
   entry to look its file up in. The declaration's own line answers instead, which the export walk
   has in hand.

    32 of 34 packages pass their own suite on wacc-emitted code (1,552 tests)
    why the rest do not:
        1  no method Kind.word                     (git)
        1  a static Shell.capturing, declined      (sh)

**Neither is a name.** Both are emitter declines with their own reason, which is where this issue
said the finish line was. `test/bindHelpers.test.ts` pins the mangling, including the `_arr` case
that the first attempt got wrong.
