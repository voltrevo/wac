import { wacBind } from "./harness/wacBind.ts";
const mod = await wacBind("packages/wacc/src/api.wac");
const dumpErrors = mod.dumpErrors as (s: Uint8Array) => Int32Array;
const dumpTypeErrors = mod.dumpTypeErrors as (s: Uint8Array) => Int32Array;
const enc = new TextEncoder();
const src = "export i32 f() { i32 n = 0; switch (1) { default: { n = n + 1; } case 1: { n = n + 2; } } return n; }\n";
console.log("wacc parse:", Array.from(dumpErrors(enc.encode(src))).join(","),
            "check:", Array.from(dumpTypeErrors(enc.encode(src))).join(","));
