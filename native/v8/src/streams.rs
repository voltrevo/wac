//! One direction of bytes between a parent and a child.
//!
//! A child on this host is another thread with its own V8 isolate, so what it writes cannot be
//! handed over as a value — it goes into one of these, and the parent reads it with `recv` on a
//! handle, exactly as it reads a socket. Two per child, because a program has two output streams and
//! a handle carries one; merging them makes `cat nosuch | wc -c` count the error message.
//!
//! ## A queue has a bottom, and the number is not this file's to choose
//!
//! A `write` into a queue nobody is draining **waits**, as writing to a full pipe does. The cap is
//! the *same eight megabytes* `native/src/streams.rs` uses, which is in turn `host/children.ts`'s
//! `QUEUE_CAP` to the byte. That is not tidiness: `packages/platform/example/feed.wac` asks both
//! hosts the same question — a child writing nine megabytes into a parent that will not read for
//! 300 ms — and a program that behaves differently on two hosts because their buffers differ is the
//! thing this whole layer exists to prevent. A producer that never waits is a producer whose output
//! is held entirely in memory, and `box yes` writes for ever by design.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

/// How much may sit in a queue nobody is reading before a writer has to wait.
const CAP: usize = 8 << 20;

#[derive(Default)]
struct Inner {
    bytes: VecDeque<u8>,
    /// Nothing more will be written. A reader that empties the queue after this sees the end.
    done: bool,
}

/// One direction of bytes.
#[derive(Default)]
pub struct Stream {
    inner: Mutex<Inner>,
    ready: Condvar,
    capped: bool,
}

impl Stream {
    /// A queue that makes a writer wait once it holds `CAP` bytes: a child's two output streams.
    pub fn capped() -> Self {
        Self { capped: true, ..Self::default() }
    }

    /// A queue with no bottom — **a child's standard input**, which the JavaScript hosts also leave
    /// uncapped: the parent decides how much to send and can stop, which is not true of a child
    /// that writes.
    pub fn uncapped() -> Self {
        Self::default()
    }

    pub fn write(&self, bytes: &[u8]) -> bool {
        let mut inner = self.inner.lock().unwrap();
        // **Wait for room, and only then look at `done` again.** A writer parked here is woken by
        // either a reader draining or the stream ending, and the two must be told apart on the way
        // out: ending is `false`, room is a write that lands.
        while self.capped && !inner.done && inner.bytes.len() >= CAP {
            inner = self.ready.wait(inner).unwrap();
        }
        if inner.done {
            // The reader has gone. `false` is what `write` answers to a closed pipe, and what a
            // program like `yes` is written to notice.
            return false;
        }
        inner.bytes.extend(bytes.iter().copied());
        drop(inner);
        self.ready.notify_all();
        true
    }

    /// No more will be written. Readers still drain what is there first.
    pub fn finish(&self) {
        self.inner.lock().unwrap().done = true;
        self.ready.notify_all();
    }

    /// Everything available, blocking until there is some or the stream has ended.
    ///
    /// An empty answer means **the end** — the distinction `Read.End` carries, and the reason this
    /// cannot simply answer what it has: a reader that got nothing and treated it as the end would
    /// stop at the first moment the writer was slow.
    pub fn read(&self) -> Vec<u8> {
        let mut inner = self.inner.lock().unwrap();
        loop {
            if !inner.bytes.is_empty() {
                let taken: Vec<u8> = inner.bytes.drain(..).collect();
                drop(inner);
                // Room, so a writer parked on a full queue may carry on — notified before returning,
                // because the alternative is a producer left asleep with an empty queue in front of it.
                self.ready.notify_all();
                return taken;
            }
            if inner.done {
                return Vec::new();
            }
            inner = self.ready.wait(inner).unwrap();
        }
    }
}
