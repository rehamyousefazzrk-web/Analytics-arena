// Run locally: node dev-server.js  → http://localhost:3000 (uses in-memory data)
const http = require("http"), fs = require("fs"), path = require("path");
const handler = require("./api/game.js");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/game")) return handler(req, res);
  let f = u.pathname === "/" ? "/index.html" : u.pathname;
  if (!path.extname(f)) f += ".html";
  const fp = path.join(__dirname, path.normalize(f));
  if (!fp.startsWith(__dirname) || !fs.existsSync(fp)) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", types[path.extname(fp)] || "application/octet-stream");
  fs.createReadStream(fp).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log("Analytics Arena on http://localhost:" + (process.env.PORT || 3000)));
