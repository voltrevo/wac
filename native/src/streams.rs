//! Byte queues between a parent and a child, and the table of handles that names them.
//!
//! Item 5 of wac-mono 0087. A spawned child is a second wasm instance on its own thread, and the only
//! things that cross between the two are bytes: what the parent `send`s becomes the child's standard
//! input, what the child writes comes back through `recv`, and `exitCode` answers when it is over.
//!
//! ## Why a queue rather than a pipe
//!
//! An operating system pipe would work and would be worse in one specific way: `platform.wac` gives a
//! child *two* output handles, because a program has two streams and merging them is a bug it names —
//! "a shell running `cat nosuch | wc -c` counted the error message". Two pipes plus a reader thread
//! each is more machinery than two `VecDeque`s behind a mutex, and buys nothing here, since both ends
//! are threads in this process rather than processes.
//!
//! ## The one rule that is not obvious
//!
//! **Closing the write end and closing the read end are different things**, and the wac side uses both:
//! `closeFeed` ends a child's input without stopping it — `wc` must see the end while still alive —
//! and `closeSocket` stops it outright. So a queue carries a flag for "no more will be written" and
//! separately can be abandoned by its reader.
//!
//! ## And a queue has a bottom
//!
//! A `write` into a queue nobody is draining **waits**, exactly as writing to a full pipe does. This
//! was unbounded until `packages/platform/example/feed.wac` asked both hosts the same question: a
//! child writing nine megabytes into a parent that would not read for 300ms finished immediately
//! here and had to wait on every JavaScript host, whose `ByteQueue` has held a cap since it existed.
//! A producer that never waits is a producer whose output is held entirely in memory, and `box yes`
//! writes for ever by design.
//!
//! The cap is `CAP` below, and it is the *same eight megabytes* `host/children.ts` uses, because a
//! program that behaves differently on two hosts because their buffers differ is the thing this
//! whole layer exists to prevent. Only capped queues wait: `finish` wakes every waiting writer, so a
//! reader that goes away turns a wait into `false` rather than a wedge.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

/// How much may sit in a queue nobody is reading before a writer has to wait.
///
/// `host/children.ts`'s `QUEUE_CAP`, to the byte. The two numbers are the same fact about how much a
/// program may run ahead of its reader, and a difference between them would be a difference in
/// behaviour between two hosts running the same program.
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
    /// Whether a writer must wait for room. False for the queues where waiting would deadlock —
    /// see `uncapped`.
    capped: bool,
}

impl Stream {
    /// A queue that makes a writer wait once it holds `CAP` bytes: a child's two output streams.
    pub fn capped() -> Self {
        Self { capped: true, ..Self::default() }
    }

    /// A queue with no bottom, for the two directions where a wait would be a deadlock rather than
    /// backpressure.
    ///
    /// **The filesystem channel**, both ways: a child asks and its parent answers on the same thread
    /// that would be waiting for room, so a full request queue would stop the only thing that could
    /// drain it. And **a child's standard input**, which `host/children.ts` also leaves uncapped —
    /// the parent decides how much to send and can stop, which is not true of a child that writes.
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
            // The reader has gone, or the writer already ended it. False is what `write` answers to a
            // closed pipe, and what a program like `yes` is written to notice.
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
    /// An empty answer means **the end**, which is the distinction `Read.End` carries and the reason
    /// this cannot simply answer what it has: a reader that got nothing and treated it as the end
    /// would stop at the first moment the writer was slow.
    pub fn read(&self) -> Vec<u8> {
        let mut inner = self.inner.lock().unwrap();
        loop {
            if !inner.bytes.is_empty() {
                let taken: Vec<u8> = inner.bytes.drain(..).collect();
                // Room, so a writer parked on a full queue may carry on. Notified while holding the
                // lock and before returning, because the alternative is a producer left asleep with
                // an empty queue in front of it.
                drop(inner);
                self.ready.notify_all();
                return taken;
            }
            if inner.done {
                return Vec::new();
            }
            inner = self.ready.wait(inner).unwrap();
        }
    }

    /// What is there, without waiting. None when nothing is there *and* the stream is still open.
    pub fn take_now(&self) -> Option<Vec<u8>> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.bytes.is_empty() {
            let taken: Vec<u8> = inner.bytes.drain(..).collect();
            drop(inner);
            self.ready.notify_all();
            return Some(taken);
        }
        if inner.done {
            return Some(Vec::new());
        }
        None
    }
}

/// What a child's exit status is, once it has one.
#[derive(Default)]
pub struct Exit {
    code: Mutex<Option<i32>>,
    over: Condvar,
}

impl Exit {
    pub fn set(&self, code: i32) {
        *self.code.lock().unwrap() = Some(code);
        self.over.notify_all();
    }

    pub fn wait(&self) -> i32 {
        let mut code = self.code.lock().unwrap();
        while code.is_none() {
            code = self.over.wait(code).unwrap();
        }
        code.unwrap()
    }
}
