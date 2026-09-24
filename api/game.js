// One serverless function runs the whole game.
// GET  /api/game?pid=..            -> state for a player / the screen
// GET  /api/game?pin=..            -> full state for the host
// POST /api/game {a:"join"|"vote"|"submit"|"host", ...}
const C = require("../lib/content");
const store = require("../lib/store");

const P = "mc:";
const K = { state: P + "state", players: P + "players", rg: P + "rg", sub: P + "sub", score: P + "score", quiz: P + "quiz", content: P + "content" };
const HOST_PIN = String(process.env.HOST_PIN || "1234");
const GRACE_MS = 1500;

function defState() {
  return { v: 0, stage: { type: "lobby" }, teams: C.TEAMS.slice(0, C.DEFAULT_TEAMS).map(t => ({ ...t })), revealed: {}, boxAssign: {} };
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
  if (!fresh && cache && Date.now() - cache.t < 700) { setQuiz(cache.d.quiz || C.RG); setContent(cache.d.content); return cache.d; }
  const r = await store.pipeline([["GET", K.state], ["HGETALL", K.players], ["HGETALL", K.rg], ["HGETALL", K.sub], ["HGETALL", K.score], ["GET", K.quiz], ["GET", K.content]]);
  let st = defState();
  if (r[0]) { try { st = { ...st, ...JSON.parse(r[0]) }; } catch (e) { } }
  let quiz = null; if (r[5]) { try { quiz = JSON.parse(r[5]); } catch (e) { } }
  let content = null; if (r[6]) { try { content = JSON.parse(r[6]); } catch (e) { } }
  const d = { st, players: parseJ(toObj(r[1])), rg: toObj(r[2]), sub: parseJ(toObj(r[3])), score: nums(toObj(r[4])), quiz: Array.isArray(quiz) && quiz.length ? quiz : null, content: content && content.say ? content : null };
  setQuiz(d.quiz || C.RG); setContent(d.content);
  cache = { t: Date.now(), d };
  return d;
}
async function saveState(st) { st.v = (st.v || 0) + 1; await store.cmd("SET", K.state, JSON.stringify(st)); cache = null; }

/* ---------------- scoring ---------------- */
// Questions can be edited live from the host page (stored in the database);
// if nothing is stored, the defaults from lib/content.js are used.
let QUIZ = C.RG, Q = {};
function setQuiz(list) { QUIZ = list; Q = Object.fromEntries(list.map(q => [q.id, q])); }
setQuiz(C.RG);
// Group games (Say it / Mystery box / Boss fight) can also be edited live.
let SAY = C.SAY, BOXES = C.BOXES, BOSS_CASE = C.BOSS_CASE, BOSS_Q = C.BOSS_Q, DROP = C.DROP_OPTIONS, MAX = { ...C.MAX };
function setContent(c) {
  SAY = (c && c.say) || C.SAY; BOXES = (c && c.boxes) || C.BOXES;
  BOSS_CASE = (c && c.boss && c.boss.case) || C.BOSS_CASE;
  BOSS_Q = (c && c.boss && c.boss.qs) || C.BOSS_Q;
  DROP = (c && c.boss && c.boss.drop) || C.DROP_OPTIONS;
  MAX = { say: SAY.length * 5, box: 10, boss: BOSS_Q.reduce((n, q) => n + (q[2] || 0), 0) };
}
setContent(null);
const lvl = v => ["hi", "md", "lo"].includes(v) ? v : "md";
function sanitizeContent(c) {
  c = c || {};
  const say = (Array.isArray(c.say) ? c.say : []).slice(0, 8).map((x, i) => {
    const pat = (Array.isArray(x.pat) ? x.pat : []).slice(0, 3).map(p => [clean(p && p[0], 60), ["up", "down", "zero"].includes(p && p[1]) ? p[1] : "up"]).filter(p => p[0]);
    if (!pat.length) throw new Error("Say it case " + (i + 1) + " needs at least one metric.");
    return { id: clean(x.id, 3) || String.fromCharCode(65 + i), pat, human: clean(x.human, 300), humanAr: clean(x.humanAr, 300), meaning: clean(x.meaning, 300), action: clean(x.action, 300), variant: clean(x.variant, 300) };
  });
  if (!say.length) throw new Error("Say it needs at least one case.");
  const boxes = (Array.isArray(c.boxes) ? c.boxes : []).slice(0, 8).map((x, i) => {
    const metrics = (Array.isArray(x.metrics) ? x.metrics : []).map(m => clean(m, 40)).filter(Boolean).slice(0, 10);
    if (metrics.length < 2) throw new Error("Box " + (i + 1) + " needs at least 2 metrics.");
    const pick = arr => (Array.isArray(arr) ? arr : []).map(m => clean(m, 40)).filter(m => metrics.includes(m));
    return { id: clean(x.id, 3) || String.fromCharCode(65 + i), level: clean(x.level, 20), format: clean(x.format, 40), content: clean(x.content, 200), objective: clean(x.objective, 60),
      metrics, trap: metrics.includes(clean(x.trap, 40)) ? clean(x.trap, 40) : metrics[0],
      primary: clean(x.primary, 160), secondary: clean(x.secondary, 160), diag: clean(x.diag, 200), why: clean(x.why, 300),
      ex: { p: pick(x.ex && x.ex.p), s: pick(x.ex && x.ex.s), d: pick(x.ex && x.ex.d) } };
  });
  if (!boxes.length) throw new Error("Mystery box needs at least one box.");
  const b = c.boss || {}, k = b.case || {};
  const bcase = { brand: clean(k.brand, 60) || "Morning Club", offer: clean(k.offer, 120), objective: clean(k.objective, 60), kpi: clean(k.kpi, 60),
    target: Math.max(0, Math.min(100, Number(k.target) || 0)), actual: Math.max(0, Math.min(100, Number(k.actual) || 0)),
    data: (Array.isArray(k.data) ? k.data : []).slice(0, 10).map(r => [clean(r && r[0], 40), clean(r && r[1], 40), lvl(r && r[2])]).filter(r => r[0]) };
  const qs = (Array.isArray(b.qs) ? b.qs : []).slice(0, 12).map((q, i) => {
    const t = clean(q && q[0], 200); if (!t) throw new Error("Boss question " + (i + 1) + " is empty.");
    return [t, clean(q[1], 400), Math.max(1, Math.min(10, Number(q[2]) || 1)), ["yesno", "drop", "text"].includes(q[3]) ? q[3] : "text"];
  });
  if (!qs.length) throw new Error("Boss fight needs at least one question.");
  const drop = (Array.isArray(b.drop) ? b.drop : []).map(x => clean(x, 80)).filter(Boolean).slice(0, 8);
  return { say, boxes, boss: { case: bcase, qs, drop: drop.length ? drop : C.DROP_OPTIONS } };
}
function sanitizeQuiz(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("No questions.");
  const seen = new Set();
  const out = list.slice(0, 200).map((q, i) => {
    const r = C.ROUNDS[q.r] ? q.r : null; if (!r) throw new Error("Question " + (i + 1) + ": unknown round.");
    const type = q.type === "mcq" ? "mcq" : "rg";
    const t = clean(q.t, 400); if (!t) throw new Error("Question " + (i + 1) + " is empty.");
    let opts = null, a;
    if (type === "mcq") {
      opts = (Array.isArray(q.opts) ? q.opts : []).map(o => clean(o, 160)).filter(Boolean).slice(0, 4);
      if (opts.length < 2) throw new Error("“" + t.slice(0, 40) + "…” needs at least 2 options.");
      a = "ABCD".slice(0, opts.length).includes(q.a) ? q.a : null; if (!a) throw new Error("“" + t.slice(0, 40) + "…” needs a correct option.");
    } else { a = q.a === "G" ? "G" : "R"; }
    let id = String(q.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || ("q" + Date.now().toString(36) + i);
    while (seen.has(id)) id += "x"; seen.add(id);
    return { id, r, type, a, pts: Math.max(1, Math.min(5, Number(q.pts) || 1)), t, opts, e: clean(q.e, 500), d: clean(q.d, 300) };
  });
  for (const r of Object.keys(C.ROUNDS)) if (!out.some(q => q.r === r)) throw new Error("“" + C.ROUNDS[r].name + "” needs at least one question.");
  return out;
}
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
function roundQs(r) { return QUIZ.filter(q => q.r === r); }

/* ---------------- views ---------------- */
function build(d, { pid, host }) {
  const st = d.st, stg = st.stage;
  const players = Object.entries(d.players).map(([id, p]) => ({ id, name: p.name, team: p.team, emoji: p.emoji }));
  const v = { ok: true, now: Date.now(), v: st.v, stage: stg, teams: st.teams, players, db: store.configured, timer: st.timer || null };
  let cur = null;
  if (stg.type === "rg") {
    const qs = roundQs(stg.round), R = C.ROUNDS[stg.round] || C.ROUNDS["1"];
    if (stg.phase === "summary") {
      const rs = rgScores(d);
      cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, takeaway: R.takeaway,
        items: qs.map(q => { const vv = votesFor(d, q.id); const ok = st.revealed[q.id]; return { t: q.t, type: q.type, a: ok ? q.a : null, pct: ok && vv.n ? Math.round((vv.c[q.a] || 0) / vv.n * 100) : null }; }),
        top: players.map(p => ({ ...p, s: rs[p.id] || 0 })).filter(p => p.s > 0).sort((a, b) => b.s - a.s).slice(0, 5), outOf: revealedCount(d) };
    } else {
      const q = qs[Math.min(stg.idx || 0, qs.length - 1)] || QUIZ[0], vv = votesFor(d, q.id);
      cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, idx: stg.idx || 0, total: qs.length, qid: q.id, t: q.t, type: q.type, opts: q.opts || null, pts: q.pts || 1, voted: vv.n, of: players.length };
      if (stg.phase === "reveal") Object.assign(cur, { a: q.a, e: q.e, d: q.d, c: vv.c });
      if (stg.mic && d.players[stg.mic]) cur.mic = { name: d.players[stg.mic].name, emoji: d.players[stg.mic].emoji };
      if (host) cur.notVoted = players.filter(p => !vv.by[p.id]).map(p => p.id);
    }
  } else if (stg.type === "say") {
    const c = SAY.find(x => x.id === stg.c) || SAY[0];
    const subs = st.teams.map(t => ({ tid: t.id, s: d.sub["say:" + c.id + ":" + t.id] })).filter(x => x.s && x.s.text);
    cur = { id: c.id, pat: c.pat, submitted: subs.map(x => x.tid) };
    if (stg.phase === "reveal" || host) Object.assign(cur, { model: { human: c.human, humanAr: c.humanAr, meaning: c.meaning, action: c.action, variant: c.variant }, answers: subs.map(x => ({ tid: x.tid, text: x.s.text, by: x.s.by })) });
    if (!host && stg.phase !== "reveal") delete cur.model;
  } else if (stg.type === "box") {
    const pub = BOXES.map(b => ({ id: b.id, level: b.level, format: b.format, content: b.content, objective: b.objective, metrics: b.metrics, trap: b.trap }));
    cur = { assign: st.boxAssign, boxes: pub, submitted: st.teams.filter(t => d.sub["box:" + t.id]).map(t => t.id) };
    if (stg.phase === "reveal" || host) {
      cur.expected = Object.fromEntries(BOXES.map(b => [b.id, { primary: b.primary, secondary: b.secondary, diag: b.diag, why: b.why, ex: b.ex }]));
      cur.picks = Object.fromEntries(st.teams.map(t => [t.id, d.sub["box:" + t.id] || null]));
    }
  } else if (stg.type === "boss") {
    cur = { case: BOSS_CASE, drop: DROP, qs: BOSS_Q.map(q => ({ q: q[0], pts: q[2], kind: q[3] })),
      submitted: st.teams.filter(t => d.sub["boss:" + t.id]).map(t => t.id),
      notes: Object.keys(d.sub).filter(k => k.startsWith("note:")).length };
    const tt = teamTotals(d); cur.dmg = Object.fromEntries(st.teams.map(t => [t.id, tt[t.id].boss]));
    const avg = st.teams.reduce((a, t) => a + tt[t.id].boss, 0) / Math.max(1, st.teams.length);
    cur.hp = Math.max(0, Math.round(100 - avg / Math.max(1, MAX.boss) * 100));
    const shown = host ? BOSS_Q.length - 1 : (stg.phase === "reveal" ? (stg.q ?? -1) : -1);
    cur.keys = BOSS_Q.map((q, i) => i <= shown ? q[1] : null);
    if (stg.phase === "reveal" || host) cur.sheets = Object.fromEntries(st.teams.map(t => [t.id, d.sub["boss:" + t.id] || null]));
  } else if (stg.type === "board") {
    const tt = teamTotals(d);
    cur = { max: MAX, rows: st.teams.map(t => ({ tid: t.id, name: t.name, ...tt[t.id] })).sort((a, b) => b.total - a.total), winner: !!stg.winner };
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
    v.host = { individuals: individuals(d), teamTotals: teamTotals(d), score: d.score, rubric: { say: C.SAY_RUBRIC, box: C.BOX_RUBRIC, boss: BOSS_Q.map(q => q[2]) }, max: MAX,
      content: { say: SAY, boxes: BOXES, boss: { case: BOSS_CASE, qs: BOSS_Q, drop: DROP } }, customContent: !!d.content,
      notes: Object.fromEntries(Object.keys(d.sub).filter(k => k.startsWith("note:")).map(k => [k.slice(5), d.sub[k].text])),
      rounds: C.ROUNDS, quiz: QUIZ, customQuiz: !!d.quiz, says: SAY.map(s => s.id), rgTotal: revealedCount(d),
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
      else if (op === "quizSave") { const list = sanitizeQuiz(b.quiz); await store.cmd("SET", K.quiz, JSON.stringify(list)); cache = null; return send(res, 200, { ok: true, count: list.length }); }
      else if (op === "contentSave") { const c = sanitizeContent(b.content); await store.cmd("SET", K.content, JSON.stringify(c)); cache = null; return send(res, 200, { ok: true }); }
      else if (op === "contentReset") { await store.cmd("DEL", K.content); cache = null; }
      else if (op === "bigTimer") { st.timer = b.dur ? { label: clean(b.label, 60), startsAt: now, endsAt: now + Number(b.dur) * 1000 } : null; await saveState(st); }
      else if (op === "quizReset") { await store.cmd("DEL", K.quiz); cache = null; }
      else if (op === "teamCount") {
        const n = Math.max(2, Math.min(C.TEAMS.length, Number(b.n) || C.DEFAULT_TEAMS));
        const old = st.teams; st.teams = C.TEAMS.slice(0, n).map(t => old.find(o => o.id === t.id) || { ...t });
        const ids = st.teams.map(t => t.id); let i = 0; const moves = [];
        for (const [pid, p] of Object.entries(d.players)) if (!ids.includes(p.team)) { p.team = ids[i++ % n]; moves.push(pid, JSON.stringify(p)); }
        if (moves.length) await store.cmd("HSET", K.players, ...moves);
        st.boxAssign = {}; await saveState(st);
      }
      else if (op === "boxDraw") { const ids = shuffle(C.BOXES.map(x => x.id)); st.boxAssign = {}; st.teams.forEach((t, i) => { if (i && i % ids.length === 0) ids.push(...shuffle(ids.splice(0))); st.boxAssign[t.id] = ids[i % ids.length]; }); await saveState(st); }
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
