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

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

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
}

impl Stream {
    pub fn write(&self, bytes: &[u8]) -> bool {
        let mut inner = self.inner.lock().unwrap();
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
                return inner.bytes.drain(..).collect();
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
            return Some(inner.bytes.drain(..).collect());
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
