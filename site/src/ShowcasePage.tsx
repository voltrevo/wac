// Three things that are hard to argue with, on one page: a shell checked against bash, Tor at both
// ends, and Ethereum checked against published vectors.
//
// They share a page because they make one argument between them — that the language carries real
// systems — and because each is too long to be a section of something else.

import CaseStudies from "./sections/CaseStudies";
import { Page } from "./chrome";

export default function ShowcasePage() {
  return (
    <Page current="showcase">
      <CaseStudies />
    </Page>
  );
}
