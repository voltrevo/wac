#!/usr/bin/env node
// Node's `http` client, behind a command line.
//
// **A second, independent client.** A response that only Deno's `fetch` accepts might be one Deno is
// being generous about; one that two implementations accept is a response. That is the whole reason
// this file exists, and the reason it stays JavaScript — it is half of the differential rather than
// harness around it.
//
//   nodeclient.js <port> <path>...
//
// One line per path: `<status> <tab> <content-type or -> <tab> <body length>`. A request that fails
// prints `ERR` and the message, because a client refusing a response is itself an answer.

const http = require("node:http");

const [port, ...paths] = process.argv.slice(2);

(async () => {
  const out = [];
  for (const path of paths) {
    try {
      const line = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: Number(port), path, method: "GET" },
          (res) => {
            let body = "";
            res.on("data", (c) => body += c);
            res.on("end", () =>
              resolve(`${res.statusCode}\t${res.headers["content-type"] ?? "-"}\t${body.length}`)
            );
          },
        );
        req.on("error", reject);
        req.end();
      });
      out.push(line);
    } catch (e) {
      out.push(`ERR\t-\t${String(e && e.message ? e.message : e)}`);
    }
  }
  process.stdout.write(out.join("\n") + "\n");
})().catch((e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
