# Questions

Open questions about the language. Not bugs and not work: nothing here is wrong, and nothing here is
buildable yet.

Deliberately loose. No numbering, no fixed shape, no index, nothing for a guard to walk. A number
invites a cross-reference, and a reference to a question that has been answered and deleted is worse
than no reference at all.

**A question is deleted once it is answered** — and the answer has to land somewhere first, as an
example, a decisions entry, or a spelling changed across the pages. Deleting a question whose answer
went nowhere deletes the reasoning with it.

See [README.md](README.md) for what this directory is and why nothing checks it.

---

## Whether a self-dependent `wait` can be diagnosed

`t.wait()` where `t`'s coroutine awaits `t` never returns, and the quiescence check that catches an
idle program does not see it — `wait` is running, so the program is spinning rather than idle. A walk
that refused to revisit a ticket it had already tried in the same call would answer `Err`, at the
cost of carrying that set for every `wait`. Whether there is something cheaper is open.

## What example should capture `defer`

And whether `sys.atEnd` wants one beside it, since the pair is the whole cleanup story — `defer`
runs when the block exits, `atEnd` when the domain does, and cleanup that must happen belongs to a
system rather than to a block.

## What example should capture the keyword rule

`await` is illegal in a generator, `yield` is illegal in an async function, and an async generator
has both. Probably a refusal, since the legal cases already appear on the page.

## What example should capture stepping a finished machine

It has to be a no-op. A scheduler can be holding a continuation for a machine somebody else waited
to completion, and there is no way to withdraw the registration.

## What example should capture `auto` refusing to widen

`auto` takes the type an expression already has, and `union` is the widening marker. An array whose
elements disagree is the case that separates them.

## What example should capture a default type argument

`enum Result<T, E = union>` is what makes `Result<T>` an ordinary generic rather than a special
form, and it is the thing that lets `Result`'s current blessing expire.



## How is a number rendered

Interpolation is `+`, and `+` will not take a number, so `"\{n}"` on an `i32` is a type error and
there is nothing in `core` to reach for instead. Three packages have written their own `decimal`.

Whatever answers this decides whether interpolation stays exactly `+`.
