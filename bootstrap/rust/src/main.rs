//! `wax <in.wax> <out.wasm>` — the assembler as a command, so the differential can run it.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: wax <in.wax> <out.wasm>");
        return ExitCode::from(2);
    }
    let source = match std::fs::read_to_string(&args[1]) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("wax: cannot read {}: {}", args[1], e);
            return ExitCode::from(2);
        }
    };
    match wax::assemble(&source) {
        Ok(bytes) => match std::fs::write(&args[2], bytes) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("wax: cannot write {}: {}", args[2], e);
                ExitCode::from(2)
            }
        },
        Err(e) => {
            eprintln!("wax: {}: {}", args[1], e);
            ExitCode::from(1)
        }
    }
}
