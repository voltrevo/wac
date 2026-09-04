# ethrpc — rewritten as a composition test

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/ethrpc`: 496 lines over four files, JSON-RPC to an Ethereum node.
Small, and picked for that: it imports **json, http, fmt, codec, crypto, rlp and `std`**, four of
which have rewrites here. **Every other rewrite in this directory has been standalone or had one
consumer. This is the first that had to make two rewritten surfaces fit each other**, and the
findings are ones no single-package rewrite could produce.

---

## Three layers, three flags, and the composition loses which one lost

A call goes through HTTP, then JSON, then JSON-RPC. Each layer already collapses its failure:

| layer | shipped answer |
|---|---|
| `packages/http` | `Fetched` with `bool ok` and an empty `Incoming` when not |
| `packages/json` | `parse` answering a value with an error code on the parser |
| `packages/ethrpc` | `Answer` — `(bool ok, JsonValue result, string error)` |

So a caller holding `Answer.ok == false` cannot tell the socket failing from a 500, from a body that
is not JSON, from an envelope with no `result`, from **the node understanding the call and
declining it**. The last is not a failure of anything: `eth_getProof` on a pruned block answers
−32000 *"missing trie node"*, which is that node telling the truth about what it has, and a caller
that wants to try a different provider needs it apart from a closed socket.

`string error` survives, and it is a sentence assembled by whichever layer lost.

## The first union that has to contain two others

```wac
export union<Transport, NotJson, NotRpc, Refused> RpcFault;
```

where `Transport` carries `@/packages/http`'s fault and `NotJson` carries `@/packages/json`'s
`ParseError`, both whole. `@/packages/box`'s gunzip *matched* a nested union — `Err(is Corrupt):`
over eight members — and nothing until now has had to **build** one.

That makes this the first real consumer of the nesting design, and it is the case that decides it:
[../../TECHNICAL.md](../../TECHNICAL.md) shows `union` lowering to an enum whose variant holds an
enum, measured, so `Err(is Transport):` catches every HTTP fault in one arm. Under a *flattening*
lowering the members of three unions would be siblings, `Transport` would not exist as a name, and
this caller would match a dozen arms to ask one question.

## The one collapse worth keeping

`jsonhex.wac` decodes a missing member, a member of the wrong type and malformed hex all to empty,
and argues it:

> **Malformed hex decodes to empty rather than trapping.** Every byte here came off a network from a
> peer that is not trusted: a node answering nonsense should produce a proof that does not verify —
> an error path the caller already has — rather than killing the program.

That is right, and it is the argument this directory has spent a week making *against* — so it is
worth saying why it survives. The distinctions collapse because **for an untrusted peer they have
one consequence**: do not believe this. Distinguishing them costs a `match` at every field read of
every header and buys a caller nothing it can act on.

**One crack, and the file already knows about it.** `isNull` exists separately because *"JSON `null`
or absent — which for a header field is not the same as zero"* — so one distinction does matter, and
it is recovered by asking a second question rather than by the value carrying it. That is the shape
of the collapse being one distinction too wide, and the file is honest about exactly which one.

## What could not be written

**A `Refused` is not a failure and the signature says it is.** Putting the node's own `error` member
in the `Err` arm means every caller writes a `match` to discover that nothing went wrong. The honest
shape is three cases — `Ok`, `Declined`, `Err` — which is a three-armed `Result` and not a thing;
`Result<Result<JsonValue, Refused>, RpcFault>` is writable and reads as badly as it sounds.

**The trust boundary is in no type.** The shipped header's *"provided the root came from somewhere
else"* is the entire safety argument of `mpt`, `ens` and `lightclient`, and nothing in `call`'s
signature carries it — the answer is a `JsonValue` and a caller may hand it to `mpt` as a state root
as readily as anything else. A `Verified<T>` only `@/packages/lightclient` can construct is the
shape. That is [../../QUESTIONS.md](../../QUESTIONS.md)'s refinement entry with a **security**
argument rather than an ergonomic one, which is the first time it has had one.

**Params are JSON text and stay that way.** The shipped decision — *"building them is the caller's
business and every method's shape is different"* — is right, and a typed builder would be
`@/packages/abi`'s schema problem one protocol up: a closed set of method signatures known at the
call site, an answer that is positional, and no way to say either.
