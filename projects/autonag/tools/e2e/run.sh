#!/bin/sh
# autonag's own Playwright specs (client/e2e in autonag), against a client served by a wac server at $BASE: the specs'
# fixed token and instance replaced by the seeded ones ($TOKEN, $INST), the browser the one this machine has.
#     BASE=http://127.0.0.1:38611 TOKEN=… INST=… AUTONAG=../autonag sh tools/e2e/run.sh
set -eu
out=$(mktemp -d)
mkdir -p "$out/e2e"
for f in "$AUTONAG"/client/e2e/*.spec.ts; do
  sed -e "s/const TEST_TOKEN = \"[0-9a-f]*\"/const TEST_TOKEN = \"$TOKEN\"/" \
      -e "s/const TEST_INSTANCE_ID = \"[^\"]*\"/const TEST_INSTANCE_ID = \"$INST\"/" "$f" > "$out/e2e/$(basename "$f")"
done
cat > "$out/playwright.config.ts" <<CFG
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 20000,
  use: { baseURL: "$BASE", launchOptions: { executablePath: "${CHROMIUM:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome}", args: ["--no-sandbox"] } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
CFG
ln -s "$AUTONAG/client/node_modules" "$out/node_modules"
cd "$out" && npx playwright test --reporter=line
