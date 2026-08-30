# async and await

A function declared `async` hands its caller a ticket instead of a value, and `await`
inside it suspends until a ticket it is given answers. It is notation over the
`Pending<T>` that every capability already returns — there is no runtime added, no
event loop, and no second stack. `design/lang/0014` records why each rule is what it
is; this states what the rules are.

## Declaring

```wac
import { Cli, FileResult, Pending } from "std/platform.wac";

async i32 fileSize(Cli cli, string path) {
  FileResult f = await cli.readFile(path);
  return f.ok ? f.bytes.len() : 0 - 1;
}
```

`[§wac-async-decl-h3vq81m]` The declared return type is what the **body** returns, and
the caller receives a `Pending<T>` of it. So `fileSize` above is written as answering
`i32`, its `return` is checked against `i32`, and `fileSize(cli, p)` has the type
`Pending<i32>`. Writing `async Pending<i32>` would mean a body that hands back a ticket
— see below — rather than being a second spelling of the same thing.

`[§wac-async-eager-2rf9kdp]` Calling an async function **runs its body immediately**, as
far as its first `await`, and returns a ticket for the rest. It does not wait to be
driven. A program that calls one and never consumes the ticket has still run everything
up to that first suspension.

`async` is written after any `export` and before the return type: `export async void
tick()`.

## Awaiting

`[§wac-await-inside-3nq7wbe]` `await` may appear only inside an `async` function. A
lambda is a different function, so an `await` in a lambda body is refused even when the
lambda is written inside an async function — there are no async lambdas yet.

`[§wac-await-pending-9km2xtr]` `await e` requires `e` to be a `Pending<T>` and has the
type `T`. Anything else is an error naming the type that was awaited.

`[§wac-await-bind-4wzp7cn]` `await` binds **tighter than any binary operator and looser
than postfix**. So `await cli.readFile(p)` awaits the call rather than the receiver, and
`await n + 1` is `(await n) + 1`.

## Returning a ticket

```wac
import { Cli, Pending, Socket } from "std/platform.wac";

async Pending<Socket> connectLater(Cli cli) {
  return cli.connect("localhost", 80);
}
```

`[§wac-async-nested-6bqt3jf]` A ticket returned from an async function is **not
flattened**. `connectLater`'s caller receives a `Pending<Pending<Socket>>`: awaiting once
gives a connection that is already being made, and awaiting that gives the socket. The
two awaits mean different things and neither is redundant.

`[§wac-async-mismatch-8dxr5va]` Returning a `Pending<U>` from an `async T` whose `T` is
not that ticket is an ordinary return-type mismatch, and its help states both readings:
`await` it for the value, or declare the function `async Pending<U>` to hand the ticket
on. It never suggests a cast, because there is no conversion from a ticket to what it
will answer.

## Consuming

`[§wac-async-wait-5tqm2wh]` `.wait()` on an async function's ticket drives that
function's own chain until it answers. It runs no unrelated registered work: a `wait` is
not a yield point, and the thousands of existing `.wait()` call sites were written when
it was a leaf.

`[§wac-async-drain-7cvj4bn]` A suspension on a ticket that carries a scheduler registers
a continuation, so `core.drain()` alone finishes the function and two async calls in
flight interleave rather than running one after the other. A ticket without a scheduler
has nowhere to register, so a chain awaiting one advances only under `wait` —
`Pending.linkedTo` is how such a ticket is given one.

`[§wac-async-once-3jhw8qk]` A body runs once however it is driven. A `wait` that arrives
while a continuation is registered takes that continuation back before stepping, so the
answer is delivered once rather than both where the caller waited and again when the
scheduler dispatches.

## void as a type argument

`[§wac-void-typearg-2mkx9db]` `void` may be written as a type argument, so `async void`
has a call-site type: `Pending<void>`. A `void` argument **erases the parameter it stood
in for**, so `Pending<void>`'s continuation is `fn[void()]` rather than a callback taking
a value of a type that has none. `Vec<void>` remains an error — nothing can hold a value
of it.

## What is not covered yet

These are refused by name rather than mis-lowered, and each states what it would need:

- an `await` in a loop or `if` **condition**, which needs the test split across states;
- an `await` nested inside a larger expression, which needs that expression's evaluation
  order split around it;
- an `await` whose value is discarded — `await e;` — because nothing in the source names
  the type of the ticket it suspends on, and the machine needs that type for the slot it
  suspends into. `T x = await e;` and `return await e;` are exactly the two shapes that
  name it.
