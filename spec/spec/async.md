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

`[§wac-async-method-4kx7vqd]` **A method may be `async`**, written where it sits on a free
function — after any `override` and before the return type — and it lowers the same way. The
receiver is an ordinary parameter, so a suspension carries `this` across exactly as it carries any
other argument, and a caller sees `Pending<T>` of what the body answers. This is the shape that
matters in practice: a struct owning a socket and reading through a method on itself is what
`packages/ssh`'s `Conn`, `packages/tor`'s `Link` and `packages/fs`'s `Chan` are, and those methods
are the ones that want to suspend. An enum's methods take it on the same terms. What such a method
may `await` is the same set a free function may — see `§wac-async-nosuspend-6pv2wkn` for the one
shape neither can be. Until 2026-09-01 an
`async` method was declined by the emitter, and before 2026-08-30 it was a parse error naming the
wrong thing — `issues/lang/0301b` has both.

`[§wac-async-eager-2rf9kdp]` Calling an async function **runs its body immediately**, as
far as its first `await`, and returns a ticket for the rest. It does not wait to be
driven. A program that calls one and never consumes the ticket has still run everything
up to that first suspension.

`async` is written after any `export` and before the return type: `export async void
tick()`.

## Awaiting

`[§wac-await-inside-3nq7wbe]` `await` may appear only inside something declared `async`.
A lambda is a different function, so an `await` in a **plain** lambda's body is refused
even when that lambda is written inside an async function: its `return` returns from the
lambda, so its `await` would have to suspend a plain funcref. `async` on the lambda
itself is what permits one.

## async lambdas

```wac
import { Cli, FileResult, Pending } from "std/platform.wac";

fn[Pending<i32>(string)] size = async (string p) => {
  FileResult f = await cli.readFile(p);
  return f.ok ? f.bytes.len() : 0 - 1;
};
```

`[§wac-async-lambda-slot-9wq4nkz]` A lambda never writes a return type, so **its slot is
both the permission and the type**. `async` is allowed only where the target is
`fn[Pending<R>(…)]`, and that `R` is what the body is checked against. This is the rule
for functions read backwards: a function writes what its body answers and the caller
derives the ticket; a lambda derives what its body answers from the ticket its slot
names. `async` on a slot wanting no ticket is an error naming the type that was found,
which is what `p.then(async (T x) => …)` is — `then` takes `fn[void(T)]`.

`[§wac-async-lambda-captures-5mtj28r]` An async lambda **captures**, and a captured name
survives its suspensions. That is the whole reason to want one: a top-level `async`
function has to be handed everything it uses, and a lambda written where the values
already are does not.

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

`[§wac-async-unwaitable-4hpx2vn]` **Waiting on a ticket that only a continuation can answer is a
trap, not a wait.** `Pending` records whether waiting on it can make it answer — true of every ticket
a host hands out, and of an `async` function's, whose resolver drives its machine. False of one whose
answer arrives when somebody else's continuation runs: a wait drives its own chain and no unrelated
registered work, so nothing it may do can advance such a ticket.

It has to be recorded rather than worked out. At the moment of the wait, a host ticket whose answer
has not arrived and a ticket nothing can ever answer are indistinguishable — `sched` null, `settled`
false for both — and asking again afterwards does not separate them either, because a host ticket is
not settled after being waited on. What this replaces is worse than a hang: the resolver returned
whatever it had, which for that shape is a default, so a program asked for a file size and was told
zero with nothing said.

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
  name it;
- an `async` lambda that is **not the initialiser of a declaration** — an argument, a
  returned value, an assignment to something declared earlier. The lowering runs on the
  tree with no type information, and a declaration is the one place the `Pending<R>` it
  needs is written down. The same limit, from the same cause, as the item above it.
- `[§wac-async-nosuspend-6pv2wkn]` an `async` function whose body **never suspends**. With no
  `await` in it there is nothing unlowerable either, so it is lowered like any other — to a machine
  with **zero suspensions**, which is the one the emitter declines with *a call to `Pending`*. The
  checker has already given every caller the `Pending<i32>` this page promises, so `.wait()` has
  nothing to wait on. Adding one `await` to the same function makes the program build. Two rules above
  disagree here: `§wac-async-eager-2rf9kdp` is satisfied trivially and `§wac-async-decl-h3vq81m` not at all, since
  what such a body should hand back is a ticket that is **already answered**. It is also how a
  function is written before its first `await` is added. `spec/cases/0319` holds it, and the
  awaiting forms that look like separate limits — a call to another `async` function, or to another
  `async` method — were all measured against callees that never suspended.
