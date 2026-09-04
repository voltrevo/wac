# page — the browser, which nineteen subjects had not been

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

Two files. [`src/counter.wac`](src/counter.wac) is `packages/platform/example/counter.wac` rewritten;
[`src/render.wac`](src/render.wac) is a `Node` as HTML text, which the tree does not have.

---

## Why this one

Every subject before it is a command-line program, and `vision/std`'s eight projections have no
document in them. So a vision program cannot be interactive — in a system whose `design/system/0001`
treats the browser as a host rather than a demo, and whose launcher hands `Page` to an exported
`page` the way it hands `Cli` to `main`.

That is a **ninth projection**, added here with all twelve members, and it is the second one found by
comparing against the host rather than by giving a projection a consumer — after `Clock` turned out
to be two of the host's three time capabilities. The count the seven were derived from was taken over
`Core` and `Cli`; `Page`'s twelve were never in it.

Nine days and nineteen packages did not notice, and the reason is worth more than the fix: **the
subjects were chosen from `packages/`, and `packages/` is where the command-line programs are.** A
projection audit that walks the *host* finds this in an afternoon; one that waits for a consumer
waits for somebody to pick a browser subject.

## JSX has one user in the whole repository, and it is its own demo

`spec/spec/jsx.md` is a full spec page. `core/jsx.wac` defines `Node` and `Attr` in `core` rather
than in a package, deliberately, because *"the compiler emits the constructor calls"*. Measured over
all 1,578 `.wac` files:

    spec/cases                    16 files use JSX   (the cases that specify it)
    everywhere else                1 file            packages/platform/example/page.wac, 68 lines

And that one file exists to demonstrate JSX. Meanwhile `counter.wac`, `gitpage.wac`,
`rasterdesk.wac` and `term.wac` — 814 lines of actual pages — build their documents by concatenating
string literals with escaped quotes:

    page.render(
      "<p>Clicks: <b id=\"n\">0</b></p>" +
      "<button id=\"up\">+1</button> " +
      …

**The feature is not unused because nobody likes it. It is unused because it does not reach the
capability.** `Page.render` is `fn[Pending<bool>(string)]` and JSX produces a `Node`, so a page that
writes JSX must turn the tree back into text itself — and `page.wac` does, in thirteen lines below
the markup, for a host that then parses the text into a tree again. Faced with that, every real page
skips the middle and writes the string.

`vision/std`'s `Page.render` takes a `Node`. That is the whole change and it is a change to the
*capability*, not to the language.

## Which makes it the third of a shape

| | narrower than the language can say | so the program |
|---|---|---|
| `In.read` | an empty array for *end*, where `Socket.recv` has a sum | cannot tell end from not-yet |
| `Clock` | two of the host's three, no `sleepMillis` | busy-polls |
| `Page.render` | `string`, where the language has `Node` | writes a renderer, or gives up on JSX |

The third is the first where the loss is a whole language feature rather than a distinction, and it
is the one where the workaround is visible in the code: four pages that could have used JSX and did
not.

## The renderer, and the two consumers that never existed

`core/jsx.wac`'s header anticipates a split — *"a tree built in one repository and a renderer in
another must name one type or nothing composes"* — and ships no renderer. I wrote
[`src/render.wac`](src/render.wac) expecting two consumers wanting opposite things: a page, which
hands markup to a host that parses it and so needs no renderer once `render` takes a `Node`; and a
server, which puts HTML on a socket where a tree has nowhere to go.

**Then I read `packages/server/src/routes.wac`.** Its six routes answer plain text, RFC 3339, JSON,
base64 and regex captures. There is no HTML in the server, and there is none anywhere else either.

So the finding is sharper than the one I set out to write. **Nothing in this repository needs a
wac-side HTML renderer**, and the thirteen lines that exist inside
`packages/platform/example/page.wac` exist *only* because `Page.render` takes a `string`. Give the
capability a `Node` and the renderer's last consumer goes with it. `core/jsx.wac`'s header is
reasoning about a second repository that does not exist yet — which makes the type right and the
renderer premature.

`src/render.wac` is kept anyway, because writing it is what found that out, and because the two rules
it has and the example does not are the argument that a renderer is *not* thirteen lines whenever
somebody does need one: **the five characters that are not text**, and the fourteen **void
elements**. The first is an injection the moment anything renders a request parameter, and
`std/platform.wac` already has that rule written on the host side — *"`render` is the one that
parses, and the difference is where every injection bug in a page like this would come from"*.

## Two of the six unwritten constructs got users, and one of them is load-bearing

`@"for"`, a quoted tag and a hyphenated attribute were three of the six constructs in
[`../../GRAMMAR.ebnf`](../../GRAMMAR.ebnf) that no file used — added from `TECHNICAL.md` because the
pages have them, never written with.

- `data-role="echo"` — a hyphenated attribute, and ordinary HTML. It is fair to ask why the first
  page written in nine days is the first thing to want one.
- `<label @"for"="echo">` — `TECHNICAL.md`'s leading entry, and here it is not decoration: `for` is a
  keyword and `for` is the attribute that makes a label clickable, so without the escape the line
  cannot be written.

A **quoted tag** — `<"my-widget" />` — still has none. A custom element is a real thing a page wants;
this page has none, which is honest rather than an argument.

## What could not be written

**An `id` that the compiler relates to the markup.** The original's loop compares `e.id` against
`"up"`, `"down"`, `"reset"`, `"quit"` — four literals that also appear as `id` attributes twenty
lines above, with nothing connecting them. Rename a button and the page compiles and stops working.
The `Event` union here fixes the *kind* half — `Click` and `Typed` are arms, so a ninth kind makes
every match inexhaustive — and cannot touch the ids, because the only thing that could is a type
derived from the document. That is a bigger idea than this package.

**A void element with children cannot be refused.** `<input>{x}</input>` builds a `Node.Element` with
kids and `render` drops them, because it answers a `string` and has nothing to report to. Answering a
`Result` makes every caller handle a *program* bug. The right place is the compiler, which sees the
tag as a literal — and `spec/spec/jsx.md` has no notion of a void element at all, so it is a rule
that does not exist rather than one being broken.

**An attribute name is any string.** `Attr` is two strings and the verbatim form accepts anything, so
`<p @"class name"="x">` renders markup no parser reads back. Checkable at the JSX, checked nowhere.

**Whether `Page` is one projection or several.** Twelve members covering markup, events, pixels, file
picking and downloads is wider than `Files`, and the argument that split `Sys` into groups would
split this too — `drawPixels` and `nextFile` have about as much to do with `setText` as `connect` has
with `readFile`. Against that, they are all one grant: a program that may show a document may show
pixels in it. Same question as *why seven*, one level down, and the same answer is not obviously
available: this projection was not derived from a grant boundary, it was derived from `Page`.
