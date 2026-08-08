//! The ticket table: what has been asked for, what has finished, and who is runnable.
//!
//! Items 3 and 4 of wac-mono 0087, and the piece D12 and D13 are about.
//!
//! A capability returns before its work has happened. The value that comes back is a `Pending<T>` —
//! an id and three shared functions — and the id is a row here. A worker thread records the outcome;
//! `waitAny` parks until one of a list of ids has one.
//!
//! ## What is deliberately not the JavaScript design
//!
//! The other three hosts pass completions through a `SharedArrayBuffer`: a ring of four slots, a
//! sequence counter per slot, and a worker parked in `Atomics.wait`. None of that is here, and 0087
//! made its absence a criterion — the ring exists to move a completion between an *event loop* and a
//! *worker* that cannot block, and native code blocks the calling thread. So a ticket is a row in a
//! map behind a mutex, and `waitAny` is a condition variable.
//!
//! The visible consequence is that there is **no ceiling on outstanding tickets**. The ring has four
//! slots and `packages/relayd` can exceed them (wac-mono 0091); this cannot, because a `HashMap` has
//! no slots to run out of.
//!
//! ## D12: who is runnable, without asking the operating system
//!
//! Completion is recorded by this process's own threads, so the table already knows. `ready` answers
//! from the map alone — no syscall — and **which** of several ready tickets `waitAny` returns is a
//! policy rather than an accident of scheduling: it is the **first in the caller's own list**, always.
//!
//! That is a real choice and not the obvious one. The obvious implementation returns whichever thread
//! happened to finish first, which makes a program's behaviour depend on the machine it ran on. This
//! one is reproducible by construction: the same program with the same completions makes the same
//! decisions, whatever order the threads finished in. A deterministic execution mode needs somewhere
//! to put the policy, and this is that place.
//!
//! ## D13: the deadline is here, not inside a wait primitive
//!
//! `waitAny`'s deadline lives in this table's `Condvar::wait_timeout` rather than inside a worker's
//! own `Atomics.wait`, so the runtime can see it. That is what a virtual clock would need: something
//! that knows nothing is runnable *and* knows the earliest time anything could become runnable. The
//! clock is still the real one — advancing it is not implemented — but the deadline is no longer
//! invisible, which was the thing that made it impossible.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// What a finished request produced.
///
/// One variant per `Pending<T>` this runtime can complete. A capability whose `T` is not here is not
/// implemented, and says so rather than completing with something plausible.
#[derive(Debug, Clone)]
pub enum Outcome {
    I32(i32),
    I64(i64),
    Bytes(Vec<u8>),
    /// A wac `string`, which is bytes: nothing here validates UTF-8, because a name on the systems
    /// being imitated is bytes and re-encoding one would change it (wac-mono 0065).
    Str(Vec<u8>),
    /// `u8[]?` — where **absent and empty are different answers**. An environment variable that is
    /// set to nothing is not an environment variable that is unset, and the whole reason `env` has
    /// this type rather than `string` is that the two used to be indistinguishable (wac-mono 0065).
    BytesOpt(Option<Vec<u8>>),
    Bool(bool),
    /// What a child frame wrote: `Captured{out, err}`.
    Captured(Vec<u8>, Vec<u8>),
    /// `Change{fault, message}` — what happened to something that changes state.
    Change(i32, String),
    /// `FileResult{ok, bytes, error, fault}`.
    FileResult(bool, Vec<u8>, String, i32),
    /// `Stat{exists, isFile, isDir, size, modifiedMillis, isSymlink, fault}`.
    Stat(bool, bool, bool, i64, i64, bool, i32),
    /// `string[]?` — **null is "not a directory", empty is "an empty one"**, and a host that
    /// collapsed them would make `ls` of a file print nothing instead of complaining.
    Names(Option<Vec<Vec<u8>>>),
}

struct Inner {
    next_id: i32,
    /// Settled tickets nobody has collected yet. Absent means either live or already taken.
    done: HashMap<i32, Outcome>,
    /// Submitted and not settled. Kept apart from `done` so that "no such ticket" and "not yet" are
    /// different answers — a caller that waits on an id nobody issued should not wait for ever.
    live: HashMap<i32, ()>,
}

pub struct Tickets {
    inner: Mutex<Inner>,
    settled: Condvar,
}

impl Default for Tickets {
    fn default() -> Self {
        Tickets {
            // From 1, so that 0 is never a valid ticket: a zeroed struct that reached here would
            // otherwise name the first request anybody made.
            inner: Mutex::new(Inner { next_id: 1, done: HashMap::new(), live: HashMap::new() }),
            settled: Condvar::new(),
        }
    }
}

impl Tickets {
    /// Take an id for work about to start.
    pub fn submit(&self) -> i32 {
        let mut inner = self.inner.lock().unwrap();
        let id = inner.next_id;
        inner.next_id += 1;
        inner.live.insert(id, ());
        id
    }

    /// Record an outcome and wake anything waiting. Called from whichever thread did the work.
    pub fn complete(&self, id: i32, outcome: Outcome) {
        let mut inner = self.inner.lock().unwrap();
        if inner.live.remove(&id).is_none() {
            // Cancelled, or completed twice. Dropping the value is right for the first and the only
            // safe answer for the second; either way nothing is waiting for it.
            return;
        }
        inner.done.insert(id, outcome);
        drop(inner);
        self.settled.notify_all();
    }

    /// Whether `id` has an outcome waiting to be collected.
    pub fn is_done(&self, id: i32) -> bool {
        self.inner.lock().unwrap().done.contains_key(&id)
    }

    /// Collect the outcome, **blocking until there is one**. A ticket has one exactly once.
    ///
    /// Blocking is the contract rather than a convenience: `Pending.wait` in `platform.wac` is
    /// `return this.resolve(this.id)` and nothing else, so all of the waiting a program does is here.
    /// The first version of this took an outcome that was already present and answered None otherwise,
    /// which worked for every capability that finishes instantly and failed the moment one did not —
    /// `slow.wait()` on a sleep still running. A host whose `resolve` does not block makes `wait` mean
    /// "collect if it happens to be ready", which is `isDone`'s job.
    ///
    /// None only for an id that is neither settled nor live: nobody's ticket, and waiting for it would
    /// never end.
    pub fn take(&self, id: i32) -> Option<Outcome> {
        let mut inner = self.inner.lock().unwrap();
        loop {
            if let Some(outcome) = inner.done.remove(&id) {
                return Some(outcome);
            }
            if !inner.live.contains_key(&id) {
                return None;
            }
            inner = self.settled.wait(inner).unwrap();
        }
    }

    /// Discard a ticket: `Pending.cancel`, and what `drop` does to one nobody waited for.
    ///
    /// A cancelled ticket that is still running is *forgotten*, not stopped — `complete` finds no
    /// live row and drops the value. That is what cancelling means here and what `patience.wac` says
    /// it means: "discard the answer", not "stop trying".
    pub fn discard(&self, id: i32) {
        let mut inner = self.inner.lock().unwrap();
        inner.live.remove(&id);
        inner.done.remove(&id);
    }

    /// Park until one of `ids` has settled, and answer **its index in the list**.
    ///
    /// -1 when the deadline passes, and -1 for an empty list, which `platform.wac` says is the same
    /// statement: nothing settled. `millis` of -1 waits as long as it takes, and 0 asks what is ready
    /// right now.
    ///
    /// The index rather than the id, because that is what callers read: `inetd.wac` compares the
    /// answer against 1 to decide which of two `recv`s spoke.
    pub fn wait_any(&self, ids: &[i32], millis: i32) -> i32 {
        if ids.is_empty() {
            return -1;
        }
        let deadline = if millis < 0 { None } else { Some(Instant::now() + Duration::from_millis(millis as u64)) };
        let mut inner = self.inner.lock().unwrap();
        loop {
            // **The policy, and D12's whole point.** First in the caller's list rather than
            // first to finish, so the answer does not depend on how the threads were scheduled.
            for (i, id) in ids.iter().enumerate() {
                if inner.done.contains_key(id) {
                    return i as i32;
                }
            }
            // An id that is neither settled nor live is nobody's: waiting for it would be for ever.
            // Answering -1 immediately is the same statement the deadline makes.
            if !ids.iter().any(|id| inner.live.contains_key(id)) {
                return -1;
            }
            match deadline {
                None => inner = self.settled.wait(inner).unwrap(),
                Some(at) => {
                    let now = Instant::now();
                    if now >= at {
                        return -1;
                    }
                    let (next, timed_out) = self.settled.wait_timeout(inner, at - now).unwrap();
                    inner = next;
                    if timed_out.timed_out() {
                        // One more pass rather than returning here: a completion that landed in the
                        // same instant as the deadline should be reported, and checking is cheap.
                        for (i, id) in ids.iter().enumerate() {
                            if inner.done.contains_key(id) {
                                return i as i32;
                            }
                        }
                        return -1;
                    }
                }
            }
        }
    }
}
