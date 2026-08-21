#!/usr/bin/env bash
# Issue 0075: pick DENO_JOBS from evidence.
#
# The first version of this decided pass/fail by grepping deno's summary line, which has ANSI
# codes between the number and the word, so it never matched — and every run had in fact been
# killed while the table printed timings as though they were data. Status is the exit code here,
# and a run that did not pass prints no number at all.
#
# Those runs died because of 0077, not because of anything this measures: a `tools/test.ts` was
# being collected as a test module by the suite it launched, so each run re-entered the suite
# without bound. Hence the marker below.
cd "$(git rev-parse --show-toplevel)"
# The marker every tool that spawns a suite sets — see `tools/suiteGuard.ts`. This calls `deno test`
# directly rather than through `runTests.wac`, because setting DENO_JOBS per run is the whole point,
# so it has to set the marker itself: without it a test that invoked one of our tools would not be
# refused, which is the second half of 0077.
export WAC_SUITE_RUNNING=1

# **The same set of files the suite's parallel pass runs, or this measures a different suite.**
# Without an `--ignore` this aborted in two seconds — `deno.json` excludes `site/src` and not
# `site/tools`, so discovery picked up `site/tools/*.test.ts`, which imports vite-resolved TypeScript
# and does not type-check. That is why the table this writes had gone stale: the instrument stopped
# running at all, silently, and nothing re-ran it to notice (issues/system 0142).
#
# The lane list comes from `harness/testLane.ts`, which is where `runTests.wac` gets it, so a file that
# declares itself exclusive leaves this measurement the same day. `site` is named because a
# command-line `--ignore` *replaces* the config's exclude rather than adding to it.
#
# **Both lanes, and the second one is why this comment now says "lanes".** When the heavy lane was
# added, `runTests.wac` began skipping ten files in its parallel pass and this kept running them — so
# the instrument measured a suite nobody runs, and would have reported a peak an agent then chose
# `DENO_JOBS` from. Taking the list from `testLane.ts` was supposed to stop exactly that, and did
# not, because it asked for one lane by name. It now asks for every declared file, so a *third* lane
# would be picked up without anyone remembering this line exists.
IGNORE=$(deno eval --ext=ts 'import { declaredLaneFiles } from "./harness/testLane.ts"; console.log(["site", ...(await declaredLaneFiles())].join(","));')
if [ -z "$IGNORE" ]; then
  echo "ABORT: could not work out which files the parallel pass runs."
  exit 1
fi
#
# **The same flags and the same environment, too.** `runTests.wac` passes `--unstable-net` (without it
# `Deno.listenDatagram` does not exist and every datagram test fails) and sets `WAC_SCHED=seed`
# (deterministic scheduling). Missing the first, the warm-up here reported **24 failures at jobs=1**
# — sequential, no memory pressure, nothing wrong with the tree — and aborted the sweep on them.
# A measuring instrument that runs the suite differently from the suite measures a different suite.
ARGS=(--parallel "--ignore=$IGNORE" --allow-read --allow-write --allow-run --allow-net --allow-env
      --unstable-net)
export WAC_SCHED="${WAC_SCHED:-seed}"

run() {   # run <jobs> <logfile>; echoes "<exit> <wall_ms>"
  local t0 rc
  t0=$(date +%s%N)
  DENO_JOBS=$1 deno test "${ARGS[@]}" >"$2" 2>&1
  rc=$?
  echo "$rc $(( ($(date +%s%N) - t0) / 1000000 ))"
}

echo "load $(cut -d' ' -f1-3 /proc/loadavg)  swap $(free -m | awk '/Swap/{print $3}')MB  deno-cache $(du -sh ~/.cache/deno | cut -f1)"

# Warm sequentially: one worker is the least memory this can take, and a cold cache at higher
# parallelism is what the OOM killer ate last time. Verified by exit code before going on.
# `WARM=0` skips it. The warm-up exists so the first *measured* run is not paying for a cold cache,
# so skipping it is only honest when something else has just run the suite.
echo "warming (jobs=1, cold cache — this is the slow one; WARM=0 skips it)..."
if [ "${WARM:-1}" = "0" ]; then wrc=0; wms=0; echo "  skipped (WARM=0)"; else
read -r wrc wms <<<"$(run 1 /tmp/w.log)"
fi
echo "  exit=$wrc  $((wms/1000))s  $(sed 's/\x1b\[[0-9;]*m//g' /tmp/w.log | grep -oE '[0-9]+ passed \| [0-9]+ failed' | tail -1)"
if [ "$wrc" -ne 0 ]; then
  echo "ABORT: the warm-up did not pass, so no timing below would mean anything."
  sed 's/\x1b\[[0-9;]*m//g' /tmp/w.log | tail -5
  exit 1
fi

echo
printf "%-5s %7s %9s %9s %9s  %s\n" jobs wall peak rise anon result
# `JOBS="1 4" ./tools/jobsSweep.sh` re-measures two widths instead of five. The whole sweep is six
# suite runs and the better part of an hour on a machine three agents share, which is a price worth
# paying when the table is being rebuilt and not when one number is in doubt.
for j in ${JOBS:-1 2 3 4 5}; do
  pf=$(mktemp)
  # **Two numbers, because one of them is not a requirement.** `memory.current` is the whole
  # cgroup's charge and includes *page cache*, which the kernel reclaims long before it kills
  # anything — and the cache this suite reads through has reached 18 GB, so the file half grows with
  # the cache rather than with the suite. `anon` from `memory.stat` is the part that has to be found:
  # it cannot be reclaimed, only swapped or OOM-killed. `tools/suiteGate.ts` compares its floor
  # against `MemAvailable`, which *already* counts reclaimable cache as available — so a floor taken
  # from `memory.current` charges for the same memory twice.
  ( while :; do
      printf '%s %s\n' "$(cat /sys/fs/cgroup/memory.current)" \
                        "$(awk '/^anon /{print $2}' /sys/fs/cgroup/memory.stat)"
      sleep 0.2
    done > "$pf" ) & s=$!
  read -r rc ms <<<"$(run "$j" /tmp/j$j.log)"
  kill $s 2>/dev/null; wait $s 2>/dev/null
  hi=$(awk '{print $1}' "$pf" | sort -rn | head -1); lo=$(awk '{print $1}' "$pf" | sort -n | head -1)
  ahi=$(awk '{print $2}' "$pf" | sort -rn | head -1); alo=$(awk '{print $2}' "$pf" | sort -n | head -1)
  rm -f "$pf"
  summary=$(sed 's/\x1b\[[0-9;]*m//g' /tmp/j$j.log | grep -oE '[0-9]+ passed \| [0-9]+ failed' | tail -1)
  if [ "$rc" -eq 0 ]; then
    printf "%-5s %6ss %8sMB %8sMB %8sMB  %s\n" "$j" "$((ms/1000))" "$((hi/1048576))" \
      "$(( (hi-lo)/1048576 ))" "$(( (ahi-alo)/1048576 ))" "$summary"
  else
    printf "%-5s %7s %9s %9s %9s  FAILED exit=%s after %ss — %s\n" "$j" - - - - "$rc" "$((ms/1000))" "${summary:-no summary: it did not finish}"
  fi
done
echo
echo "load $(cut -d' ' -f1-3 /proc/loadavg)  swap $(free -m | awk '/Swap/{print $3}')MB"
