# 0063 — "wac has no import syntax" reads as false, because wac has import syntax

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-03
- **Kind:** diagnostic
- **Symptom:** wrong answer

Documentation, not code. The sentence appears twice:

- `README.md:59` — "Passing it is the only way a host function becomes reachable: wac has no
  import syntax, so a module that takes no `fn[…]` parameter has no wasm imports at all"
- `spec/spec/bindgen.md:118` — "**Passing it is the only way in.** wac has no import syntax,
  so nothing a program can write names a host function"

wac does have import syntax, listed six lines above the first one under **Language features**:
"File-based imports with `import { x } from "./file.wac"`".

## Why it is worth changing

A reader hits the claim, remembers the feature list, and now distrusts both. It happened to
someone reading a page built from these docs: they had just seen

```wac
import { Cli, Core, FileResult } from "../src/platform.wac";
```

and asked what the sentence meant.

The confusion is costly because the paragraph is making one of the strongest claims in the
project — that a module which takes no `fn[…]` parameter has an *empty wasm import section*,
checkable on the binary. That claim deserves a sentence nobody has to reconcile.

## Suggested wording

The true statement is about what an import can name, not whether the keyword exists:

> wac's `import` reads another `.wac` file and does nothing else — there is no `extern`, no
> declaration form, no way to write down the name of a function that lives outside the
> program. So the only host code a module can call is a value someone handed it.

## Notes

Filed rather than fixed: `wac` is agent-a's and actively worked in, and this is two sentences
of prose in files that are being edited.

The same paragraph is worth one more clause somewhere, because it is a genuinely unusual
property and the docs state it in passing: **there is no ambient authority to opt out of.**
Most sandboxes are a list of things you have taken away. This is the other kind — the import
section is empty unless a parameter put something in it.
