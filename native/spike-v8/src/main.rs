// Does V8, driven from Rust with no JavaScript host layer, run a WasmGC module at Deno's speed?
//
//   v8try <module.wasm> <export> <iterations>
//
// The point is the *engine*, not the embedding: if this matches Deno's number then a Rust host on
// rusty_v8 keeps V8's speed while dropping the TypeScript layer, which is the question in
// design/lang/0003.

use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: v8try <module.wasm> <export> <iterations>");
        std::process::exit(2);
    }
    let wasm = std::fs::read(&args[1]).expect("read module");
    let n: i32 = args[3].parse().expect("iterations");

    let platform = v8::new_default_platform(0, false).make_shared();
    v8::V8::initialize_platform(platform);
    v8::V8::initialize();

    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let handle_scope, isolate);
    let context = v8::Context::new(handle_scope, Default::default());
    let scope = &v8::ContextScope::new(handle_scope, context);

    // Compile with V8's own API — no JavaScript involved in getting the module in.
    let t = Instant::now();
    let module = v8::WasmModuleObject::compile(scope, &wasm).expect("compile");
    let compile = t.elapsed();

    // Instantiation is the one place a little JavaScript is unavoidable: `WebAssembly.Instance` is a
    // JS constructor and V8 exposes no C++ equivalent. Six lines, and nothing of the program runs in
    // it — every call below goes straight to an exported wasm function.
    let global = context.global(scope);
    let key = v8::String::new(scope, "__mod").unwrap();
    global.set(scope, key.into(), module.into()).unwrap();
    let src = v8::String::new(scope, "new WebAssembly.Instance(__mod, {}).exports").unwrap();
    let script = v8::Script::compile(scope, src, None).expect("compile js");
    let exports = script.run(scope).expect("instantiate").to_object(scope).unwrap();

    let name = v8::String::new(scope, &args[2]).unwrap();
    let f: v8::Local<v8::Function> = exports.get(scope, name.into()).unwrap().try_into().expect("export");

    let warm = v8::Integer::new(scope, 1000);
    f.call(scope, exports.into(), &[warm.into()]).unwrap();

    let arg = v8::Integer::new(scope, n);
    let t = Instant::now();
    let r = f.call(scope, exports.into(), &[arg.into()]).unwrap();
    let elapsed = t.elapsed();
    println!(
        "{:<16} {:.2}s  ({})   [module compile {:.2}s]",
        args[2],
        elapsed.as_secs_f64(),
        r.to_int32(scope).unwrap().value(),
        compile.as_secs_f64()
    );
}
