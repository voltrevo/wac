// Every wac test that needs nothing from the host, run under Deno as well.
//
// **This is the whole of what the Deno lane is for now.** `wac test` runs these natively, and the
// point of running them again here is not coverage — it is that the same wac, on a second host,
// still answers the same. That is one claim, so it is one file.
//
// It replaces forty-four wrappers that each did exactly this for one entry. Each said something
// worth keeping about the *tests* — which oracle they have, why a structural property carries more
// weight than usual — and none of it was about registration, so it moved into the wac file it was
// describing. What is left here is the list and the two facts that cannot live in a wac file: which
// entries exist, and what each is called in Deno's output.
//
// A wrapper that supplies a host oracle is **not** here and cannot be: it exists to pass something
// `wac test` has no way to produce. Twenty-five of those remain, each next to the test it feeds.
//
// `issues/system/0161`.

import { wacTestRun } from "../wacTestRun.ts";

/**
 * Every hostless wac test, and the label its cases carry in Deno's output.
 *
 * Written out rather than discovered by walking, and the reason is the second column: sixteen of
 * these are named something other than their file's stem — `bytes-bounds` because three packages
 * have a `bounds_test.wac`, `crc32-incremental` because the stem alone said nothing. A walk would
 * have to carry that table anyway, and then the list would be in two places.
 *
 * `tools/discovery.test.ts` is what keeps this honest: a wac test file reachable by neither this
 * list nor a wrapper is a test nothing runs under Deno, and it says so.
 *
 * **Eleven of these were nearly left behind**, because the first sweep for seams matched the
 * filename `*_wac.test.ts` and these are called `wac_tests.test.ts`, `buf.test.ts`, `map.test.ts`
 * and so on. A seam is a *shape* — one `wacTestRun` call, no host arguments, nothing else in the
 * file — and that is what the second sweep matched on. An enumeration is only as good as the thing
 * it enumerates by.
 *
 * `rendrelay` is a third shape again: its wrapper *passed* a stub argument to a file whose tests
 * declare no parameters at all, so the argument was discarded by the runner and the file was a seam
 * wearing an oracle's clothes. Checking that by looking for `fn[…]` parameters is not enough —
 * `mlkem` takes its oracle as a plain `u8[]`, and a sweep that only knew about funcrefs called it
 * dead when it is the strongest test in its package.
 */
const HOSTLESS: [string, string | undefined][] = [
  ["packages/bytes/test/wac/bounds_test.wac", "bytes-bounds"],
  ["packages/crypto/test/wac/chacha20_test.wac", "chacha20"],
  ["packages/crypto/test/wac/crypto_test.wac", "crypto"],
  ["packages/crypto/test/wac/ct_test.wac", "ct"],
  ["packages/crypto/test/wac/field25519_test.wac", "field25519"],
  ["packages/crypto/test/wac/ghash_test.wac", "ghash"],
  ["packages/crypto/test/wac/layout_test.wac", "layout"],
  ["packages/crypto/test/wac/traps_test.wac", "crypto-traps"],
  ["packages/ens/test/wac/traps_test.wac", "ens-traps"],
  ["packages/ethrpc/test/wac/jsonhex_test.wac", "jsonhex"],
  ["packages/gzip/test/wac/crc32_incremental_test.wac", "crc32-incremental"],
  ["packages/gzip/test/wac/crc32_test.wac", "crc32"],
  ["packages/gzip/test/wac/inflate_at_test.wac", "inflate-at"],
  ["packages/json/test/wac/bounds_test.wac", "json-bounds"],
  ["packages/platform/test/wac/ripple_test.wac", "ripple"],
  ["packages/platform/test/wac/sched_test.wac", "sched"],
  ["packages/quic/test/wac/connection_test.wac", "quic-connection"],
  ["packages/quic/test/wac/short_test.wac", "quic-short"],
  ["packages/quic/test/wac/tamper_test.wac", "quic-tamper"],
  ["packages/quic/test/wac/varint_test.wac", "quic"],
  ["packages/rlp/test/wac/traps_test.wac", "rlp-traps"],
  ["packages/std/test/wac/traps_test.wac", "std-traps"],
  ["packages/tls/test/wac/hybrid_traps_test.wac", "tls-hybrid-traps"],
  ["packages/tls/test/wac/hybrid_test.wac", "hybrid"],
  ["packages/tls/test/wac/record_traps_test.wac", "tls-record-traps"],
  ["packages/tls/test/wac/server_traps_test.wac", "tls-server-traps"],
  ["packages/tls/test/wac/wire_traps_test.wac", "tls-wire-traps"],
  ["packages/tls/test/wac/wire_test.wac", "wire"],
  ["packages/tor/test/wac/cell_test.wac", "cell"],
  ["packages/tor/test/wac/circuit_test.wac", "circuit"],
  ["packages/tor/test/wac/dirclient_test.wac", "dirclient"],
  ["packages/tor/test/wac/fuzz_test.wac", "fuzz"],
  ["packages/tor/test/wac/hsintropoint_test.wac", "hsintropoint"],
  ["packages/tor/test/wac/hsrendpoint_test.wac", "hsrendpoint"],
  ["packages/tor/test/wac/hsreplay_test.wac", "hsreplay"],
  ["packages/tor/test/wac/hsupload_test.wac", "hsupload"],
  ["packages/tor/test/wac/pathsel_test.wac", "pathsel"],
  ["packages/tor/test/wac/pool_test.wac", "pool"],
  ["packages/tor/test/wac/relay_test.wac", "relay"],
  ["packages/tor/test/wac/relaycircuit_test.wac", "relaycircuit"],
  ["packages/tor/test/wac/relaylink_test.wac", "relaylink"],
  ["packages/tor/test/wac/relayring_test.wac", "relayring"],
  ["packages/tor/test/wac/socks5_test.wac", "socks5"],
  ["packages/wactest/test/wac/itoa64_test.wac", "itoa64"],
  ["packages/bignum/test/wac/big_test.wac", "bignum-wac"],
  ["packages/bytes/test/wac/buf_test.wac", "buf"],
  ["packages/fmt/test/wac/ftoa_test.wac", "ftoa-wac"],
  ["packages/fs/test/wac/fs_test.wac", "fs"],
  ["packages/gzip/test/wac/huffman_test.wac", "huffman"],
  ["packages/json/test/wac/json_test.wac", "json"],
  ["packages/std/test/wac/hash_test.wac", "hash"],
  ["packages/std/test/wac/map_test.wac", "map"],
  ["packages/std/test/wac/option_test.wac", "option"],
  ["packages/std/test/wac/vec_test.wac", "vec"],
  ["packages/url/test/wac/url_test.wac", "url"],
  ["packages/tor/test/wac/rendrelay_test.wac", "rendrelay"]
];

for (const [entry, prefix] of HOSTLESS) {
  await wacTestRun(entry, prefix);
}
