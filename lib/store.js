// Database layer — no npm packages needed.
// Supports:  1) Vercel "Redis" (REDIS_URL, plain Redis protocol)
//            2) Upstash REST (KV_REST_API_URL + KV_REST_API_TOKEN), any prefix
//            3) in-memory fallback for running on your own computer
const net = require("net");
const tls = require("tls");

function findEnv(suffixes) {
  const keys = Object.keys(process.env);
  for (const s of suffixes) { const k = keys.find(k => k === s) || keys.find(k => k.endsWith("_" + s)); if (k && process.env[k]) return process.env[k]; }
  return null;
}
const REST_URL = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "REDIS_REST_URL", "REST_API_URL"]);
const REST_TOKEN = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "REDIS_REST_TOKEN", "REST_API_TOKEN"]);
const REDIS_URL = findEnv(["REDIS_URL", "KV_URL"]);
const mode = REDIS_URL ? "tcp" : REST_URL && REST_TOKEN ? "rest" : "memory";
const configured = mode !== "memory";

/* ---------------- tiny Redis protocol (RESP) client ---------------- */
function encode(args) {
  let out = "*" + args.length + "\r\n";
  for (const a of args) { const s = String(a); out += "$" + Buffer.byteLength(s) + "\r\n" + s + "\r\n"; }
  return out;
}
// Parses one reply from buf at pos. Returns [value, newPos] or null if incomplete.
function parse(buf, pos) {
  if (pos >= buf.length) return null;
  const type = String.fromCharCode(buf[pos]);
  const eol = buf.indexOf("\r\n", pos);
  if (eol < 0) return null;
  const line = buf.toString("utf8", pos + 1, eol);
  let p = eol + 2;
  if (type === "+") return [line, p];
  if (type === "-") return [new Error(line), p];
  if (type === ":") return [Number(line), p];
  if (type === "$") {
    const n = Number(line); if (n < 0) return [null, p];
    if (buf.length < p + n + 2) return null;
    return [buf.toString("utf8", p, p + n), p + n + 2];
  }
  if (type === "*") {
    const n = Number(line); if (n < 0) return [null, p];
    const arr = [];
    for (let i = 0; i < n; i++) { const r = parse(buf, p); if (!r) return null; arr.push(r[0]); p = r[1]; }
    return [arr, p];
  }
  return [new Error("Bad reply"), buf.length];
}

let conn = null;
function connect() {
  if (conn) return conn;
  const u = new URL(REDIS_URL);
  const secure = u.protocol === "rediss:";
  const opts = { host: u.hostname, port: Number(u.port || 6379), servername: u.hostname };
  conn = new Promise((resolve, reject) => {
    const sock = secure ? tls.connect(opts) : net.connect(opts);
    const state = { sock, buf: Buffer.alloc(0), queue: [] };
    const fail = err => { state.queue.splice(0).forEach(q => q.reject(err)); conn = null; };
    sock.setNoDelay(true);
    sock.setTimeout(10000, () => sock.destroy(new Error("Redis timeout")));
    sock.on("data", chunk => {
      state.buf = Buffer.concat([state.buf, chunk]);
      let pos = 0;
      while (state.queue.length) { const r = parse(state.buf, pos); if (!r) break; pos = r[1]; const q = state.queue.shift(); r[0] instanceof Error ? q.reject(r[0]) : q.resolve(r[0]); }
      state.buf = state.buf.subarray(pos);
    });
    sock.on("error", e => { fail(e); reject(e); });
    sock.on("close", () => fail(new Error("Redis connection closed")));
    sock.once(secure ? "secureConnect" : "connect", async () => {
      sock.setTimeout(0);
      const send = args => new Promise((res, rej) => { state.queue.push({ resolve: res, reject: rej }); sock.write(encode(args)); });
      state.send = send;
      try {
        const user = decodeURIComponent(u.username || ""), pass = decodeURIComponent(u.password || "");
        if (pass) await send(user ? ["AUTH", user, pass] : ["AUTH", pass]);
        resolve(state);
      } catch (e) { reject(e); conn = null; sock.destroy(); }
    });
  });
  conn.catch(() => { conn = null; });
  return conn;
}

/* ---------------- Upstash REST ---------------- */
async function rest(path, body) {
  const r = await fetch(REST_URL + path, { method: "POST", headers: { Authorization: "Bearer " + REST_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Database error " + r.status);
  return r.json();
}

/* ---------------- in-memory fallback ---------------- */
const mem = new Map();
function memCmd([op, key, ...args]) {
  op = op.toUpperCase();
  if (op === "GET") return mem.has(key) ? mem.get(key) : null;
  if (op === "SET") { mem.set(key, args[0]); return "OK"; }
  if (op === "DEL") { let n = 0; [key, ...args].forEach(k => { if (mem.delete(k)) n++; }); return n; }
  if (op === "HSET") { const h = mem.get(key) || {}; for (let i = 0; i < args.length; i += 2) h[args[i]] = String(args[i + 1]); mem.set(key, h); return 1; }
  if (op === "HDEL") { const h = mem.get(key) || {}; args.forEach(f => delete h[f]); return 1; }
  if (op === "HGETALL") { const h = mem.get(key) || {}; return Object.entries(h).flat(); }
  throw new Error("unsupported " + op);
}

async function cmd(...args) {
  args = args.map(String);
  if (mode === "memory") return memCmd(args);
  if (mode === "tcp") { const c = await connect(); return c.send(args); }
  const j = await rest("", args); if (j.error) throw new Error(j.error); return j.result;
}
async function pipeline(cmds) {
  cmds = cmds.map(c => c.map(String));
  if (mode === "memory") return cmds.map(memCmd);
  if (mode === "tcp") { const c = await connect(); return Promise.all(cmds.map(x => c.send(x))); }
  const j = await rest("/pipeline", cmds);
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

module.exports = { cmd, pipeline, configured, mode };
