// One serverless function runs the whole game.
// GET  /api/game?pid=..            -> state for a player / the screen
// GET  /api/game?pin=..            -> full state for the host
// POST /api/game {a:"join"|"vote"|"submit"|"host", ...}
const C = require("../lib/content");
const store = require("../lib/store");

const P = "mc:";
const K = { state: P + "state", players: P + "players", rg: P + "rg", sub: P + "sub", score: P + "score" };
const HOST_PIN = String(process.env.HOST_PIN || "1234");
const GRACE_MS = 1500;

function defState() {
  return { v: 0, stage: { type: "lobby" }, teams: C.TEAMS.map(t => ({ ...t })), revealed: {}, boxAssign: {} };
}
function toObj(x) {
  if (!x) return {};
  if (Array.isArray(x)) { const o = {}; for (let i = 0; i < x.length; i += 2) o[x[i]] = x[i + 1]; return o; }
  return x;
}
function parseJ(o) { const r = {}; for (const k in o) { try { r[k] = JSON.parse(o[k]); } catch (e) { } } return r; }
function nums(o) { const r = {}; for (const k in o) r[k] = Number(o[k]) || 0; return r; }

let cache = null;
async function load(fresh) {
  if (!fresh && cache && Date.now() - cache.t < 700) return cache.d;
  const r = await store.pipeline([["GET", K.state], ["HGETALL", K.players], ["HGETALL", K.rg], ["HGETALL", K.sub], ["HGETALL", K.score]]);
  let st = defState();
  if (r[0]) { try { st = { ...st, ...JSON.parse(r[0]) }; } catch (e) { } }
  const d = { st, players: parseJ(toObj(r[1])), rg: toObj(r[2]), sub: parseJ(toObj(r[3])), score: nums(toObj(r[4])) };
  cache = { t: Date.now(), d };
  return d;
}
async function saveState(st) { st.v = (st.v || 0) + 1; await store.cmd("SET", K.state, JSON.stringify(st)); cache = null; }

/* ---------------- scoring ---------------- */
const Q = Object.fromEntries(C.RG.map(q => [q.id, q]));
function rgScores(d) {
  const s = {}; for (const pid in d.players) s[pid] = 0;
  for (const f in d.rg) {
    const [qid, pid] = f.split(":");
    if (d.st.revealed[qid] && Q[qid] && d.rg[f] === Q[qid].a && pid in s) s[pid] += (Q[qid].pts || 1);
  }
  return s;
}
function revealedCount(d) { return Object.keys(d.st.revealed).filter(k => Q[k]).reduce((n, k) => n + (Q[k].pts || 1), 0); }
const choices = q => q.type === "mcq" ? q.opts.map((_, i) => "ABCD"[i]) : ["R", "G"];
const autoDur = q => q.type === "mcq" ? (q.t.length > 110 ? 40 : 30) : 20;
function teamTotals(d) {
  const t = {}; d.st.teams.forEach(x => t[x.id] = { say: 0, box: 0, boss: 0, total: 0 });
  for (const f in d.score) {
    const p = f.split(":"); let tid, g;
    if (p[0] === "say") { g = "say"; tid = p[2]; } else if (p[0] === "box" || p[0] === "boss") { g = p[0]; tid = p[1]; } else continue;
    if (t[tid]) { t[tid][g] += d.score[f]; t[tid].total += d.score[f]; }
  }
  return t;
}
function individuals(d) {
  const rs = rgScores(d), possible = revealedCount(d);
  return Object.entries(d.players).map(([id, p]) => {
    const rg = rs[id] || 0, note = d.score["ind:note:" + id] || 0, re = Math.min(5, d.score["ind:reason:" + id] || 0), pa = Math.min(5, d.score["ind:part:" + id] || 0);
    return { id, name: p.name, team: p.team, emoji: p.emoji, rg, possible, note, re, pa, total: Math.round(((possible ? rg / possible : 0) * 40 + (note / 10) * 35 + (re / 5) * 15 + (pa / 5) * 10) * 10) / 10 };
  });
}
function votesFor(d, qid) {
  const c = {}; choices(Q[qid]).forEach(k => c[k] = 0); const by = {}; let n = 0;
  for (const f in d.rg) { const [q, pid] = f.split(":"); if (q === qid && d.players[pid] && d.rg[f] in c) { c[d.rg[f]]++; by[pid] = d.rg[f]; n++; } }
  return { c, by, n };
}
function roundQs(r) { return C.RG.filter(q => q.r === r); }

/* ---------------- views ---------------- */
function build(d, { pid, host }) {
  const st = d.st, stg = st.stage;
  const players = Object.entries(d.players).map(([id, p]) => ({ id, name: p.name, team: p.team, emoji: p.emoji }));
  const v = { ok: true, now: Date.now(), v: st.v, stage: stg, teams: st.teams, players, db: store.configured };
  let cur = null;
  if (stg.type === "rg") {
    const qs = roundQs(stg.round), R = C.ROUNDS[stg.round] || C.ROUNDS["1"];
    if (stg.phase === "summary") {
      const rs = rgScores(d);
      cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, takeaway: R.takeaway,
        items: qs.map(q => { const vv = votesFor(d, q.id); const ok = st.revealed[q.id]; return { t: q.t, type: q.type, a: ok ? q.a : null, pct: ok && vv.n ? Math.round((vv.c[q.a] || 0) / vv.n * 100) : null }; }),
        top: players.map(p => ({ ...p, s: rs[p.id] || 0 })).filter(p => p.s > 0).sort((a, b) => b.s - a.s).slice(0, 5), outOf: revealedCount(d) };
    } else {
      const q = qs[Math.min(stg.idx || 0, qs.length - 1)], vv = votesFor(d, q.id);
      cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, idx: stg.idx || 0, total: qs.length, qid: q.id, t: q.t, type: q.type, opts: q.opts || null, pts: q.pts || 1, voted: vv.n, of: players.length };
      if (stg.phase === "reveal") Object.assign(cur, { a: q.a, e: q.e, d: q.d, c: vv.c });
      if (stg.mic && d.players[stg.mic]) cur.mic = { name: d.players[stg.mic].name, emoji: d.players[stg.mic].emoji };
      if (host) cur.notVoted = players.filter(p => !vv.by[p.id]).map(p => p.id);
    }
  } else if (stg.type === "say") {
    const c = C.SAY.find(x => x.id === stg.c) || C.SAY[0];
    const subs = st.teams.map(t => ({ tid: t.id, s: d.sub["say:" + c.id + ":" + t.id] })).filter(x => x.s && x.s.text);
    cur = { id: c.id, pat: c.pat, submitted: subs.map(x => x.tid) };
    if (stg.phase === "reveal" || host) Object.assign(cur, { model: { human: c.human, humanAr: c.humanAr, meaning: c.meaning, action: c.action, variant: c.variant }, answers: subs.map(x => ({ tid: x.tid, text: x.s.text, by: x.s.by })) });
    if (!host && stg.phase !== "reveal") delete cur.model;
  } else if (stg.type === "box") {
    const pub = C.BOXES.map(b => ({ id: b.id, level: b.level, format: b.format, content: b.content, objective: b.objective, metrics: b.metrics, trap: b.trap }));
    cur = { assign: st.boxAssign, boxes: pub, submitted: st.teams.filter(t => d.sub["box:" + t.id]).map(t => t.id) };
    if (stg.phase === "reveal" || host) {
      cur.expected = Object.fromEntries(C.BOXES.map(b => [b.id, { primary: b.primary, secondary: b.secondary, diag: b.diag, why: b.why, ex: b.ex }]));
      cur.picks = Object.fromEntries(st.teams.map(t => [t.id, d.sub["box:" + t.id] || null]));
    }
  } else if (stg.type === "boss") {
    cur = { case: C.BOSS_CASE, drop: C.DROP_OPTIONS, qs: C.BOSS_Q.map(q => ({ q: q[0], pts: q[2], kind: q[3] })),
      submitted: st.teams.filter(t => d.sub["boss:" + t.id]).map(t => t.id),
      notes: Object.keys(d.sub).filter(k => k.startsWith("note:")).length };
    const tt = teamTotals(d); cur.dmg = Object.fromEntries(st.teams.map(t => [t.id, tt[t.id].boss]));
    const avg = st.teams.reduce((a, t) => a + tt[t.id].boss, 0) / Math.max(1, st.teams.length);
    cur.hp = Math.max(0, Math.round(100 - avg / C.MAX.boss * 100));
    const shown = host ? C.BOSS_Q.length - 1 : (stg.phase === "reveal" ? (stg.q ?? -1) : -1);
    cur.keys = C.BOSS_Q.map((q, i) => i <= shown ? q[1] : null);
    if (stg.phase === "reveal" || host) cur.sheets = Object.fromEntries(st.teams.map(t => [t.id, d.sub["boss:" + t.id] || null]));
  } else if (stg.type === "board") {
    const tt = teamTotals(d);
    cur = { max: C.MAX, rows: st.teams.map(t => ({ tid: t.id, name: t.name, ...tt[t.id] })).sort((a, b) => b.total - a.total), winner: !!stg.winner };
  }
  v.cur = cur;

  if (pid && d.players[pid]) {
    const p = d.players[pid], rs = rgScores(d), mine = rs[pid] || 0;
    const me = { id: pid, name: p.name, team: p.team, emoji: p.emoji, score: mine, outOf: revealedCount(d), rank: 1 + Object.values(rs).filter(x => x > mine).length };
    if (stg.type === "rg" && cur && cur.qid) { me.vote = d.rg[cur.qid + ":" + pid] || null; if (stg.phase === "reveal") me.correct = me.vote === cur.a; }
    if (stg.type === "say") me.teamSub = d.sub["say:" + cur.id + ":" + p.team] || null;
    if (stg.type === "box") { me.box = st.boxAssign[p.team] || null; me.teamSub = d.sub["box:" + p.team] || null; }
    if (stg.type === "boss") { me.teamSub = d.sub["boss:" + p.team] || null; me.note = d.sub["note:" + pid] || null; }
    v.me = me;
  } else if (pid) v.me = null;

  if (host) {
    v.host = { individuals: individuals(d), teamTotals: teamTotals(d), score: d.score, rubric: { say: C.SAY_RUBRIC, box: C.BOX_RUBRIC, boss: C.BOSS_Q.map(q => q[2]) },
      notes: Object.fromEntries(Object.keys(d.sub).filter(k => k.startsWith("note:")).map(k => [k.slice(5), d.sub[k].text])),
      rounds: C.ROUNDS, says: C.SAY.map(s => s.id), rgTotal: revealedCount(d),
      roundLens: Object.fromEntries(Object.keys(C.ROUNDS).map(r => [r, roundQs(r).length])) };
    if (stg.type === "rg" && cur && cur.qid) { const q = Q[cur.qid]; cur.a = q.a; cur.e = q.e; cur.d = q.d; cur.c = votesFor(d, q.id).c; }
  }
  return v;
}

/* ---------------- helpers ---------------- */
const clean = (s, n = 600) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
function send(res, code, obj) { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  let raw = ""; for await (const ch of req) raw += ch; return raw ? JSON.parse(raw) : {};
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const open = (stg, now) => !stg.endsAt || now <= stg.endsAt + GRACE_MS;

/* ---------------- handler ---------------- */
module.exports = async function handler(req, res) {
  try {
    if (!store.configured && process.env.VERCEL) return send(res, 503, { ok: false, error: "db", message: "Database not connected. In Vercel: Storage → Upstash for Redis → Connect to this project, then Redeploy." });
    const url = new URL(req.url, "http://x");
    if (req.method === "GET") {
      const pin = url.searchParams.get("pin");
      if (pin != null && pin !== HOST_PIN) return send(res, 403, { ok: false, error: "pin" });
      const d = await load(false);
      return send(res, 200, build(d, { pid: url.searchParams.get("pid"), host: pin === HOST_PIN }));
    }
    if (req.method !== "POST") return send(res, 405, { ok: false });
    const b = await readBody(req);
    const now = Date.now();

    if (b.a === "join") {
      const d = await load(true);
      const name = clean(b.name, 24); const team = d.st.teams.find(t => t.id === b.team) ? b.team : null;
      if (!name || !team) return send(res, 400, { ok: false, message: "Write your name and pick a team." });
      const pid = b.pid && d.players[b.pid] ? b.pid : Math.random().toString(36).slice(2, 10);
      const emoji = C.EMOJIS.includes(b.emoji) ? b.emoji : C.EMOJIS[0];
      await store.cmd("HSET", K.players, pid, JSON.stringify({ name, team, emoji, t: now }));
      cache = null;
      return send(res, 200, { ok: true, pid });
    }

    if (b.a === "vote") {
      const d = await load(true); const stg = d.st.stage;
      if (!d.players[b.pid]) return send(res, 404, { ok: false, error: "nop" });
      if (stg.type !== "rg" || stg.phase !== "vote" || !open(stg, now)) return send(res, 409, { ok: false, message: "Voting is closed." });
      if (stg.startsAt && now < stg.startsAt - 400) return send(res, 409, { ok: false, message: "Get ready…" });
      const q = roundQs(stg.round)[stg.idx || 0];
      if (!q || q.id !== b.qid || !choices(q).includes(b.v)) return send(res, 409, { ok: false, message: "That statement is over." });
      await store.cmd("HSET", K.rg, q.id + ":" + b.pid, b.v); cache = null;
      return send(res, 200, { ok: true });
    }

    if (b.a === "submit") {
      const d = await load(true); const stg = d.st.stage; const p = d.players[b.pid];
      if (!p) return send(res, 404, { ok: false, error: "nop" });
      if (!open(stg, now)) return send(res, 409, { ok: false, message: "Time's up — answers are locked." });
      let key, val; const x = b.data || {};
      if (stg.type === "say" && stg.phase === "answer") { key = "say:" + stg.c + ":" + p.team; val = { text: clean(x.text, 300), by: p.name }; }
      else if (stg.type === "box" && stg.phase === "answer") {
        const bid = d.st.boxAssign[p.team]; const box = C.BOXES.find(y => y.id === bid); if (!box) return send(res, 409, { ok: false, message: "Your team has no box yet." });
        const okm = m => box.metrics.includes(m) ? m : null;
        key = "box:" + p.team; val = { box: bid, primary: okm(x.primary), secondary: okm(x.secondary), diag: (Array.isArray(x.diag) ? x.diag : []).map(okm).filter(Boolean).slice(0, 6), why: clean(x.why, 300), by: p.name };
      }
      else if (stg.type === "boss" && stg.phase === "team") { key = "boss:" + p.team; val = { a: (Array.isArray(x.a) ? x.a : []).slice(0, 7).map(s => clean(s, 400)), by: p.name }; }
      else if (stg.type === "boss" && stg.phase === "note") { key = "note:" + b.pid; val = { text: clean(x.text, 800) }; }
      else return send(res, 409, { ok: false, message: "Nothing to submit right now." });
      await store.cmd("HSET", K.sub, key, JSON.stringify(val)); cache = null;
      return send(res, 200, { ok: true });
    }

    if (b.a === "host") {
      if (String(b.pin) !== HOST_PIN) return send(res, 403, { ok: false, error: "pin" });
      const d = await load(true); const st = d.st;
      const op = b.op;
      if (op === "stage") {
        const s = b.stage || {};
        let pre = 0;
        if (b.dur === "auto") { const q = s.type === "rg" && roundQs(s.round)[s.idx || 0]; b.dur = q ? autoDur(q) : 0; if (q && s.phase === "vote") pre = (s.idx || 0) === 0 ? 5500 : 3500; }
        s.startsAt = b.dur ? now + pre : null; s.endsAt = b.dur ? now + pre + b.dur * 1000 : null;
        if (s.type === "rg" && s.phase === "reveal") { const q = roundQs(s.round)[s.idx || 0]; if (q) st.revealed[q.id] = true; }
        st.stage = s; await saveState(st);
      } else if (op === "timer") { const base = b.add && st.stage.endsAt && st.stage.endsAt > now ? st.stage.endsAt : now; st.stage.endsAt = b.dur ? base + b.dur * 1000 : null; if (!b.add || !st.stage.startsAt) st.stage.startsAt = now; await saveState(st); }
      else if (op === "mic") { st.stage.mic = b.pid || null; await saveState(st); }
      else if (op === "teams") { (b.teams || []).forEach(t => { const x = st.teams.find(y => y.id === t.id); if (x) x.name = clean(t.name, 24) || x.name; }); await saveState(st); }
      else if (op === "boxDraw") { const ids = shuffle(C.BOXES.map(x => x.id)); st.boxAssign = {}; st.teams.forEach((t, i) => st.boxAssign[t.id] = ids[i % ids.length]); await saveState(st); }
      else if (op === "score") { const pairs = Object.entries(b.scores || {}).flatMap(([k, v]) => [k, Number(v) || 0]); if (pairs.length) await store.cmd("HSET", K.score, ...pairs); cache = null; }
      else if (op === "move") { const p = d.players[b.pid]; if (p && st.teams.find(t => t.id === b.team)) { p.team = b.team; await store.cmd("HSET", K.players, b.pid, JSON.stringify(p)); cache = null; } }
      else if (op === "kick") { await store.cmd("HDEL", K.players, b.pid); cache = null; }
      else if (op === "reset") {
        if (b.all) await store.cmd("DEL", K.state, K.players, K.rg, K.sub, K.score);
        else { await store.cmd("DEL", K.rg, K.sub, K.score); st.revealed = {}; st.boxAssign = {}; st.stage = { type: "lobby" }; await saveState(st); }
        cache = null;
      } else return send(res, 400, { ok: false });
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false });
  } catch (e) {
    return send(res, 500, { ok: false, message: String(e.message || e) });
  }
};
