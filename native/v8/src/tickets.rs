//! What has been asked for, what has finished, and who is runnable.
//!
//! A capability returns before its work has happened: the value that comes back is a `Pending<T>` —
//! an id and three funcrefs — and the id is a row here. A worker thread records the outcome and
//! `wait` blocks until it lands.
//!
//! ## Why this can be shared with a thread when nothing else here can
//!
//! A V8 isolate belongs to one thread, so nothing holding a `v8::Local` or a `v8::Global` can be
//! sent to a worker. This table holds neither. An `Answer` is plain data — bytes, a number, the
//! fields of a `Stat` — and is turned into a wasm value only when the guest asks for it, on the
//! thread that owns the isolate. That was true before there were threads here at all, which is the
//! only reason adding them is a small change rather than a rewrite.
//!
//! ## Which of several ready tickets `waitAny` answers with
//!
//! **The first in the caller's own list, always** — not whichever thread happened to finish first.
//! `native/src/tickets.rs` made that choice and the reasoning is worth repeating rather than
//! rediscovering: the obvious implementation returns whatever completed first, which makes a
//! program's behaviour depend on the machine it ran on. This one is reproducible by construction —
//! the same program with the same completions makes the same decisions, whatever order the threads
//! finished in.
//!
//! ## The deadline is here, not inside a wait primitive
//!
//! `wait_any`'s deadline is this table's `Condvar::wait_timeout`, so the runtime can see it. A
//! virtual clock would need exactly that: something that knows nothing is runnable *and* knows the
//! earliest time anything could become runnable.

use std::collections::{HashMap, HashSet};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// What a finished request produced. Plain data, so a worker thread can build one.
#[derive(Clone)]
pub enum Answer {
    I32(i32),
    I64(i64),
    Text(String),
    /// `None` is not an empty array: `cli.env` answers `u8[]?` and a program is entitled to tell an
    /// unset variable from one set to nothing.
    Bytes(Option<Vec<u8>>),
    /// `FileResult(ok, bytes, error, fault)`.
    File(bool, Vec<u8>, String, i32),
    /// `Change(fault, message)`.
    Change(i32, String),
    Stat(Box<StatAnswer>),
    /// `string[]?` — `None` is a directory that is not there, which `readDir` answers with rather
    /// than an empty listing, because "no entries" and "no directory" are different facts.
    Names(Option<Vec<String>>),
    /// `Socket(handle, error, peer, port, fault)`.
    ///
    /// `fault` is one of the `FAULT_*` codes and `FAULT_NONE` on success: a refusal for want of a
    /// grant has to be tellable from a connection that failed, and until 2026-08-24 only the message
    /// said which -- in two different spellings across the hosts. `issues/system/0238c`.
    Socket(i32, String, String, i32, i32),
    /// `Datagram(bytes, peer, port, error)` — the payload and the sender in **one** answer.
    ///
    /// Not `Read` plus a second call for the peer: two answers would let a program pair one
    /// datagram's bytes with another's sender, and neither half would look wrong. design/system 0007.
    Datagram(Vec<u8>, String, i32, String),
    /// A `Read`, for `recv`: the bytes, or the end of the stream, or why it stopped.
    Read(ReadAnswer),
    Bool(bool),
    /// `Child(handle, errHandle, fsHandle, error)`.
    Child(i32, i32, i32, String),
    /// `Captured(out, err, truncated)` — what a pushed frame produced.
    Captured(Vec<u8>, Vec<u8>, bool),
    /// `Exec(status, stdout, stderr, error)` — a host program run to completion.
    ///
    /// `status` is an exit code and `error` is why it could not be started; they are separate
    /// because a program that ran and exited non-zero is the case every differential oracle here
    /// cares about most, and folding it into a fault would make it unreachable.
    Exec(i32, Vec<u8>, Vec<u8>, String),
}

/// What a `recv` produced, in the three shapes `enum Read` has.
#[derive(Clone)]
pub enum ReadAnswer {
    Data(Vec<u8>),
    End,
    Failed(String),
}

#[derive(Clone, Default)]
pub struct StatAnswer {
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
    pub size: i64,
    pub modified_millis: i64,
    pub is_symlink: bool,
    pub is_executable: bool,
    pub fault: i32,
}

#[derive(Default)]
struct Inner {
    next_id: i32,
    /// Asked for and not yet finished.
    live: HashSet<i32>,
    /// Finished and not yet taken.
    done: HashMap<i32, Answer>,
}

pub struct Tickets {
    inner: Mutex<Inner>,
    settled: Condvar,
}

impl Default for Tickets {
    fn default() -> Self {
        Self { inner: Mutex::new(Inner { next_id: 1, ..Default::default() }), settled: Condvar::new() }
    }
}

impl Tickets {
    /// A new id for work that has been started.
    pub fn submit(&self) -> i32 {
        let mut inner = self.inner.lock().unwrap();
        let id = inner.next_id;
        inner.next_id += 1;
        inner.live.insert(id);
        id
    }

    /// A ticket whose answer is already in hand — `argCount` has nothing to wait for.
    pub fn settled_now(&self, answer: Answer) -> i32 {
        let mut inner = self.inner.lock().unwrap();
        let id = inner.next_id;
        inner.next_id += 1;
        inner.done.insert(id, answer);
        id
    }

    /// Record an outcome and wake anything waiting. Called from whichever thread did the work.
    ///
    /// **Answers `Some(answer)` when nobody took it** — the ticket was cancelled, or completed
    /// twice. Dropping it here is right for a *computation*, which can be run again, and wrong for
    /// anything that was consumed to produce it: a datagram is read off a socket exactly once, and
    /// discarding it silently loses a packet the peer will not send again. `issues/system/0207` is
    /// that bug. Callers who have nothing to hand back ignore the result, which is what most do.
    #[must_use = "an answer nobody took is data; see issues/system/0207"]
    pub fn complete(&self, id: i32, answer: Answer) -> Option<Answer> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.live.remove(&id) {
            return Some(answer);
        }
        inner.done.insert(id, answer);
        drop(inner);
        self.settled.notify_all();
        None
    }

    /// Block until this ticket has an answer, and take it. Spent afterwards.
    ///
    /// `None` means there is no such ticket and never was one — a second `wait()` on a ticket, or
    /// an id the program made up. Waiting for it would be for ever, so saying so at once is both
    /// kinder and more correct.
    pub fn take(&self, id: i32) -> Option<Answer> {
        let mut inner = self.inner.lock().unwrap();
        loop {
            if let Some(a) = inner.done.remove(&id) {
                return Some(a);
            }
            if !inner.live.contains(&id) {
                return None;
            }
            inner = self.settled.wait(inner).unwrap();
        }
    }

    /// Whether `take` would return at once. Never blocks.
    pub fn is_settled(&self, id: i32) -> bool {
        self.inner.lock().unwrap().done.contains_key(&id)
    }

    /// Stop caring. **Detach, not abort** — the work may already be under way and generally cannot
    /// be interrupted; what this guarantees is that the answer is discarded.
    ///
    /// **Answers what was already in hand**, for the same reason `complete` does: the work may have
    /// finished between the caller giving up and this call, and for a datagram that answer is the
    /// packet itself. `issues/system/0207`.
    #[must_use = "an answer nobody took is data; see issues/system/0207"]
    pub fn drop_ticket(&self, id: i32) -> Option<Answer> {
        let mut inner = self.inner.lock().unwrap();
        let had = inner.done.remove(&id);
        inner.live.remove(&id);
        had
    }

    /// The index in `ids` of the first ticket with an answer, or `-1` on the deadline.
    pub fn wait_any(&self, ids: &[i32], millis: i32) -> i32 {
        if ids.is_empty() {
            return -1;
        }
        let deadline =
            if millis < 0 { None } else { Some(Instant::now() + Duration::from_millis(millis as u64)) };
        let mut inner = self.inner.lock().unwrap();
        loop {
            for (i, id) in ids.iter().enumerate() {
                if inner.done.contains_key(id) {
                    return i as i32;
                }
            }
            // An id that is neither settled nor live is nobody's: waiting for it would be for ever,
            // and answering -1 now is the same statement the deadline makes.
            if !ids.iter().any(|id| inner.live.contains(id)) {
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
                        // One more pass rather than returning here: a completion landing in the same
                        // instant as the deadline should be reported, and checking is cheap.
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
