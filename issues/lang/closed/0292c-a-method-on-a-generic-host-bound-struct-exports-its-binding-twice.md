# 0292 — a method on a generic host-bound struct exports its binding twice

- **Status:** closed — not a bug. The method was a **duplicate member**, and nothing checked the file
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** an invalid module, and a `wac` that cannot start

## What was reported

Adding this to `Pending<T>` in `std/platform.wac` produced a module the engine refuses:

```wac
bool cancel(const this) {
  if (this.sched is null) { return false; }
  return this.sched!.off(this.id);
}
```

    WebAssembly.Module(): Duplicate export name '$bind$m_Pending__std_platform$i32_cancel'
      for function 3798 and function 3798 @+166628

`wac check std/platform.wac` was silent, so it read as an emitter fault, and a table of three full
builds narrowed it to *generic **and** host-bound* — `Sched.off` and `Core.cancel` fine, `Box<T>.ask`
in an ordinary program fine, `Pending<T>` the one that breaks.

## What it actually was

**`Pending<T>` already had a `cancel`**, at `std/platform.wac:391`:

```wac
/** Stop caring. **Detach, not abort**: the host may already be inside the work… */
void cancel(const this) { this.drop(this.id); }
```

So the struct declared `cancel` twice. `bindMethodExports` emits one export per *method entry* and
both entries resolve through `env.funcAt(inst + ".cancel")` to one function — which is exactly what
the engine said, and the detail that should have been read first: **the same function index on both
sides.** Two functions colliding on a name would have been two indices.

Dumping the export section by hand shows the shape plainly — the full method set per instantiation,
then `cancel` once more:

    3798 $bind$sm_Pending…$i32_of        3802 …$i32_then
    3799 …$i32_linkedTo                  3803 …$i32_wait
    3800 …$i32_cancel   ← first          3804 …$i32_isDone
    3801 …$i32_on                        3800 …$i32_cancel   ← again, same index

wacc **does** diagnose this, and well:

    error: duplicate member in this struct
     |   bool cancel(const this) { … }
     |   ^
     = help: rename one of them

Confirmed to fire for a plain struct, a generic struct, an exported generic struct, two members with
another between them, and two differing in return type — every axis the table above varied. It cannot
fire here because **nothing type-checks `std/platform.wac`**: `issues/system/0293c`, filed from this.

## What was wrong with the narrowing, and why

The three-row table was three correct measurements of the wrong variable. `Sched.off` and
`Core.cancel` are fine because those names were *unused on those structs*; `Box<T>.ask` is fine for
the same reason. Every row differed in genericity and host-binding, and every row also differed in
whether the name was already taken — the one thing not varied.

The tell was available and unread: the duplicate is one method, not the method set. A walk that ran
twice over a declaration would have duplicated all six. Only `cancel` doubled, which points at the
*member list* rather than at the walk.

The cost was three bootstraps, and one of them left a broken seed in
`native/v8/target/release/wac` — `bootstrap.sh --no-install` still writes `native/v8/seed/wacc.wasm`,
so "no install" does not mean "no effect on the toolchain you are using".

## What follows

- `issues/system/0293c` — the real defect, and the reason this looked like a compiler bug.
- **`design/lang/0014` is not blocked.** Step 1 existed only for this. `Pending<T>` takes new methods
  as any struct does.
- `Core.cancel(i32 id)` was added as this issue's workaround and is now redundant: `Pending.cancel()`
  was there all along. Removing it, and giving the real `cancel` the scheduler half it was missing —
  detaching a ticket that has a continuation registered should take the continuation off `Sched` too,
  or the callback stays live on a ticket nobody is waiting for.
