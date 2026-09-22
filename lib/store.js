// Tiny Redis client over the Upstash REST API (no npm packages needed).
// On Vercel: add "Upstash for Redis" from the Storage tab — it sets the env vars for you.
// Works with any prefix Vercel adds (KV_…, STORAGE_KV_…, UPSTASH_REDIS_…, etc).
function findEnv(suffixes) {
  const keys = Object.keys(process.env);
  for (const s of suffixes) { const k = keys.find(k => k === s) || keys.find(k => k.endsWith("_" + s)); if (k && process.env[k]) return process.env[k]; }
  return null;
}
const URL_ = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "REDIS_REST_URL", "REST_API_URL"]);
const TOKEN = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "REDIS_REST_TOKEN", "REST_API_TOKEN"]);

const configured = !!(URL_ && TOKEN);
// Names only (never values) — shown in the error message to help setup.
const seenKeys = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k));

async function rest(path, body) {
  const r = await fetch(URL_ + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Database error " + r.status);
  return r.json();
}

// ---- in-memory fallback, for running on your own computer only ----
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
  if (!configured) return memCmd(args.map(String));
  const j = await rest("", args.map(String));
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function pipeline(cmds) {
  if (!configured) return cmds.map(c => memCmd(c.map(String)));
  const j = await rest("/pipeline", cmds.map(c => c.map(String)));
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

module.exports = { cmd, pipeline, configured, seenKeys };
