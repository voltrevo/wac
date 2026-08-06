// "What is built" as its own page: the package table, and the capability world under it.
//
// The two belong together — the table is the evidence and the capability argument is why any of it
// can be an application rather than a library — so they were never separated on the long page and
// are not separated now.

import Built from "./sections/Built";
import { Page } from "./chrome";

export default function BuiltPage() {
  return (
    <Page current="built">
      <Built />
    </Page>
  );
}
