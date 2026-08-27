// **The whole ladder, in Rust.**
//
//   a wac program
//     -> the wac-L5 compiler, a wac-L4 program
//       -> the wac-L4 compiler, a wac-L3 program
//         -> the wac-L3 compiler, a wac-L2 program
//           -> the wac-L2 compiler, a wac-L1 program
//             -> wac-L1, hand-written wac-L0
//               -> the assembler, and V8
//
// `ts/` does the same thing through Deno. Two hosts rather than one is the same argument the two
// assemblers make: a rung that only runs under one engine is a rung whose behaviour nobody has
// checked, and the differences that matter — does this module validate, does that trap — belong
// to the engine rather than to us.
//
// **The one line of JavaScript is `new WebAssembly.Instance`**, because that is a JS constructor
// and V8's C++ embedding API exposes no equivalent. Everything else — the bytes in, the text out,
// the calls — is Rust reaching into the module's memory directly.

use std::path::PathBuf;

mod flatten;

/// Where a compiler rung expects its source and leaves its output, in its own linear memory.
struct Seam {
    src: usize,
    out: usize,
}

const SMALL: Seam = Seam { src: 2097152, out: 1572864 };
const L5: Seam = Seam { src: 16777216, out: 4194304 };

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn read(rel: &str) -> String {
    let p = root().join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// A module, instantiated, with its exports in hand.
struct Module<'s> {
    exports: v8::Local<'s, v8::Object>,
}

impl<'s> Module<'s> {
    fn new(scope: &mut v8::PinScope<'s, '_>, wasm: Vec<u8>) -> Module<'s> {
        let store = v8::ArrayBuffer::new_backing_store_from_vec(wasm).make_shared();
        let buf = v8::ArrayBuffer::with_backing_store(scope, &store);
        let global = scope.get_current_context().global(scope);
        let key = v8::String::new(scope, "__wasm").unwrap();
        global.set(scope, key.into(), buf.into()).unwrap();

        let src = v8::String::new(
            scope,
            "new WebAssembly.Instance(new WebAssembly.Module(__wasm)).exports",
        )
        .unwrap();
        let script = v8::Script::compile(scope, src, None).expect("the engine refused the module");
        let out = script.run(scope).expect("the engine refused to instantiate");
        Module { exports: out.try_into().expect("exports is not an object") }
    }

    fn func(&self, scope: &mut v8::PinScope<'s, '_>, name: &str) -> v8::Local<'s, v8::Function> {
        let key = v8::String::new(scope, name).unwrap();
        let v = self.exports.get(scope, key.into()).unwrap_or_else(|| panic!("no export {name}"));
        v.try_into().unwrap_or_else(|_| panic!("{name} is not a function"))
    }

    fn call(&self, scope: &mut v8::PinScope<'s, '_>, name: &str, args: &[i32]) -> i32 {
        let f = self.func(scope, name);
        let vals: Vec<v8::Local<v8::Value>> =
            args.iter().map(|a| v8::Integer::new(scope, *a).into()).collect();
        let recv: v8::Local<v8::Value> = self.exports.into();
        let out = f.call(scope, recv, &vals).expect("the module trapped");
        out.int32_value(scope).expect("not a number")
    }

    /// **Taken fresh every time.** Growing the memory detaches the `ArrayBuffer` a caller was
    /// holding, so a pointer read before a call is dangling after one that allocated.
    fn memory(&self, scope: &mut v8::PinScope<'s, '_>) -> (*mut u8, usize) {
        let key = v8::String::new(scope, "memory").unwrap();
        let mem: v8::Local<v8::Object> =
            self.exports.get(scope, key.into()).unwrap().try_into().expect("no memory export");
        let key = v8::String::new(scope, "buffer").unwrap();
        let buf: v8::Local<v8::ArrayBuffer> =
            mem.get(scope, key.into()).unwrap().try_into().expect("memory has no buffer");
        (buf.data().expect("detached").as_ptr() as *mut u8, buf.byte_length())
    }

    fn write(&self, scope: &mut v8::PinScope<'s, '_>, at: usize, bytes: &[u8]) {
        let (p, n) = self.memory(scope);
        assert!(at + bytes.len() + 1 <= n, "the source does not fit in the module's memory");
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p.add(at), bytes.len());
            *p.add(at + bytes.len()) = 0;
        }
    }

    fn read_len(&self, scope: &mut v8::PinScope<'s, '_>, at: usize, len: usize) -> String {
        let (p, _) = self.memory(scope);
        let s = unsafe { std::slice::from_raw_parts(p.add(at), len) };
        String::from_utf8_lossy(s).into_owned()
    }

    /// wac-L1 answers an address rather than a length: the text there runs to a NUL.
    fn read_cstr(&self, scope: &mut v8::PinScope<'s, '_>, at: usize) -> String {
        let (p, n) = self.memory(scope);
        let all = unsafe { std::slice::from_raw_parts(p, n) };
        let end = all[at..].iter().position(|b| *b == 0).map(|k| at + k).unwrap_or(n);
        String::from_utf8_lossy(&all[at..end]).into_owned()
    }
}

fn assemble(text: &str) -> Vec<u8> {
    wax::assemble(text).unwrap_or_else(|e| panic!("wax: {}", e.0))
}

/// Run a wac-L1 program under the hand-written interpreter, and read the text it answers.
fn l1_text(scope: &mut v8::PinScope, source: &str) -> String {
    let sx = Module::new(scope, assemble(&read("boot/l1.l0")));
    const AT: usize = 8192;
    sx.write(scope, AT, source.as_bytes());
    let answer = sx.call(scope, "run_at", &[AT as i32]);
    sx.read_cstr(scope, answer as usize)
}

/// Every rung above wac-L2 has the same seam: source at one address, `compile` answers a length.
fn compile_with(scope: &mut v8::PinScope, compiler_l0: &str, seam: &Seam, program: &str) -> String {
    let m = Module::new(scope, assemble(compiler_l0));
    m.write(scope, seam.src, program.as_bytes());
    let len = m.call(scope, "compile", &[seam.src as i32, seam.out as i32]);
    m.read_len(scope, seam.out, len as usize)
}

fn l2_to_l0(scope: &mut v8::PinScope, program: &str) -> String {
    let compiler = read("boot/l2.l1");
    l1_text(scope, &format!("{compiler}\n(compile (quote ({program})))\n"))
}

fn l3_to_l0(scope: &mut v8::PinScope, program: &str) -> String {
    let c = l2_to_l0(scope, &read("boot/l3.l2"));
    compile_with(scope, &c, &SMALL, program)
}

fn l4_to_l0(scope: &mut v8::PinScope, program: &str) -> String {
    let c = l3_to_l0(scope, &read("boot/l4.l3"));
    compile_with(scope, &c, &SMALL, program)
}

/// The wac-L5 compiler as wac-L0 text — every rung below it, run.
fn l5_compiler_l0(scope: &mut v8::PinScope) -> String {
    l4_to_l0(scope, &read("boot/l5.l4"))
}

fn l5_to_l0(scope: &mut v8::PinScope, program: &str) -> String {
    let c = l5_compiler_l0(scope);
    compile_with(scope, &c, &L5, program)
}

/// **The three phases, timed apart.** Building the ladder is paid once per process; compiling and
/// assembling are paid per program, and the assemble is not free — it is a third of the work on a
/// program the size of wacc, because it is the step that turns 183,861 lines of text into bytes.
///
/// One cold run per process, and no averaging. The ladder is built from the interpreter every
/// time, so a second run in the same process would measure a warm V8 rather than the thing.
fn bench(scope: &mut v8::PinScope, path: &str, already_flat: bool) {
    let program = if already_flat {
        std::fs::read_to_string(path).expect("cannot read the program")
    } else {
        flatten::flatten(std::path::Path::new(path)).unwrap_or_else(|e| panic!("{e}"))
    };
    let t0 = std::time::Instant::now();

    let compiler_l0 = l5_compiler_l0(scope);
    let compiler = Module::new(scope, assemble(&compiler_l0));
    let built = t0.elapsed();

    let t1 = std::time::Instant::now();
    compiler.write(scope, L5.src, program.as_bytes());
    let len = compiler.call(scope, "compile", &[L5.src as i32, L5.out as i32]);
    let l0 = compiler.read_len(scope, L5.out, len as usize);
    let compiled = t1.elapsed();

    let t2 = std::time::Instant::now();
    let wasm = assemble(&l0);
    let assembled = t2.elapsed();

    let lines = program.lines().count();
    println!("host                    rust, v8 embedded");
    println!("input                   {path}");
    println!("                        {lines} lines of wac");
    println!();
    println!("build the ladder        {:>6} ms   l1.l0 -> L2 -> L3 -> L4 -> L5, assembled and instantiated", built.as_millis());
    println!("compile to wac-L0       {:>6} ms   {} lines out", compiled.as_millis(), l0.lines().count());
    println!("assemble to wasm        {:>6} ms   {} bytes", assembled.as_millis(), wasm.len());
    println!("                        ---------");
    println!("total                   {:>6} ms", (built + compiled + assembled).as_millis());
}

/// V8's platform is process-wide and may be initialised once. A test binary runs its tests on
/// several threads, so the guard is not a nicety.
fn start_v8() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: ladder <file.wac> [--l0 | --bench | -o <out.wasm>]");
        eprintln!("  default   compile and run `main`");
        eprintln!("  --l0      print the wac-L0 instead");
        eprintln!("  --bench   time the three phases, one cold run");
        eprintln!("  -o FILE   write the wasm module");
        eprintln!("  --flat    the file is already one program; do not resolve imports");
        eprintln!("  --dump-flat  print the flattened program and stop");
        std::process::exit(2);
    }
    let want_l0 = args.iter().any(|a| a == "--l0");
    // **Flattened unless told not to.** A wac program is a module graph, and the ladder takes one
    // program — so the host resolves the imports, exactly as the JavaScript hosts do. `--flat`
    // says the file is already whole, which is what the benchmark wants.
    let already_flat = args.iter().any(|a| a == "--flat");
    let want_bench = args.iter().any(|a| a == "--bench");
    let out_path = args.iter().position(|a| a == "-o").and_then(|i| args.get(i + 1)).cloned();

    start_v8();
    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let handle_scope, isolate);
    let context = v8::Context::new(handle_scope, Default::default());
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    if want_bench {
        bench(scope, &args[0], already_flat);
        return;
    }
    let program = if already_flat {
        std::fs::read_to_string(&args[0]).expect("cannot read the program")
    } else {
        flatten::flatten(std::path::Path::new(&args[0])).unwrap_or_else(|e| panic!("{e}"))
    };
    if args.iter().any(|a| a == "--dump-flat") {
        print!("{program}");
        return;
    }
    let started = std::time::Instant::now();
    let l0 = l5_to_l0(scope, &program);
    let refusals = l0.lines().filter(|l| l.starts_with("!!")).count();

    if want_l0 {
        print!("{l0}");
        return;
    }
    if refusals == 0 {
        if let Some(path) = out_path {
            std::fs::write(&path, assemble(&l0)).expect("cannot write the module");
            return;
        }
    }
    if refusals > 0 {
        eprintln!("wac-L5 refused {refusals} things");
        for l in l0.lines().filter(|l| l.starts_with("!!")).take(5) {
            eprintln!("  {l}");
        }
        std::process::exit(1);
    }
    let m = Module::new(scope, assemble(&l0));
    let answer = m.call(scope, "main", &[]);
    println!("main() = {answer}   ({} ms)", started.elapsed().as_millis());
}


#[cfg(test)]
mod tests {
    use super::*;

    /// **One test, not several.** Every rung is built from the one below, so a test per rung would
    /// rebuild the whole ladder per rung — and V8's isolate is not cheap to stand up either. The
    /// programs are chosen to reach the parts of wac-L5 a rung below cannot express: wasm GC
    /// structs, an enum with payloads, `match`, string concatenation, a filled array.
    #[test]
    fn the_ladder_runs_under_v8() {
        start_v8();
        let isolate = &mut v8::Isolate::new(Default::default());
        v8::scope!(let handle_scope, isolate);
        let context = v8::Context::new(handle_scope, Default::default());
        let scope = &mut v8::ContextScope::new(handle_scope, context);

        // Each rung on its own terms first, so a failure names the rung rather than the ladder.
        let l0 = l2_to_l0(scope, "(fn main () i32 (+ 40 2)) (export main)");
        let m = Module::new(scope, assemble(&l0));
        assert_eq!(m.call(scope, "main", &[]), 42, "wac-L2");

        let l0 = l3_to_l0(scope, "i32 main() { i32 n = 20; return n + n + 2; }");
        let m = Module::new(scope, assemble(&l0));
        assert_eq!(m.call(scope, "main", &[]), 42, "wac-L3");

        let l0 = l4_to_l0(
            scope,
            "struct P { i32 x; }\ni32 main() { P p = P(40); return p.x + 2; }",
        );
        let m = Module::new(scope, assemble(&l0));
        assert_eq!(m.call(scope, "main", &[]), 42, "wac-L4");

        let src = "enum S { Dot(i32 v), Pair(i32 a, i32 b) }\n\
                   i32 span(S s) { match (s) { case Dot(v): { return v; } \
                   case Pair(a, b): { return b - a; } } return 0; }\n\
                   i32 main() { string t = \"ab\" + \"cd\"; i32[] ns = i32[3](fill: 7); \
                   return span(S.Pair(1, 32)) + t.len() + ns[2]; }";
        let l0 = l5_to_l0(scope, src);
        assert_eq!(l0.lines().filter(|l| l.starts_with("!!")).count(), 0, "wac-L5 refused something");
        let m = Module::new(scope, assemble(&l0));
        assert_eq!(m.call(scope, "main", &[]), 42, "wac-L5");
    }
}
