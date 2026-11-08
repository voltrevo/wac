// client/qr.wac against qrcode.react, module for module: invite links and other texts of many lengths, each
// encoded by both — qrcode.react's QRCodeSVG at autonag's settings, rendered and read back from its path — and compared.
//
//     cd <a directory with qrcode.react@4, react@18 and react-dom@18 installed> && node <here>/check_qr.ts …
// (run by hand; see README)
import { createRequire } from "module";
import { execFileSync } from "child_process";
const require = createRequire(process.cwd() + "/");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { QRCodeSVG } = require("qrcode.react");

function reference(value: string): string {
  const svg = renderToStaticMarkup(React.createElement(QRCodeSVG, { value, size: 200 }));
  const n = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
  const rows = Array.from({ length: n }, () => Array(n).fill("0"));
  const d = /<path fill="#000000" d="([^"]+)"/.exec(svg)![1];
  for (const m of d.matchAll(/M(\d+)[ ,](\d+) ?h(\d+)/g)) {
    const x = Number(m[1]), y = Number(m[2]), len = Number(m[3]);
    for (let i = 0; i < len; i++) rows[y][x + i] = "1";
  }
  return rows.map(r => r.join("")).join("\n") + "\n";
}

const texts: string[] = ["https://app2.autonag.com?join=00000000-0000-4000-8000-000000000004", "a", "hello world", "Ünï 😀"];
let s = 7;
for (let len = 1; len < 400; len += 1 + (len >> 3)) {
  let t = "";
  for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; t += String.fromCharCode(97 + (s % 26)); }
  texts.push(t);
}
const wac = execFileSync(process.env.WAC ?? "wac", ["run", "tools/qr_modules.wac", ...texts], { cwd: process.env.ROOT ?? ".", maxBuffer: 1 << 26 }).toString();
const ours = wac.split("\n\n").map(x => x.endsWith("\n") ? x : x + "\n");
let bad = 0;
texts.forEach((t, i) => {
  if (ours[i] !== reference(t)) { bad++; if (bad <= 3) console.log(`differs for length ${t.length}: ${JSON.stringify(t.slice(0, 40))}\nours:\n${ours[i]}\nref:\n${reference(t)}`); }
});
console.log(`${texts.length - bad} of ${texts.length} agree`);
process.exit(bad === 0 ? 0 : 1);
