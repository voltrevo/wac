# Notes for whoever works on this next

README.md says what this is, the plan, and where it stands.

- **autonag's TypeScript is the oracle** until the switch-over. Port a piece, extend `tools/oracle.ts` to
  record what autonag answers for it, and make a test replay those answers. autonag is
  github.com/voltrevo/autonag (cloned beside this as `../autonag`); run the oracle with Bun.
- **Keep the API exactly as autonag's** (field names, status codes, error texts): the React client is the
  integration test for the server.
- **Dependencies** are pinned in `wac.lock` and fetched with `wac task deps` (git.voltrevo.com refuses
  `wac update`). wac must have `Files.openRandom` (master from `4085b2e9c`), which wac-sqlite needs.
- **wac bugs met so far** are in `docs/wac-asks.md`, with reproductions and workarounds.
- **Time zones** come from the host (`/usr/share/zoneinfo`, read with `--allow-read`); the oracle's
  answers come from Bun's ICU, so a tz database much older or newer than it can disagree for some zones.
- Comments explain *why*, in full sentences, as wac's own do.
