//! Driving the wacc the ladder built, from Rust.
//!
//! **Not through `$bind$`.** Every module *wacc* builds exports a binding layer, and the natural
//! move is to use it — but the wacc wac-L5 builds has none, because wac-L5 does not emit bindgen.
//! The first compiler in the chain is the one host that has to be driven without help.
//!
//! So it is driven the way `ts/selfhost.ts` drives it: a small wac driver is concatenated onto
//! wacc's flattened source before wac-L5 sees it, and every value crosses the boundary as an i32,
//! a byte at a time. That is the whole of what a wasm module can hand a host without a binding
//! layer — a GC reference cannot be constructed by a host and cannot cross out as anything a host
//! could rebuild.

/// A wacc module built by wac-L5, with `drivers/rust.wac` concatenated on.
pub struct Wacc<'s> {
    exports: v8::Local<'s, v8::Object>,
}

impl<'s> Wacc<'s> {
    pub fn new(scope: &mut v8::PinScope<'s, '_>, wasm: Vec<u8>) -> Wacc<'s> {
        let store = v8::ArrayBuffer::new_backing_store_from_vec(wasm).make_shared();
        let buf = v8::ArrayBuffer::with_backing_store(scope, &store);
        let global = scope.get_current_context().global(scope);
        let key = v8::String::new(scope, "__wacc").unwrap();
        global.set(scope, key.into(), buf.into()).unwrap();
        let src = v8::String::new(
            scope,
            "new WebAssembly.Instance(new WebAssembly.Module(__wacc)).exports",
        )
        .unwrap();
        let script = v8::Script::compile(scope, src, None).expect("the engine refused wacc");
        let out = script.run(scope).expect("the engine refused to instantiate wacc");
        Wacc { exports: out.try_into().expect("exports is not an object") }
    }

    fn call(&self, scope: &mut v8::PinScope<'s, '_>, name: &str, args: &[i32]) -> i32 {
        let key = v8::String::new(scope, name).unwrap();
        let f: v8::Local<v8::Function> = self
            .exports
            .get(scope, key.into())
            .unwrap_or_else(|| panic!("wacc exports no {name}"))
            .try_into()
            .unwrap_or_else(|_| panic!("{name} is not a function"));
        let vals: Vec<v8::Local<v8::Value>> =
            args.iter().map(|a| v8::Integer::new(scope, *a).into()).collect();
        let recv: v8::Local<v8::Value> = self.exports.into();
        f.call(scope, recv, &vals)
            .unwrap_or_else(|| panic!("wacc trapped in {name}"))
            .int32_value(scope)
            .unwrap_or(0)
    }

    fn feed(&self, scope: &mut v8::PinScope<'s, '_>, alloc: &str, put: &str, text: &str) {
        let b = text.as_bytes();
        self.call(scope, alloc, &[b.len() as i32]);
        for (i, byte) in b.iter().enumerate() {
            self.call(scope, put, &[i as i32, *byte as i32]);
        }
    }

    /// `emitFiles(paths, sources, entry)` — a whole program, compiled by wacc.
    pub fn emit_files(
        &self,
        scope: &mut v8::PinScope<'s, '_>,
        paths: &[String],
        sources: &[String],
        entry: &str,
    ) -> Vec<u8> {
        self.call(scope, "drv_files", &[paths.len() as i32]);
        for (p, src) in paths.iter().zip(sources) {
            self.feed(scope, "drv_alloc", "drv_setByte", src);
            self.feed(scope, "drv_allocName", "drv_setNameByte", p);
            self.call(scope, "drv_pushFile", &[]);
        }
        self.feed(scope, "drv_allocName", "drv_setNameByte", entry);
        let n = self.call(scope, "drv_buildFiles", &[]);
        (0..n).map(|i| self.call(scope, "drv_byteAt", &[i]) as u8).collect()
    }

    /// Why a linked build declined, or `""`.
    pub fn decline(&self, scope: &mut v8::PinScope<'s, '_>) -> String {
        let n = self.call(scope, "drv_declineFiles", &[]);
        let bytes: Vec<u8> = (0..n).map(|i| self.call(scope, "drv_declineByte", &[i]) as u8).collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}
