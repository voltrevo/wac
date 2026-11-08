// The CLI's help and tutorial, taken from autonag's shared/cli.ts so the port prints them byte for byte.
//
//     AUTONAG=../autonag bun tools/gen_texts.ts > src/cli/texts.wac
import { readFileSync } from "fs";
const root = process.env.AUTONAG ?? "../autonag";
const src = readFileSync(`${root}/shared/cli.ts`, "utf8");
function template(startMarker: string): string {
  const at = src.indexOf(startMarker);
  if (at < 0) throw new Error(`no ${startMarker}`);
  const open = src.indexOf("`", at);
  let i = open + 1;
  while (src[i] !== "`") { if (src[i] === "\\") i++; i++; }
  return eval(src.slice(open, i + 1));
}
const lit = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
console.log(`// The CLI's help and tutorial, generated from autonag's shared/cli.ts by tools/gen_texts.ts.\n`);
console.log(`export static string HELP = ${lit(template("const HELP ="))};\n`);
console.log(`export static string TUTORIAL = ${lit(template("function cmdTutorial"))};`);
