# unscii-16, vendored

`unscii-16.hex` is [unscii](https://github.com/viznut/unscii) by Viznut, in Unifont `.hex` format:
one line per glyph, `CODEPOINT:HEXROWS`, code points **five** hex digits wide.

**Public domain.** Its README says, verbatim:

> Licensing: You can consider it Public Domain (or CC-0) except for the files (unifont.hex,
> hex2bdf.pl, unscii-16-full.*) which fall under GPL.

None of the GPL files is here and none is needed — the `-full` variants are the trap, because the
name suggests *more* rather than *differently licensed*. So this carries no obligation at all: no
notice to reproduce, nothing to travel with a binary. `design/system/0004` records why it was chosen
over Spleen and Tamzen (coverage: 3,240 glyphs against 1,001 and 189, and Tamzen draws no
box-drawing at all).

Fetched 2026-08-15 from
`raw.githubusercontent.com/viznut/unscii/HEAD/fontfiles/unscii-16.hex`. `viznut.fi` is **not** on the
proxy allowlist; GitHub is.

Vendored rather than fetched at build time because a build that reaches the network is a build that
fails when the network is not there, and this file does not change.

`packages/raster/tools/genfont.ts` turns it into `packages/raster/src/font16.wac`. Regenerate with:

    deno run --allow-read --allow-write packages/raster/tools/genfont.ts
