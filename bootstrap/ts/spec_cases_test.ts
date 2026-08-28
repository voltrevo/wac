// **Every case in wac's `spec/cases`, through the wacc that wac-L5 built.**
//
// `ladder_test.ts` proves the ladder closes on one program. This is the same question asked 252
// times, and the cases are adversarial: each is the smallest program that showed some
// implementation getting the language wrong, reduced until nothing could be removed. Six of the
// bugs found here were found by this file and by nothing else — a default `match` arm written
// before its cases, a string literal's escapes, an integer literal wider than a token's value.
//
// It needs the wac repo beside this one and skips when it is not there, as the ladder test does.

const HERE = new URL(".", import.meta.url).pathname;

async function corpusIsHere(): Promise<boolean> {
  try {
    await Deno.stat(`${HERE}../../spec/cases`);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "every spec case comes out as its expectation says",
  ignore: !(await corpusIsHere()),
  fn: async () => {
    const { result } = await import("./spec_cases.ts");
    if (result.total < 200) throw new Error(`only ${result.total} cases found`);
    if (result.wrong.length > 0) {
      throw new Error(
        `${result.wrong.length} of ${result.total} not as expected:\n  ` +
          result.wrong.slice(0, 12).join("\n  "),
      );
    }
  },
});
