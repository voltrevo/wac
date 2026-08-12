#!/usr/bin/env bash
# Run the suite, then push only if it passed. Merge and retry if someone got there first.
#
# This exists because `deno task test 2>&1 | grep ... && git push` pushes on *grep's* exit
# code, not the test run's. It looks like it guards the push and does not. I made that
# mistake twice in one session, and both times the tree happened to be fine — the failures
# were my own stale compiler — which is exactly the kind of luck that teaches nothing.
#
# Usage: tools/push.sh
set -uo pipefail

cd "$(dirname "$0")/.."

# Refuse to run with a dirty tree. The tests would pass against the working copy and the
# push would carry the last commit, so it reports success for work that never left the
# machine — which is worse than failing, because there is nothing to notice. I did this
# within an hour of writing the script.
if [ -n "$(git status --porcelain)" ]; then
  echo "== uncommitted changes: commit them first, or the push will not include them =="
  git status --short
  exit 1
fi

log="$(mktemp -t push-suite-XXXXXX.log)"

# Space, before blaming the change. This gate has failed twice on `No space left on device` for reasons
# outside this container: the shared overlay sits above 90% and only a few gigabytes of it are visible
# from in here. The operator's standing answer (2026-08-05) is to clear *Deno's* cache and retry, and to
# leave the repo's own `.cache` alone — it is small and every test repopulates it with the same bytes.
#
# The clearing itself lives in `tools/runTests.ts`, which the suite runs through anyway, so there is one
# implementation of it rather than a shell copy beside a TypeScript one. It used to clear `gen` — 220 MB
# — while 28 GB sat next to it in `v8_code_cache_v2`, three times, reporting success each time.
guardDenoCache() {
  deno run --allow-read --allow-write --allow-env tools/runTests.ts guard
}
freeDenoCache() {
  echo "== the disk is full and it is not this change: clearing Deno's caches and retrying =="
  du -sh "$HOME/.cache/deno"/* 2>/dev/null | sort -h | tail -3
  deno run --allow-read --allow-write --allow-env tools/runTests.ts free
  df -h / | tail -1
}

for attempt in 1 2 3; do
  guardDenoCache

  # There used to be a `git -C ../wac pull` here. The compiler was a separate repository and this
  # one was `wac-mono`, so `../wac` was the sibling checkout the version pin pointed at, and the
  # pull was inside the loop on purpose: a merge on a later attempt can bring in a commit that
  # bumps the pin, and pulling once at the top misses exactly that case.
  #
  # **That argument survived the repositories merging on 2026-08-09 and the path did not.** A
  # checkout is now `…/workspaces/wac`, so `../wac` resolves to *this working tree* — the script
  # pulled the repo it is standing in, at a point where it treats a failure as a note:
  #
  #     CONFLICT (content): Merge conflict in issues/system/INDEX.md
  #     note: could not pull wac; the version check will say if it matters
  #     == running the suite (attempt 1) ==
  #
  # It then spent the suite on a tree with conflict markers in it. The argument is kept by the
  # structure rather than by a second pull: the compiler is `compiler/` in this repo now, so the
  # merge at the bottom of this loop — which stops and asks for hands when it conflicts — is the
  # one that brings a pin bump in, and it is already inside the loop.

  # What the machine was doing, before and after. This container is shared with other agents,
  # and a mutation sweep next door turns a fifty-second suite into half an hour — which looks
  # exactly like a hang if nothing says otherwise. Twice now that has cost time to diagnose, so
  # the numbers are printed rather than remembered.
  # **What is being tested, so that is what gets pushed.** The dirty-tree check at the top runs
  # once; the suite then takes five to eleven minutes, and an agent working through it — which is
  # what the operator asks for rather than watching — can land a commit in that window. `git push
  # origin master` would carry it, and the gate would report a pass for a commit the suite never
  # saw. That is the same failure as the one the header describes, from the other side: there it
  # pushed work that had not been tested because it was uncommitted, here because it was too new.
  #
  # Captured inside the loop, after any merge a previous attempt made, so a retry tests and pushes
  # the merge it just created rather than the revision it started from.
  tested=$(git rev-parse HEAD)
  echo "== running the suite (attempt $attempt) =="
  echo "   load $(cut -d' ' -f1-3 /proc/loadavg) on $(nproc) cores"
  started=$SECONDS
  # Tee'd rather than swallowed. The first version printed only "tests failed", which is the
  # one moment the output is worth having — and when this runs unattended the terminal
  # scrollback is not there to fall back on.
  #
  # This is a pipeline guarding a consequential action, which is the mistake the whole file
  # exists to prevent. It is safe *only* because `pipefail` is set above, so the pipeline
  # takes the exit code of `deno task test` rather than of `tee`. Remove `pipefail` and this
  # line silently starts pushing red trees. Do not drop the `set -uo pipefail`.
  # `timeout` is a backstop against a *hang*, not a performance gate.
  #
  # Deno 2.9 has no per-test timeout — none at all, and none configurable. When a test blocks
  # forever it prints "has been running for over (4m0s)" and keeps printing it, and the run never
  # ends. Several tests here wait on a subprocess announcing readiness with no deadline of their
  # own (`waitForListening` in box's tests, three separate `serveOnce` helpers), and the ports come
  # from bind-then-release, which races under `--parallel`. So an unbounded wait is reachable, and
  # this script is the push gate: unbounded here means an agent sits for an hour with nothing to
  # read but a warning.
  #
  # The value is deliberately far above any legitimate run — the suite is about fifty seconds
  # alone, and the worst honest figure anybody has recorded on a loaded machine is half an hour.
  # Anything past this is not slow, it is stuck. Picking a tighter bound would recreate the
  # false-failure problem that kept issue 0031 open: a guard that fires on a busy machine gets
  # switched off.
  # **A retry is not a second suite in the cooldown's sense.** `tools/suiteGate.ts` refuses a run
  # when the same agent ran one under twenty minutes ago, which is right for an agent reaching for
  # `deno task test` by reflex and wrong for the loop here: attempt 1 passing and losing the push
  # race is exactly when attempt 2 has to run, and it lands six minutes later by construction.
  # Without this, losing a race became `tests failed after 1s (exit 3): not pushing` — measured on
  # 2026-08-12, an hour after that gate landed.
  #
  # `WAC_SUITE_RETRY`, not `WAC_SUITE_ANYWAY`: the second goes past the *lock* as well, and the lock
  # is the part that stops two suites overlapping, which is what the OOM kills came from. A retry
  # waits its turn like anything else.
  # **The kernel's kill counter, before and after.** A suite that is killed for memory leaves a log
  # with no summary line in it — thousands of passing tests and then nothing — which reads exactly
  # like a hang and is not one. That happened on 2026-08-12 with `tools/suiteGate.ts` in place and
  # all four of its refusals passed, and the only way anyone knew was reading
  # `/sys/fs/cgroup/memory.events` by hand afterwards. issues/system 0142.
  oomBefore=$(awk '/^oom_kill /{print $2}' /sys/fs/cgroup/memory.events 2>/dev/null || echo 0)
  if [ "$attempt" -gt 1 ]; then
    WAC_SUITE_RETRY=1 timeout --kill-after=30s 45m deno task test 2>&1 | tee "$log"
  else
    timeout --kill-after=30s 45m deno task test 2>&1 | tee "$log"
  fi
  status=${PIPESTATUS[0]}
  oomAfter=$(awk '/^oom_kill /{print $2}' /sys/fs/cgroup/memory.events 2>/dev/null || echo 0)
  if [ "$status" -ne 0 ]; then
    echo
    # Elapsed on every branch, because "how long did it take" is the first thing anyone asks and
    # the answer distinguishes the two failure modes that look alike.
    # **3 is a refusal, not a failure**, and it is the one exit code whose reason is already on the
    # screen: `tools/suiteGate.ts` prints "not running the suite: <why>" and exits 3 without starting
    # anything. Falling through to the branches below reported it as "the run itself died … usually a
    # worker killed for memory; check /proc/loadavg", which sends the reader to the machine when the
    # answer is two lines above — and the suite log is empty because no suite ran, so the "nothing
    # matched FAILED" test fires and confirms the wrong story.
    #
    # **One retry, and then stop**, which sorts the four refusals without reading the message. The
    # cooldown is the one worth retrying and the only one attempt 2 can clear, because `WAC_SUITE_RETRY`
    # above skips exactly that and nothing else. So: refused on attempt 1, go round once; refused again,
    # it is the lock, the memory floor or the load ceiling, none of which clears in the second this
    # takes, and spending the third attempt on it only buries the reason further up the log.
    #
    # Deciding by construction rather than by grepping the text, because the refusal is written to the
    # terminal and does not reach `$log` — which is also why the branch below cannot be reused: it
    # reads an empty log and concludes the run died.
    if [ "$status" -eq 3 ]; then
      rm -f "$log"
      if [ "$attempt" -eq 1 ]; then
        echo "== the suite gate refused; going round once with WAC_SUITE_RETRY=1 =="
        echo "   That skips the twenty-minute cooldown and nothing else. If the refusal was the lock,"
        echo "   the memory floor or the load ceiling, the next attempt refuses too and this stops."
        continue
      fi
      echo "== the suite gate refused; nothing ran, and the reason is printed above =="
      echo "   Not a test failure and not a kill: no suite started, so the log is empty."
      echo "   Wait for the other run to finish rather than retrying — see tools/suiteGate.ts for"
      echo "   the overrides and what each one skips."
      exit 3
    fi
    if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      echo "== the suite did not finish in 45m: not pushing =="
      echo "   This is a hang, not slowness — see issue 0036. Deno never kills a blocked test, so"
      echo "   the run would have continued indefinitely. Still running when it was cut:"
      grep -oE "'[^']+' has been running for over[^)]*.\)" "$log" | sort -u | head -10
    else
      # A failure that is really the shared disk: clear Deno's cache once and give the suite another go,
      # rather than reporting a change as broken when nothing about it was.
      if grep -q "No space left on device" "$log" && [ "$attempt" -lt 3 ]; then
        freeDenoCache
        continue
      fi

      echo "== tests failed after $((SECONDS - started))s (exit $status): not pushing =="
      # Said before the failures, because it changes what they mean: with the counter moved, a log
      # that stops mid-pass is a kill and the tests in it are not evidence about the change.
      if [ "$oomAfter" -gt "$oomBefore" ]; then
        echo "== the kernel killed $((oomAfter - oomBefore)) process(es) for memory during this run =="
        echo "   A log that ends without a summary is that kill, not a failing test and not a hang."
        echo "   Re-run when the machine is quiet; see issues/system 0142 before believing anything below."
      fi
      echo "-- failures --"
      if ! grep -qE 'FAILED|error:' "$log"; then
        # **A failure with no failures in it means the run died rather than reported.** This happened on
        # 2026-08-05: the suite type-checked all 140 files, printed its last `Check` line, and exited
        # non-zero in nine seconds with no diagnostic — fifteen minutes after a host reboot, with other
        # agents rebuilding caches. The likeliest cause is a `--parallel` worker killed for memory, which
        # issue 0075 has already seen reported as though the test were wrong. The exit code above is what
        # tells them apart, and it was not printed at the time, so the only diagnosis available was a
        # guess. Somebody made a confident one and it was wrong.
        echo "   Nothing in the log matched FAILED or error:, so no test reported anything — the run"
        echo "   itself died. Exit $status. 1 with no output is usually a worker killed for memory;"
        echo "   check /proc/loadavg and free -m, and try again on a quieter machine before believing"
        echo "   the change is at fault."
      fi
      grep -E 'FAILED|error:' "$log" | head -20
      # Any test that outstayed Deno's warning threshold is worth naming even on a plain failure:
      # it is the likeliest cause of a slow run somebody is about to blame on their own change.
      slow=$(grep -oE "'[^']+' has been running for over[^)]*.\)" "$log" | sort -u | head -5)
      [ -n "$slow" ] && { echo "-- tests that ran unusually long --"; echo "$slow"; }
    fi
    echo "-- full output: $log --"
    exit 1
  fi

  elapsed=$((SECONDS - started))
  echo "== suite passed in ${elapsed}s (load now $(cut -d' ' -f1-3 /proc/loadavg)) =="
  if [ "$elapsed" -gt 180 ]; then
    echo "   that is several times the usual ~50s. Usually the machine was busy rather than the"
    echo "   suite — but check for a hung test too (issue 0036); the load above tells you which."
    slow=$(grep -oE "'[^']+' has been running for over[^)]*.\)" "$log" | sort -u | head -5)
    [ -n "$slow" ] && { echo "-- tests that ran unusually long --"; echo "$slow"; }
  fi

  # **The coverage ratchets, after the suite and before the push.** Nineteen packages, 38 seconds
  # against the suite's four hundred, so the cost is a tenth of a run for the thing the suite cannot
  # see: an uncovered branch is not a failing test, it is code nothing asked about. issues/system 0101
  # is the whole argument — `coverage:crypto` had been red long enough for the reason to be forgotten,
  # and `rsa.wac` grew eighteen unmeasured branch points while the issue describing that was open,
  # because nothing ran the task.
  #
  # It was held out of here until every one passed, on the rule that a red check in the gate blocks
  # every other agent for something they did not do. All nineteen have passed since 2026-08-12.
  if ! deno task coverage:all; then
    echo "== the coverage ratchets are red: not pushing =="
    echo "   A package above is below its recorded coverage, or an exemption in its cov.ts no longer"
    echo "   matches the line it names. Run `deno task coverage:<pkg> --verbose` for the branch list."
    echo "   A branch you cannot reach is not a failure — record it in that package's cov.ts with the"
    echo "   argument for why, which is what every entry there already carries."
    rm -f "$log"
    exit 1
  fi

  # `$tested:master`, not `HEAD:master`: pushing the revision the suite ran against. If HEAD has
  # moved since, those commits stay local and go out with the next gate, which is the answer that
  # keeps "the gate tested what it pushed" true rather than nearly true.
  if git push --quiet origin "$tested:master" 2>/dev/null; then
    if [ "$tested" != "$(git rev-parse HEAD)" ]; then
      echo "== pushed $(git rev-parse --short "$tested") — HEAD moved during the suite, so"
      echo "   $(git rev-list --count "$tested"..HEAD) later commit(s) wait for the next run =="
    else
      echo "== pushed =="
    fi
    rm -f "$log"
    exit 0
  fi

  echo "== push rejected, merging and retrying =="
  if ! git pull --no-rebase --no-edit --quiet origin master; then
    echo "== merge needs hands: resolve, then run this again =="
    exit 1
  fi
done

echo "== still being beaten to the push after three tries; try again in a moment =="
exit 1
