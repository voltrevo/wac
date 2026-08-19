// A Node HTTP server, for the diagonal that tests our response *parser*.
//
// **This is the oracle, not the test.** Deliberately not Deno's `serve`: a second *implementation*,
// not a second instance. None of the responses below was written to please our parser — Node picks
// chunked for `/chunked` because it does not know the length in advance, and that is the coding path
// exercised by a server that chose it rather than by a test that asked for it.
//
// It stays JavaScript because that is what it is: `node:http` is the thing under comparison. What
// crosses this boundary is HTTP on a socket, and every assertion belongs to the wac side.
//
// Prints `{"port":N}` on standard output once bound, because it is asked for port 0 — two agents
// running the suite at once cannot collide on a number neither of them chose.
//
//   node packages/http/test/nodeserver.js

const http = require("node:http");

const server = http.createServer((req, res) => {
  if (req.url === "/plain") {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "5" });
    res.end("hello");
  } else if (req.url === "/chunked") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("chun");
    res.write("ked");
    res.end();
  } else if (req.url === "/empty") {
    res.writeHead(204);
    res.end();
  } else if (req.url === "/close") {
    // No Content-Length and no chunking: the body is whatever arrives before the close. Written
    // straight onto the socket, because Node's own API will not produce this: writeHead does not
    // flush until write or end, and either of those adds a framing header.
    res.socket.write(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nuntil close",
    );
    res.socket.end();
  } else if (req.url === "/headers") {
    res.writeHead(200, { "X-One": "1", "X-Two": "2", "Content-Length": "0" });
    res.end();
  } else if (req.url === "/echo-method") {
    res.writeHead(200, { "Content-Length": String(req.method.length) });
    res.end(req.method === "HEAD" ? undefined : req.method);
  } else {
    res.writeHead(404, { "Content-Length": "0" });
    res.end();
  }
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
});
