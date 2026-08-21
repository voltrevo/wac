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

# **How many times this batch has passed the suite without landing.** `issues/system/0213a`: a full run
# is now longer than the interval between other agents' pushes, so losing the race is the expected
# outcome rather than bad luck — and every symptom of it is a *separate* invocation, each of which looks
# like one unlucky run. Four green suites in a row landing nothing is invisible unless somebody is
# reading the logs of all four, which is how it went unnoticed long enough to need measuring.
#
# Keyed on the **oldest unpushed commit**, because that is the one thing about a batch a merge does not
# change: `git merge` adds commits and rewrites none, so the earliest of mine stays the same object even
# as the batch grows around it. Per agent, since the count is about this agent's batch.
#
# This decides nothing about policy — 0213a's options are somebody else's call and its own note says so.
# It makes the starvation say its own name.
# **Computed once, before anything moves it.** The key is derived from `origin/master..HEAD`, and a
# successful push updates the local `origin/master` ref — so recomputing it afterwards asks about an empty
# range and answers nothing. The first version did exactly that and left the file behind on a run that
# landed, so the next run would have opened with a stale banner about a batch that was already in.
STARVE_FILE=""
starveInit() {
  local oldest who
  oldest=$(git rev-list origin/master..HEAD 2>/dev/null | tail -1)
  [ -z "$oldest" ] && return 0
  who=$(printf '%s' "$PWD" | sed -n 's;.*/\(agent-[a-z0-9]*\)/.*;\1;p')
  [ -z "$who" ] && who=unknown
  STARVE_FILE="/tmp/wac-starve-${who}-${oldest:0:12}"
}
starveCount() {
  [ -z "$STARVE_FILE" ] && { echo 0; return; }
  cat "$STARVE_FILE" 2>/dev/null || echo 0
}
starveBump() {
  [ -z "$STARVE_FILE" ] && return 0
  echo $(($(starveCount) + 1)) > "$STARVE_FILE"
}
starveClear() { [ -n "$STARVE_FILE" ] && rm -f "$STARVE_FILE"; return 0; }

starveInit

starved=$(starveCount)
if [ "${starved:-0}" -gt 0 ]; then
  echo "== this batch has already passed the suite ${starved} time(s) without landing =="
  echo "   $(git rev-list --count origin/master..HEAD 2>/dev/null) commit(s) waiting. That is"
  echo "   issues/system/0213a — the run is longer than the gap between other agents' pushes, so"
  echo "   losing the race is expected. The suite time spent so far is real and nobody read it."
fi

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
  # once; the suite then takes three or four minutes, and an agent working through it — which is
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
  # **Which counter, and why the obvious one can be structurally zero.** `memory.events` counts only
  # kills the *cgroup's own limit* caused. This container runs at the cgroup root with `memory.max`
  # unlimited, so that counter cannot move: a kill under host pressure is the global OOM killer's and
  # never appears there. It read 0 through a run that had plainly died, which is the instrument
  # `issues/system/0142` was closed on reporting nothing.
  #
  # `/proc/vmstat` sees those kills and is **host-wide**, so it also counts other containers'. A
  # delta is therefore evidence rather than proof it was us — which is why the message below says
  # where the number came from instead of asserting whose kill it was.
  oomSource=cgroup
  [ "$(cat /sys/fs/cgroup/memory.max 2>/dev/null)" = "max" ] && oomSource=vmstat
  oomCount() {
    if [ "$oomSource" = vmstat ]; then
      awk '/^oom_kill /{print $2}' /proc/vmstat 2>/dev/null || echo 0
    else
      awk '/^oom_kill /{print $2}' /sys/fs/cgroup/memory.events 2>/dev/null || echo 0
    fi
  }
  oomBefore=$(oomCount)
  if [ "$attempt" -gt 1 ]; then
    WAC_SUITE_RETRY=1 timeout --kill-after=30s 45m deno task test 2>&1 | tee "$log"
  else
    timeout --kill-after=30s 45m deno task test 2>&1 | tee "$log"
  fi
  status=${PIPESTATUS[0]}
  oomAfter=$(oomCount)
  # Set here rather than in the success path below, because the failure branches need it too: how
  # long a run lasted is what separates `timeout` firing at 45 minutes from somebody else's SIGKILL
  # nine minutes in, and reading a stale value from the previous attempt would answer the wrong one.
  elapsed=$((SECONDS - started))
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
    # **The refusal has its own exit code, and it did not always.** `tools/suiteGate.ts` exits 75
    # (`EX_TEMPFAIL`) when it will not start a suite. It used to exit 3 — which is also `wac test`'s
    # code for a failing test and what `tools/runTests.ts` passes through — so a genuine red suite
    # arrived in this branch, had its log deleted below, and was announced as "nothing ran, and the
    # reason is printed above" while the reason was a `FAIL` line in the log that had just been removed.
    #
    # The first repair guessed from whether `$log` was empty. That is wrong too: the refusal reaches the
    # log through `tee`, so a refusal leaves a short log rather than none, and the next gate run
    # announced a cooldown refusal as a failing suite. Two wrong readings of the same overloaded code
    # are what bought the code of its own.
    if [ "$status" -eq 75 ]; then
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
    # **124 and 137 are not the same answer, and treating them alike printed a false one.** 124 is
    # `timeout` firing: the run reached 45 minutes and was cut, which is issue 0036's hang. 137 is
    # SIGKILL. `timeout` only sends that 30 seconds *after* the 45 minutes, so a 137 that arrives in
    # ten is somebody else's kill — the kernel's, for memory, which is issues/system 0142. On
    # 2026-08-12 this branch reported "the suite did not finish in 45m" for a run that had been going
    # nine minutes and whose oom_kill counter had just moved from 21 to 22. Every word of that was
    # wrong, and the counter it needed was already being read a few lines below, in the branch this
    # one skips past.
    killed=$((oomAfter - oomBefore))
    if [ "$status" -eq 137 ] && [ "$elapsed" -lt 2700 ]; then
      echo "== the suite was killed after ${elapsed}s: not pushing =="
      if [ "$killed" -gt 0 ]; then
        echo "   The kernel killed $killed process(es) for memory during this run — this is that kill."
        echo "   Not a hang and not a failing test: the log simply stops. issues/system 0142."
        echo "   Re-run when the machine is quiet; nothing below is evidence about the change."
      else
        echo "   SIGKILL, and the kernel's oom_kill counter did not move, so it was not memory."
        echo "   Something outside this script stopped it. issues/system 0142 collects these."
      fi
    elif [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      echo "== the suite did not finish in 45m: not pushing =="
      echo "   This is a hang, not slowness — see issue 0036. Deno never kills a blocked test, so"
      echo "   the run would have continued indefinitely. Still running when it was cut:"
      grep -oE "'[^']+' has been running for over[^)]*.\)" "$log" | sort -u | head -10
      [ "$killed" -gt 0 ] && echo "   (the kernel also killed $killed process(es) for memory in this window)"
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
        echo "== the oom_kill counter ($oomSource) moved by $((oomAfter - oomBefore)) during this run =="
        echo "   A log that ends without a summary is that kill, not a failing test and not a hang."
        if [ "$oomSource" = vmstat ]; then
          echo "   That counter is host-wide, because this cgroup has no memory limit for a kill to"
          echo "   be attributed to. So it is evidence and not proof: another container's kill looks"
          echo "   the same from here. A log that *does* end with a summary was not this."
        fi
        echo "   Re-run when the machine is quiet; see issues/system 0142 before believing anything below."
      fi
      # **What a failure looks like has to include the `wac test` lane's words.** `FAILED` and
      # `error:` are Deno's, and this pattern was written when Deno ran everything. `wac test` says
      # `FAIL`, and its per-directory summary says `1 with failures` and `3 that did not run` — none
      # of which match. So a run with real failing tests printed *nothing matched FAILED or error:,
      # so no test reported anything — the run itself died … usually a worker killed for memory*, and
      # the reader went to look at `free -m`. That happened three times in one morning before anybody
      # read the log by hand; the tell was that two runs produced an identical count of summaries,
      # which is not what a memory kill looks like.
      #
      # `cannot emit` and `did not build` are here for a failure with no failing test at all: a
      # directory whose files collide on a name builds one at a time instead, every test passes, and
      # the suite still exits non-zero. Without them the summary is empty and truthful and useless.
      fails='FAILED|^FAIL |error:|wacc: cannot emit|did not build|with failures|did not run'
      echo "-- failures --"
      if ! grep -qE "$fails" "$log"; then
        # **A failure with no failures in it means the run died rather than reported.** This happened on
        # 2026-08-05: the suite type-checked all 140 files, printed its last `Check` line, and exited
        # non-zero in nine seconds with no diagnostic — fifteen minutes after a host reboot, with other
        # agents rebuilding caches. The likeliest cause is a `--parallel` worker killed for memory, which
        # issue 0075 has already seen reported as though the test were wrong. The exit code above is what
        # tells them apart, and it was not printed at the time, so the only diagnosis available was a
        # guess. Somebody made a confident one and it was wrong.
        echo "   Nothing in the log looked like a failure, so no test reported anything — the run"
        echo "   itself died. Exit $status. 1 with no output is usually a worker killed for memory;"
        echo "   check /proc/loadavg and free -m, and try again on a quieter machine before believing"
        echo "   the change is at fault."
      fi
      grep -E "$fails" "$log" | head -20
      # Any test that outstayed Deno's warning threshold is worth naming even on a plain failure:
      # it is the likeliest cause of a slow run somebody is about to blame on their own change.
      slow=$(grep -oE "'[^']+' has been running for over[^)]*.\)" "$log" | sort -u | head -5)
      [ -n "$slow" ] && { echo "-- tests that ran unusually long --"; echo "$slow"; }
    fi
    echo "-- full output: $log --"
    exit 1
  fi

  echo "== suite passed in ${elapsed}s (load now $(cut -d' ' -f1-3 /proc/loadavg)) =="
  # **The threshold has to move when the suite does.** This said "several times the usual ~50s" above
  # 180s, and the suite has been 205-230s since the wac lane became the largest one — so it fired on
  # every green run, four times stale, which is a warning that cannot warn. Measured 2026-08-18:
  # 208s, as 78s of Deno tests, 29s of the files that run alone, and 100s of `wac test`; the floor with
  # the current set of checks is about 190s on five cores, and `deno task test` prints the split.
  # 330s is where a run is genuinely out of the ordinary rather than merely slow.
  if [ "$elapsed" -gt 330 ]; then
    echo "   that is well above the ~210s this suite costs when nothing is wrong. Usually the machine"
    echo "   was busy — three agents share five cores — but check for a hung test too (issue 0036);"
    echo "   the load above tells you which, and the \`where the time went\` block says which lane."
    slow=$(grep -oE "'[^']+' has been running for over[^)]*.\)" "$log" | sort -u | head -5)
    [ -n "$slow" ] && { echo "-- tests that ran unusually long --"; echo "$slow"; }
  fi

  # **The doc checks, which the suite does not run.** `deno task docs` is `wac test tools/` followed by
  # two Deno files, and the wac half is ten test files nothing else reaches: the lane in `runTests.ts`
  # walks `packages/` only. So `tools/wac/links_test.wac`, `map_test.wac`, `programs_test.wac`,
  # `testIgnore_test.wac` and six more — every one of them a guard on this repository's own tooling —
  # ran only when somebody typed the command. A whole suite log from 2026-08-18 mentions `tools/wac/`
  # exactly zero times.
  #
  # Here rather than in the suite, because two of them read `git ls-files`: in a working tree with a new
  # file not yet added, a link to it does not resolve and the check is right to say so — which is a
  # sensible thing to fail a *push* on and a poor thing to fail a mid-edit `deno task test` on. The tree
  # is clean by the time this runs; the script refuses a dirty one.
  #
  # 8s, measured, and it blocks: these are deterministic checks over files in the repository, so a red
  # one is a red one for everybody rather than a machine having a bad day.
  if ! deno task docs > "$log.docs" 2>&1; then
    echo "== the doc checks are red — not pushing =="
    echo "   \`deno task docs\` runs them. The failures:"
    grep -E "FAIL|error:|failed" "$log.docs" | head -20
    echo "-- full output: $log.docs --"
    exit 1
  fi
  echo "== doc checks passed =="

  # **The site, which the suite does not look at at all.** `site/` is in `deno.json`'s `exclude` and named
  # again in the parallel pass's `--ignore`, for a real reason: its sources are vite-resolved TypeScript
  # that Deno's resolver refuses. So `site/tools/site.test.ts` needs two flags, and its TypeScript needs
  # the checker that agrees with the bundler — `npx tsc -b`, in `site/`. Neither ran anywhere automatic.
  #
  # **It was red when this was added.** The page said "372 of its claims carry a tag" and `spec/` had 375,
  # in a section titled "A specification that cannot drift". Nothing had noticed because nothing looked,
  # and the site deploys on every push — which is what `issues/system/0146` already cost once, when the
  # published playground quietly compiled with the reference for a while.
  #
  # 6s for both.
  if ! deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts > "$log.site" 2>&1; then
    echo "== the site's own tests are red — not pushing =="
    echo "   \`deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts\` runs them:"
    grep -E "FAILED|error:" "$log.site" | head -10
    echo "-- full output: $log.site --"
    exit 1
  fi
  if ! (cd site && npx tsc -b) >> "$log.site" 2>&1; then
    echo "== the site does not type-check — not pushing =="
    echo "   \`cd site && npx tsc -b\` is the checker that agrees with the bundler:"
    tail -20 "$log.site"
    exit 1
  fi
  echo "== the site passes its own tests and type-checks =="

  # **The coverage ratchets, after the suite and before the push.** Nineteen packages, 38 seconds
  # against the suite's two hundred — twelve now that they run four at a time — so the cost is small for
  # the thing the suite cannot
  # see: an uncovered branch is not a failing test, it is code nothing asked about. issues/system 0101
  # is the whole argument — `coverage:crypto` had been red long enough for the reason to be forgotten,
  # and `rsa.wac` grew eighteen unmeasured branch points while the issue describing that was open,
  # because nothing ran the task.
  #
  # It was held out of here until every one passed, on the rule that a red check in the gate blocks
  # every other agent for something they did not do. All nineteen have passed since 2026-08-12.
  # **Reported, not enforced, from 2026-08-12 21:55 to 2026-08-19.** It blocked for ten hours and then
  # stopped being fair: `packages/zstd` used `leadingZeros`, which `wacc` had and the reference
  # compiler did not, so `coverage:zstd` could not build while every test of it passed. That is
  # nobody's fault who is pushing, and a check that blocks every agent for something they did not do
  # is the exact line 0101 said not to cross — including when the person who crossed it is the one
  # who put the check here.
  #
  # **Blocking again since 2026-08-19**, which is what that paragraph promised: `issues/lang/0111` is
  # the gap it named, and it closed on 2026-08-13 — the condition was met for six days and nothing
  # acted on it, because "put it back when that closes" is a sentence in a shell script and no check
  # reads it. There are now 21 packages rather than 19 and all 21 have been green on every gate run
  # since. If this blocks you for something you did not do, the fair answer is the same as it was:
  # say so here and turn it back into a report, rather than pushing past it silently.
  if ! deno task coverage:all; then
    echo "== the coverage ratchets are red — not pushing =="
    echo "   A package above is below its recorded coverage, or an exemption in its cov.ts no longer"
    echo "   matches the line it names, or it will not build. Run:"
    echo "       deno task coverage:<pkg> --verbose"
    echo "   A branch you cannot reach is not a failure — record it in that package's cov.ts with the"
    echo "   argument for why, which is what every entry there already carries."
    echo "   If this is a gap you did not open and cannot close, `tools/push.sh` says how this check"
    echo "   went from blocking to reporting once before, and on what argument."
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
    starveClear
    exit 0
  fi

  # The suite passed and the push did not land: that is one starved pass, counted before the merge
  # changes what the batch is.
  starveBump
  echo "== push rejected, merging and retrying =="
  before=$(git rev-parse HEAD)
  if ! git pull --no-rebase --no-edit --quiet origin master; then
    echo "== merge needs hands: resolve, then run this again =="
    exit 1
  fi
  # **Reseed when the merge aged the seed, and ask the test that owns that question.**
  #
  # `native/v8/seed/wacc.wasm` and `native/v8/target/release/wac` are gitignored and one per agent, so
  # a merge that brings somebody else's change to anything they are built from ages them — and the next
  # attempt runs the suite against a compiler older than the tree. That is `issues/system/0160`, and it
  # costs a full suite run each time.
  #
  # Here rather than in the caller's hands because the gate is what did the pulling. CLAUDE.md tells an
  # agent to reseed after a merge; a script that merges on your behalf should not also expect you to
  # notice that it did.
  #
  # **This used to test `git diff … -- packages/wacc/src` and `-- native`, and that was too narrow.**
  # The seed is built from the whole import closure of `packages/wacc/example/wacc.wac`, which reaches
  # `packages/bytes`, `packages/platform`, `packages/fs` and more — so a merge touching
  # `packages/bytes/src/buf.wac` aged the seed, this condition said no, and the retry failed on
  # `seedFresh` after 364 seconds. Naming the directories means keeping a copy of that closure here and
  # being wrong the first time somebody adds an import.
  #
  # `tools/seedFresh.test.ts` already owns the question — it compares both artefacts against everything
  # they are built from — and answering it costs about 200ms. So the condition is that test, and it
  # cannot drift from the definition because it *is* the definition.
  if ! deno test -A --no-check --unstable-net tools/seedFresh.test.ts >/dev/null 2>&1; then
    echo "   the merge aged the seed or a host — rebuilding"
    if ! deno task seed >/dev/null 2>&1; then
      echo "== the seed would not rebuild after the merge: not retrying =="
      echo "   Run \`deno task seed\` by hand to see why; every later failure would be downstream of it."
      exit 1
    fi
    # **And the wasmtime host, which `deno task seed` does not build.** It builds `native/v8` only, so
    # a merge touching `native/src/` left `native/target/release/wacland` behind — and the retry then
    # failed with `Cli.execWith is not implemented in the native runtime yet`, from a host that
    # predated the merge that added it. `issues/system/0208` is that it has no owner; this is the gate
    # not needing one. Only when it exists: a checkout that has never built it has nothing to age, and
    # whichever test wants it builds it.
    if [ -f native/target/release/wacland ] && ! (cd native && cargo build --release >/dev/null 2>&1); then
      echo "== the wasmtime host would not rebuild after the merge: not retrying ==" >&2
      echo "   Run \`cd native && cargo build --release\` by hand; every two-host test would be" >&2
      echo "   comparing against the older one." >&2
      exit 1
    fi
  fi
done

echo "== still being beaten to the push after three tries; try again in a moment =="
echo "   this batch has now passed the suite $(starveCount) time(s) without landing — issues/system/0213a"
exit 1
