// One serverless function runs the whole game.
// GET  /api/game?pid=..            -> state for a player / the screen
// GET  /api/game?pin=..            -> full state for the host
// POST /api/game {a:"join"|"vote"|"submit"|"host", ...}
const C = require("../lib/content");
const store = require("../lib/store");

const P = "mc:";
const K = { state: P + "state", players: P + "players", rg: P + "rg", rgt: P + "rgt", setup: P + "setup", imgs: P + "imgs", imgv: P + "imgv", auth: P + "auth", devs: P + "devs", files: P + "files", filev: P + "filev", sub: P + "sub", score: P + "score", quiz: P + "quiz", content: P + "content" };
const crypto = require("crypto");
const HOST_PIN = String(process.env.HOST_PIN || "1234");
// Set HOST_PIN to "none" (or "off") in Vercel and the trainer page opens with no password at all.
const OPEN_HOST = ["none", "off", "no", "open", ""].includes(HOST_PIN.trim().toLowerCase());
const pinOK = p => OPEN_HOST ? true : String(p) === HOST_PIN;
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
  if (!fresh && cache && Date.now() - cache.t < 700) { setQuiz(cache.d.quiz || C.RG); setContent(cache.d.content); setSetup(cache.d.setup); return cache.d; }
  const r = await store.pipeline([["GET", K.state], ["HGETALL", K.players], ["HGETALL", K.rg], ["HGETALL", K.sub], ["HGETALL", K.score], ["GET", K.quiz], ["GET", K.content], ["HGETALL", K.rgt], ["GET", K.setup], ["HGETALL", K.imgv], ["GET", K.auth], ["HGETALL", K.filev]]);
  let st = defState();
  if (r[0]) { try { st = { ...st, ...JSON.parse(r[0]) }; } catch (e) { } }
  let quiz = null; if (r[5]) { try { quiz = JSON.parse(r[5]); } catch (e) { } }
  let content = null; if (r[6]) { try { content = JSON.parse(r[6]); } catch (e) { } }
  let setup = null; if (r[8]) { try { setup = JSON.parse(r[8]); } catch (e) { } }
  const d = { st, players: parseJ(toObj(r[1])), rg: toObj(r[2]), rgt: nums(toObj(r[7])), sub: parseJ(toObj(r[3])), score: nums(toObj(r[4])), quiz: Array.isArray(quiz) && quiz.length ? quiz : null, content: content && content.say ? content : null, setup: setup && setup.name ? setup : null, imgv: nums(toObj(r[9])), auth: (() => { try { return r[10] ? JSON.parse(r[10]) : null; } catch (e) { return null; } })(), filev: parseJ(toObj(r[11])) };
  setQuiz(d.quiz || C.RG); setContent(d.content); setSetup(d.setup);
  cache = { t: Date.now(), d };
  return d;
}
async function saveState(st) { st.v = (st.v || 0) + 1; await store.cmd("SET", K.state, JSON.stringify(st)); cache = null; }

/* ---------------- scoring ---------------- */
// Questions can be edited live from the host page (stored in the database);
// if nothing is stored, the defaults from lib/content.js are used.
// Session setup (name, logo, colours, rounds, scoring) — editable from the host page.
let SET = JSON.parse(JSON.stringify(C.SETUP)), ROUNDS = {}, ORDER = [];
function setSetup(s) {
  SET = s ? s : JSON.parse(JSON.stringify(C.SETUP));
  ROUNDS = {}; ORDER = [];
  (SET.rounds || []).forEach(r => { ROUNDS[r.key] = r; ORDER.push(r.key); });
  if (!ORDER.length) { ROUNDS = C.ROUNDS; ORDER = Object.keys(C.ROUNDS); }
}
setSetup(null);
const HEX = /^#[0-9a-fA-F]{6}$/;
function sanitizeSetup(x) {
  x = x || {};
  const sc = x.scoring || {}, tm = x.timers || {}, fl = x.flag || {}, gm = x.games || {}, lm = x.limits || {};
  const emojis = (Array.isArray(x.emojis) ? x.emojis : []).map(e => clean(e, 8)).filter(Boolean).slice(0, 80);
  const seen = new Set();
  const rounds = (Array.isArray(x.rounds) ? x.rounds : []).slice(0, 30).map((r, i) => {
    let key = String(r.key || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "R" + (i + 1);
    while (seen.has(key)) key += "x"; seen.add(key);
    return { key, name: clean(r.name, 40) || "Round " + (i + 1), rule: clean(r.rule, 80), level: clean(r.level, 60),
      takeaway: clean(r.takeaway, 200), kind: ["round", "app", "bonus"].includes(r.kind) ? r.kind : "round" };
  });
  if (!rounds.length) throw new Error("You need at least one round.");
  const logo = typeof x.logo === "string" && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(x.logo) ? x.logo.slice(0, 400000) : (x.logo === "" ? "" : (SET.logo || ""));
  return {
    name: clean(x.name, 40) || "Arena", tagline: clean(x.tagline, 80), accent: HEX.test(x.accent) ? x.accent : "#1A9FEF", logo,
    emojis: emojis.length >= 4 ? emojis : C.EMOJIS,
    flag: { R: { label: clean(fl.R && fl.R.label, 24) || "Red flag", emoji: clean(fl.R && fl.R.emoji, 8) || "\uD83D\uDEA9" },
            G: { label: clean(fl.G && fl.G.label, 24) || "Green flag", emoji: clean(fl.G && fl.G.emoji, 8) || "\u2705" } },
    games: { say: gm.say !== false, box: gm.box !== false, boss: gm.boss !== false },
    scoring: { base: Math.max(1, Math.min(1000, Number(sc.base) || 100)), speed: Math.max(0, Math.min(200, Number(sc.speed) ?? 50)), poll: Math.max(0, Math.min(1000, Number(sc.poll) || 0)) },
    limits: { text: Math.max(100, Math.min(5000, Number(lm.text) || 1000)) },
    timers: { rg: Math.max(5, Math.min(600, Number(tm.rg) || 20)), mcq: Math.max(5, Math.min(600, Number(tm.mcq) || 30)), mcqLong: Math.max(5, Math.min(600, Number(tm.mcqLong) || 40)), text: Math.max(5, Math.min(900, Number(tm.text) || 60)) },
    rounds };
}
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
    const r = ROUNDS[q.r] ? q.r : (ORDER[0] || null); if (!r) throw new Error("Question " + (i + 1) + ": unknown round.");
    const type = ["mcq", "poll", "text", "number"].includes(q.type) ? q.type : "rg";
    const t = clean(q.t, 400); if (!t) throw new Error("Question " + (i + 1) + " is empty.");
    let opts = null, a;
    if (type === "mcq" || type === "poll") {
      opts = (Array.isArray(q.opts) ? q.opts : []).map(o => clean(o, 160)).filter(Boolean).slice(0, 4);
      if (opts.length < 2) throw new Error("“" + t.slice(0, 40) + "…” needs at least 2 options.");
      if (type === "poll") a = null;
      else { a = "ABCD".slice(0, opts.length).includes(q.a) ? q.a : null; if (!a) throw new Error("“" + t.slice(0, 40) + "…” needs a correct option."); }
    } else if (type === "text") { a = null; }
    else if (type === "number") { a = String(Number(q.a) || 0); }
    else { a = q.a === "G" ? "G" : "R"; }
    let id = String(q.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || ("q" + Date.now().toString(36) + i);
    while (seen.has(id)) id += "x"; seen.add(id);
    return { id, r, type, a, team: !!q.team, pts: Math.max(1, Math.min(5, Number(q.pts) || 1)), t, opts, unit: clean(q.unit, 16), tol: Math.max(0, Number(q.tol) || 0), e: clean(q.e, 500), d: clean(q.d, 300) };
  });
  return out;
}
// Two factors decide the winner: how many you get right, and how fast.
// A correct answer is worth pts x 100, plus up to half of that again for speed.
const base = () => SET.scoring.base, speedMax = () => SET.scoring.speed / 100;
function rgScores(d) {
  const s = {}; for (const pid in d.players) s[pid] = { pts: 0, c: 0, arena: 0, speed: 0, ans: 0 };
  for (const f in d.rg) {
    const [qid, pid] = f.split(":");
    if (!d.st.revealed[qid] || !Q[qid] || !(pid in s)) continue;
    s[pid].ans++;
    const qq = Q[qid];
    if (qq.team) continue;
    if (qq.type === "poll") { s[pid].arena += SET.scoring.poll; continue; }
    if (qq.type === "text") { const aw = (d.score || {})["txt:" + qid + ":" + pid] || 0; if (aw > 0) { s[pid].pts += aw; s[pid].c++; s[pid].arena += aw * base(); } continue; }
    if (qq.type === "number" ? !numOK(qq, d.rg[f]) : d.rg[f] !== qq.a) continue;
    const p = Q[qid].pts || 1, frac = Math.max(0, Math.min(1, (d.rgt || {})[f] ?? 0));
    const bonus = Math.round(p * base() * speedMax() * frac);
    s[pid].pts += p; s[pid].c++; s[pid].arena += p * base() + bonus; s[pid].speed += bonus;
  }
  return s;
}
function arenaRows(d) {
  const rs = rgScores(d);
  return Object.entries(d.players).map(([id, p]) => ({ id, name: p.name, team: p.team, emoji: p.emoji, ...rs[id] }))
    .sort((a, b) => b.arena - a.arena || b.c - a.c || a.name.localeCompare(b.name));
}
function revealedCount(d) { return Object.keys(d.st.revealed).filter(k => Q[k] && Q[k].type !== "poll").reduce((n, k) => n + (Q[k].pts || 1), 0); }
const scored = q => q.type !== "poll";
const choices = q => q.type === "rg" ? ["R", "G"] : q.type === "mcq" || q.type === "poll" ? q.opts.map((_, i) => "ABCD"[i]) : [];
const isOpen = q => q.type === "text" || q.type === "number";
const tkey = (qid, tid) => "tq:" + qid + ":" + tid;
const quizMaxTeam = () => QUIZ.filter(q => q.team).reduce((n, q) => n + (q.pts || 1), 0);
// Is this team answer right? (text answers are judged by the trainer)
function teamRight(q, val) { return q.type === "text" ? null : q.type === "number" ? numOK(q, val) : q.type === "poll" ? null : val === q.a; }
const numOK = (q, v) => Math.abs(Number(v) - Number(q.a)) <= (q.tol || 0);
const autoDur = q => q.type === "rg" ? SET.timers.rg : q.type === "text" ? SET.timers.text : q.type === "number" ? SET.timers.mcq : (q.t.length > 110 ? SET.timers.mcqLong : SET.timers.mcq);
function teamTotals(d) {
  const t = {}; d.st.teams.forEach(x => t[x.id] = { say: 0, box: 0, boss: 0, quiz: 0, total: 0 });
  for (const f in d.score) {
    const p = f.split(":"); let tid, g;
    if (p[0] === "say") { g = "say"; tid = p[2]; }
    else if (p[0] === "tq") { g = "quiz"; tid = p[2]; }              // trainer points for a written team answer
    else if (p[0] === "box" || p[0] === "boss") { g = p[0]; tid = p[1]; }
    else continue;
    if (t[tid]) { t[tid][g] += d.score[f]; t[tid].total += d.score[f]; }
  }
  // auto-marked team questions (two buttons / choices / number)
  for (const q of QUIZ) {
    if (!q.team || !d.st.revealed[q.id] || q.type === "text") continue;
    for (const tm of d.st.teams) {
      const sub = d.sub[tkey(q.id, tm.id)];
      if (sub && teamRight(q, sub.v)) { t[tm.id].quiz += (q.pts || 1); t[tm.id].total += (q.pts || 1); }
    }
  }
  return t;
}
function individuals(d) {
  const rs = rgScores(d), possible = revealedCount(d);
  return Object.entries(d.players).map(([id, p]) => {
    const rg = (rs[id] || {}).pts || 0, note = d.score["ind:note:" + id] || 0, re = Math.min(5, d.score["ind:reason:" + id] || 0), pa = Math.min(5, d.score["ind:part:" + id] || 0);
    return { id, name: p.name, team: p.team, emoji: p.emoji, rg, correct: (rs[id] || {}).c || 0, arena: (rs[id] || {}).arena || 0, possible, note, re, pa, total: Math.round(((possible ? rg / possible : 0) * 40 + (note / 10) * 35 + (re / 5) * 15 + (pa / 5) * 10) * 10) / 10 };
  });
}
function votesFor(d, qid) {
  const q0 = Q[qid], c = {}; choices(q0).forEach(k => c[k] = 0); const by = {}; let n = 0;
  if (q0.team) {
    for (const tm of d.st.teams) { const sub = d.sub[tkey(qid, tm.id)]; if (!sub) continue; by[tm.id] = sub.v; n++; if (sub.v in c) c[sub.v]++; }
    return { c, by, n };
  }
  for (const f in d.rg) {
    const [q, pid] = f.split(":"); if (q !== qid || !d.players[pid]) continue;
    const val = d.rg[f];
    if (isOpen(q0)) { by[pid] = val; n++; }
    else if (val in c) { c[val]++; by[pid] = val; n++; }
  }
  return { c, by, n };
}
function roundQs(r) { return QUIZ.filter(q => q.r === r); }

/* ---------------- views ---------------- */
function build(d, { pid, host }) {
  const st = d.st, stg = st.stage;
  const players = Object.entries(d.players).map(([id, p]) => ({ id, name: p.name, team: p.team, emoji: p.emoji }));
  const v = { ok: true, now: Date.now(), v: st.v, stage: stg, teams: st.teams, players, db: store.configured, timer: st.timer || null, setup: SET, order: ORDER, authReady: !!(d.auth && d.auth.ready) };
  let cur = null;
  if (stg.type === "rg") {
    const qs = roundQs(stg.round), R = ROUNDS[stg.round] || ROUNDS[ORDER[0]];
    if (stg.phase === "summary") {
      const rs = rgScores(d);
      cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, takeaway: R.takeaway,
        items: qs.map(q => { const vv = votesFor(d, q.id); const ok = st.revealed[q.id]; return { t: q.t, type: q.type, a: ok ? q.a : null, pct: ok && vv.n ? Math.round((vv.c[q.a] || 0) / vv.n * 100) : null }; }),
        top: players.map(p => ({ ...p, s: (rs[p.id] || {}).pts || 0, a: (rs[p.id] || {}).arena || 0 })).filter(p => p.a > 0).sort((a, b) => b.a - a.a).slice(0, 5), outOf: revealedCount(d) };
    } else {
      const q = qs[Math.min(stg.idx || 0, qs.length - 1)];
      if (!q) cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, empty: true, idx: 0, total: 0 };
      else {
      const vv = votesFor(d, q.id);
      cur = { round: stg.round, roundName: R.name, rule: R.rule, level: R.level, kind: R.kind, idx: stg.idx || 0, total: qs.length, qid: q.id, t: q.t, type: q.type, team: !!q.team, opts: q.opts || null, pts: q.pts || 1, img: d.imgv[q.id] || 0, file: d.filev[q.id] || null, voted: vv.n, of: q.team ? st.teams.length : players.length };
      if (q.team) cur.submitted = Object.keys(vv.by);
      if (isOpen(q)) { cur.unit = q.unit || ""; cur.tol = q.tol || 0; }
      if (stg.phase === "reveal") {
        Object.assign(cur, { a: q.a, e: q.e, d: q.d, c: vv.c });
        if (q.team) cur.tanswers = st.teams.map(tm => { const sub = d.sub[tkey(q.id, tm.id)]; return { tid: tm.id, name: tm.name, v: sub ? sub.v : null, by: sub ? sub.by : "",
          ok: sub ? teamRight(q, sub.v) : null, aw: d.score[tkey(q.id, tm.id)] || 0 }; });
        else if (isOpen(q)) cur.answers = Object.entries(vv.by).map(([id, val]) => ({ id, name: d.players[id].name, emoji: d.players[id].emoji, team: d.players[id].team, v: val,
          ok: q.type === "number" ? numOK(q, val) : ((d.score || {})["txt:" + q.id + ":" + id] || 0) > 0,
          aw: (d.score || {})["txt:" + q.id + ":" + id] || 0,
          off: q.type === "number" ? Math.abs(Number(val) - Number(q.a)) : 0 })).sort((x, y) => q.type === "number" ? x.off - y.off : y.aw - x.aw);
      }
      if (stg.mic && d.players[stg.mic]) cur.mic = { name: d.players[stg.mic].name, emoji: d.players[stg.mic].emoji };
      if (host) cur.notVoted = players.filter(p => !vv.by[p.id]).map(p => p.id);
      }
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
    const ar = arenaRows(d);
    cur = { max: { ...MAX, quiz: quizMaxTeam() }, rows: st.teams.map(t => ({ tid: t.id, name: t.name, ...tt[t.id] })).sort((a, b) => b.total - a.total), winner: !!stg.winner,
      mvp: !!stg.mvp, players: ar.slice(0, 8).map((x, i) => ({ ...x, rank: i + 1 })), playerCount: ar.length, outOf: revealedCount(d), qCount: QUIZ.filter(q => st.revealed[q.id] && scored(q)).length };
  }
  v.cur = cur;

  if (pid && d.players[pid]) {
    const p = d.players[pid], rs = rgScores(d), mine = rs[pid] || { pts: 0, c: 0, arena: 0, speed: 0, ans: 0 };
    const me = { id: pid, name: p.name, team: p.team, emoji: p.emoji, score: mine.pts, correct: mine.c, arena: mine.arena, speed: mine.speed, answered: mine.ans,
      outOf: revealedCount(d), qCount: QUIZ.filter(q => d.st.revealed[q.id] && scored(q)).length,
      rank: 1 + Object.values(rs).filter(x => x.arena > mine.arena).length, of: Object.keys(d.players).length };
    if (stg.type === "rg" && cur && cur.qid && Q[cur.qid] && Q[cur.qid].team) {
      const sub = d.sub[tkey(cur.qid, p.team)];
      me.teamAns = sub || null; me.vote = sub ? sub.v : null;
      if (stg.phase === "reveal") { const q = Q[cur.qid]; me.right = sub ? (q.type === "text" ? (d.score[tkey(q.id, p.team)] || 0) > 0 : teamRight(q, sub.v)) : false; me.gain = me.right ? (q.type === "text" ? (d.score[tkey(q.id, p.team)] || 0) : (q.pts || 1)) : 0; }
    }
    else if (stg.type === "rg" && cur && cur.qid) { me.vote = d.rg[cur.qid + ":" + pid] || null; if (stg.phase === "reveal") { const qq = Q[cur.qid]; me.right = qq.type === "number" ? (me.vote != null && me.vote !== "" && numOK(qq, me.vote)) : qq.type === "text" ? ((d.score || {})["txt:" + cur.qid + ":" + pid] || 0) > 0 : (!!cur.a && me.vote === cur.a); if (me.right) { const p = Q[cur.qid].pts || 1; me.gain = p * base() + Math.round(p * base() * speedMax() * Math.max(0, Math.min(1, (d.rgt || {})[cur.qid + ":" + pid] ?? 0))); } } }
    if (stg.type === "say") me.teamSub = d.sub["say:" + cur.id + ":" + p.team] || null;
    if (stg.type === "box") { me.box = st.boxAssign[p.team] || null; me.teamSub = d.sub["box:" + p.team] || null; }
    if (stg.type === "boss") { me.teamSub = d.sub["boss:" + p.team] || null; me.note = d.sub["note:" + pid] || null; }
    v.me = me;
  } else if (pid) v.me = null;

  if (host) {
    v.host = { individuals: individuals(d), teamTotals: teamTotals(d), score: d.score, rubric: { say: C.SAY_RUBRIC, box: C.BOX_RUBRIC, boss: BOSS_Q.map(q => q[2]) }, max: { ...MAX, quiz: quizMaxTeam() },
      content: { say: SAY, boxes: BOXES, boss: { case: BOSS_CASE, qs: BOSS_Q, drop: DROP } }, customContent: !!d.content, customSetup: !!d.setup,
      notes: Object.fromEntries(Object.keys(d.sub).filter(k => k.startsWith("note:")).map(k => [k.slice(5), d.sub[k].text])),
      rounds: ROUNDS, quiz: QUIZ.map(q => { const x = { ...q }; if (d.imgv[q.id]) x.img = d.imgv[q.id]; if (d.filev[q.id]) x.file = d.filev[q.id]; return x; }), customQuiz: !!d.quiz, says: SAY.map(s => s.id), rgTotal: revealedCount(d),
      roundLens: Object.fromEntries(ORDER.map(r => [r, roundQs(r).length])) };
    if (stg.type === "rg" && cur && cur.qid) { const q = Q[cur.qid]; cur.a = q.a; cur.e = q.e; cur.d = q.d; cur.c = votesFor(d, q.id).c; }
  }
  return v;
}

/* ---------------- trainer sign-in: authenticator app + remembered devices ---------------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  const rest = bits.length % 5; if (rest) out += B32[parseInt(bits.slice(bits.length - rest).padEnd(5, "0"), 2)];
  return out; }
function b32decode(str) { let bits = ""; for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes); }
function totp(secret, step) {
  const key = b32decode(secret), buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0); buf.writeUInt32BE(step >>> 0, 4);
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
function totpOK(secret, code) {
  code = String(code || "").replace(/\D/g, ""); if (code.length !== 6) return false;
  const step = Math.floor(Date.now() / 30000);
  for (let w = -1; w <= 1; w++) if (crypto.timingSafeEqual(Buffer.from(totp(secret, step + w)), Buffer.from(code))) return true;
  return false;
}
async function getAuth() { const raw = await store.cmd("GET", K.auth); if (!raw) return null; try { return JSON.parse(raw); } catch (e) { return null; } }
async function devOK(tok) {
  if (!tok || !/^[a-f0-9]{32}$/.test(String(tok))) return false;
  const raw = await store.cmd("HGET", K.devs, String(tok));
  if (!raw) return false;
  try { const d = JSON.parse(raw); if (Date.now() - (d.last || 0) > 60000) { d.last = Date.now(); await store.cmd("HSET", K.devs, String(tok), JSON.stringify(d)); } } catch (e) {}
  return true;
}
// A request is from the trainer if it carries a known device token, or the PIN while the PIN is still allowed.
async function isHost({ tok, pin }) {
  if (tok && await devOK(tok)) return true;
  if (pin == null) return false;
  const a = await getAuth();
  if (a && a.ready && a.pinOff) return false;          // authenticator only
  return pinOK(pin);
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
      // Locked out? Set HOST_RESET in Vercel, open …/api/game?reset=<that value>, and the
      // authenticator + remembered devices are cleared so the PIN works again. Then delete the variable.
      const rst = url.searchParams.get("reset");
      if (rst != null) {
        const want = String(process.env.HOST_RESET || "");
        if (!want || rst !== want) return send(res, 403, { ok: false, message: "No." });
        await store.cmd("DEL", K.auth, K.devs); cache = null;
        return send(res, 200, { ok: true, message: "Authenticator removed. Sign in with the PIN, then delete HOST_RESET in Vercel." });
      }
      const fileQ = url.searchParams.get("file");
      if (fileQ) {
        const raw = await store.cmd("HGET", K.files, String(fileQ));
        if (!raw) { res.statusCode = 404; return res.end(); }
        let x; try { x = JSON.parse(raw); } catch (e) { res.statusCode = 404; return res.end(); }
        const buf = Buffer.from(x.d, "base64");
        res.statusCode = 200;
        res.setHeader("Content-Type", x.t || "application/octet-stream");
        res.setHeader("Content-Disposition", 'inline; filename="' + String(x.n || "file").replace(/[^\w. -]/g, "_") + '"');
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.end(buf);
      }
      const imgQ = url.searchParams.get("img");
      if (imgQ) {
        const raw = await store.cmd("HGET", K.imgs, String(imgQ));
        if (!raw) { res.statusCode = 404; return res.end(); }
        let x; try { x = JSON.parse(raw); } catch (e) { res.statusCode = 404; return res.end(); }
        const buf = Buffer.from(x.d, "base64");
        res.statusCode = 200;
        res.setHeader("Content-Type", x.t);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.end(buf);
      }
      const pin = url.searchParams.get("pin"), tok = url.searchParams.get("tok");
      const wantsHost = pin != null || tok != null;
      if (wantsHost && !(await isHost({ tok, pin }))) return send(res, 403, { ok: false, error: "pin" });
      const d = await load(false);
      const v = build(d, { pid: url.searchParams.get("pid"), host: wantsHost });
      if (wantsHost) v.auth = { ready: !!(d.auth && d.auth.ready), pinOff: !!(d.auth && d.auth.pinOff) };
      return send(res, 200, v);
    }
    if (req.method !== "POST") return send(res, 405, { ok: false });
    const b = await readBody(req);
    const now = Date.now();

    if (b.a === "join") {
      const d = await load(true);
      const name = clean(b.name, 24); const team = d.st.teams.find(t => t.id === b.team) ? b.team : null;
      if (!name || !team) return send(res, 400, { ok: false, message: "Write your name and pick a team." });
      const pid = b.pid && d.players[b.pid] ? b.pid : Math.random().toString(36).slice(2, 10);
      const emoji = (SET.emojis || C.EMOJIS).includes(b.emoji) ? b.emoji : (SET.emojis || C.EMOJIS)[0];
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
      if (!q || q.id !== b.qid) return send(res, 409, { ok: false, message: "That statement is over." });
      if (q.type === "text") { b.v = clean(b.v, (SET.limits && SET.limits.text) || 1000); if (!b.v) return send(res, 400, { ok: false, message: "Write something first." }); }
      else if (q.type === "number") { if (b.v === "" || b.v == null || isNaN(Number(b.v))) return send(res, 400, { ok: false, message: "Write a number." }); b.v = String(Number(b.v)); }
      else if (!choices(q).includes(b.v)) return send(res, 409, { ok: false, message: "That statement is over." });
      let frac = 0;
      if (stg.endsAt && stg.startsAt && stg.endsAt > stg.startsAt) frac = Math.max(0, Math.min(1, (stg.endsAt - now) / (stg.endsAt - stg.startsAt)));
      if (q.team) {
        const p = d.players[b.pid];
        await store.cmd("HSET", K.sub, tkey(q.id, p.team), JSON.stringify({ v: b.v, by: p.name, frac })); cache = null;
        return send(res, 200, { ok: true });
      }
      await store.pipeline([["HSET", K.rg, q.id + ":" + b.pid, b.v], ["HSET", K.rgt, q.id + ":" + b.pid, String(Math.round(frac * 1000) / 1000)]]); cache = null;
      return send(res, 200, { ok: true });
    }

    if (b.a === "submit") {
      const d = await load(true); const stg = d.st.stage; const p = d.players[b.pid];
      if (!p) return send(res, 404, { ok: false, error: "nop" });
      if (!open(stg, now)) return send(res, 409, { ok: false, message: "Time's up — answers are locked." });
      let key, val; const x = b.data || {};
      if (stg.type === "say" && stg.phase === "answer") { key = "say:" + stg.c + ":" + p.team; val = { text: clean(x.text, 300), by: p.name }; }
      else if (stg.type === "box" && stg.phase === "answer") {
        const bid = d.st.boxAssign[p.team]; const box = BOXES.find(y => y.id === bid); if (!box) return send(res, 409, { ok: false, message: "Your team has no box yet." });
        const okm = m => box.metrics.includes(m) ? m : null;
        key = "box:" + p.team; val = { box: bid, primary: okm(x.primary), secondary: okm(x.secondary), diag: (Array.isArray(x.diag) ? x.diag : []).map(okm).filter(Boolean).slice(0, 6), why: clean(x.why, 300), by: p.name };
      }
      else if (stg.type === "boss" && stg.phase === "team") { key = "boss:" + p.team; val = { a: (Array.isArray(x.a) ? x.a : []).slice(0, 7).map(s => clean(s, 400)), by: p.name }; }
      else if (stg.type === "boss" && stg.phase === "note") { key = "note:" + b.pid; val = { text: clean(x.text, 800) }; }
      else return send(res, 409, { ok: false, message: "Nothing to submit right now." });
      await store.cmd("HSET", K.sub, key, JSON.stringify(val)); cache = null;
      return send(res, 200, { ok: true });
    }

    if (b.a === "signin") {
      const a = await getAuth();
      if (!a || !a.ready) return send(res, 400, { ok: false, message: "The authenticator app isn't set up yet — sign in with the PIN." });
      if (!totpOK(a.secret, b.code)) return send(res, 403, { ok: false, message: "Wrong code — check the app and try again." });
      const tok = crypto.randomBytes(16).toString("hex");
      await store.cmd("HSET", K.devs, tok, JSON.stringify({ name: clean(b.name, 40) || "Device", created: now, last: now }));
      return send(res, 200, { ok: true, tok });
    }

    if (b.a === "host") {
      if (!(await isHost({ tok: b.tok, pin: b.pin }))) return send(res, 403, { ok: false, error: "pin" });
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
      else if (op === "quizSave") {
        const list = sanitizeQuiz(b.quiz);
        await store.cmd("SET", K.quiz, JSON.stringify(list));
        const keep = new Set(list.map(q => q.id));
        const gone = Object.keys(d.imgv).filter(id => !keep.has(id));
        if (gone.length) await store.pipeline([["HDEL", K.imgs, ...gone], ["HDEL", K.imgv, ...gone]]);
        const goneF = Object.keys(d.filev).filter(id => !keep.has(id));
        if (goneF.length) await store.pipeline([["HDEL", K.files, ...goneF], ["HDEL", K.filev, ...goneF]]);
        cache = null; return send(res, 200, { ok: true, count: list.length });
      }
      else if (op === "contentSave") { const c = sanitizeContent(b.content); await store.cmd("SET", K.content, JSON.stringify(c)); cache = null; return send(res, 200, { ok: true }); }
      else if (op === "contentReset") { await store.cmd("DEL", K.content); cache = null; }
      else if (op === "setupSave") { const x = sanitizeSetup(b.setup); await store.cmd("SET", K.setup, JSON.stringify(x)); cache = null; return send(res, 200, { ok: true }); }
      else if (op === "setupReset") { await store.cmd("DEL", K.setup); cache = null; }
      else if (op === "imgSave") {
        const qid = String(b.qid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
        const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ""));
        if (!qid || !m) return send(res, 400, { ok: false, message: "That image didn't work — try a PNG or JPG." });
        if (m[2].length > 900000) return send(res, 400, { ok: false, message: "That image is too big." });
        const v = (d.imgv[qid] || 0) + 1;
        await store.pipeline([["HSET", K.imgs, qid, JSON.stringify({ t: m[1], d: m[2] })], ["HSET", K.imgv, qid, String(v)]]);
        cache = null; return send(res, 200, { ok: true, v });
      }
      else if (op === "authSetup") {
        let a = await getAuth();
        if (!a || !a.ready) { a = { secret: b32encode(crypto.randomBytes(20)), ready: false, pinOff: false }; await store.cmd("SET", K.auth, JSON.stringify(a)); cache = null; }
        if (a.ready) return send(res, 200, { ok: true, ready: true });
        const label = encodeURIComponent((SET.name || "Arena") + " — trainer");
        return send(res, 200, { ok: true, ready: false, secret: a.secret, uri: "otpauth://totp/" + label + "?secret=" + a.secret + "&issuer=" + encodeURIComponent(SET.name || "Arena") + "&period=30&digits=6" });
      }
      else if (op === "authConfirm") {
        const a = await getAuth();
        if (!a || !a.secret) return send(res, 400, { ok: false, message: "Start the setup again." });
        if (!totpOK(a.secret, b.code)) return send(res, 400, { ok: false, message: "Wrong code — try the next one the app shows." });
        a.ready = true; await store.cmd("SET", K.auth, JSON.stringify(a)); cache = null;
        const tok = crypto.randomBytes(16).toString("hex");
        await store.cmd("HSET", K.devs, tok, JSON.stringify({ name: clean(b.name, 40) || "This device", created: now, last: now }));
        return send(res, 200, { ok: true, tok });
      }
      else if (op === "authPin") { const a = await getAuth(); if (!a || !a.ready) return send(res, 400, { ok: false, message: "Set up the app first." }); a.pinOff = !!b.off; await store.cmd("SET", K.auth, JSON.stringify(a)); cache = null; return send(res, 200, { ok: true }); }
      else if (op === "authOff") { await store.cmd("DEL", K.auth, K.devs); cache = null; return send(res, 200, { ok: true }); }
      else if (op === "devList") {
        const all = parseJ(toObj(await store.cmd("HGETALL", K.devs)));
        return send(res, 200, { ok: true, devices: Object.entries(all).map(([tok, d]) => ({ id: tok.slice(0, 8), tok, name: d.name, created: d.created, last: d.last, me: tok === b.tok })) });
      }
      else if (op === "devRevoke") { await store.cmd("HDEL", K.devs, String(b.tok)); return send(res, 200, { ok: true }); }
      else if (op === "devRevokeAll") {
        const all = toObj(await store.cmd("HGETALL", K.devs));
        const others = Object.keys(all).filter(t => t !== b.tok);
        if (others.length) await store.cmd("HDEL", K.devs, ...others);
        return send(res, 200, { ok: true, removed: others.length });
      }
      else if (op === "fileSave") {
        const qid = String(b.qid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
        const data = String(b.data || ""), name = clean(b.name, 80) || "file";
        const m = /^data:([^;,]*);base64,([A-Za-z0-9+/=]+)$/.exec(data);
        if (!qid || !m) return send(res, 400, { ok: false, message: "That file didn't work." });
        if (m[2].length > 4200000) return send(res, 400, { ok: false, message: "That file is too big — keep it under 3 MB." });
        const type = /^[\w.+-]+\/[\w.+-]+$/.test(m[1]) ? m[1] : "application/octet-stream";
        const v = ((d.filev[qid] || {}).v || 0) + 1;
        await store.pipeline([["HSET", K.files, qid, JSON.stringify({ t: type, n: name, d: m[2] })],
                              ["HSET", K.filev, qid, JSON.stringify({ v, n: name, t: type, size: Math.round(m[2].length * 0.75) })]]);
        cache = null; return send(res, 200, { ok: true, v });
      }
      else if (op === "fileDel") { await store.pipeline([["HDEL", K.files, String(b.qid)], ["HDEL", K.filev, String(b.qid)]]); cache = null; }
      else if (op === "fileAll") { const all = toObj(await store.cmd("HGETALL", K.files)); return send(res, 200, { ok: true, files: parseJ(all) }); }
      else if (op === "fileRestore") {
        const fs2 = b.files || {}; const sets = [], vers = [];
        for (const qid of Object.keys(fs2).slice(0, 40)) {
          const x = fs2[qid]; if (!x || !x.d || String(x.d).length > 4200000) continue;
          sets.push(qid, JSON.stringify({ t: x.t || "application/octet-stream", n: x.n || "file", d: x.d }));
          vers.push(qid, JSON.stringify({ v: ((d.filev[qid] || {}).v || 0) + 1, n: x.n || "file", t: x.t, size: Math.round(String(x.d).length * 0.75) }));
        }
        if (sets.length) await store.pipeline([["HSET", K.files, ...sets], ["HSET", K.filev, ...vers]]);
        cache = null;
      }
      else if (op === "imgDel") { await store.pipeline([["HDEL", K.imgs, String(b.qid)], ["HDEL", K.imgv, String(b.qid)]]); cache = null; }
      else if (op === "imgAll") { const all = toObj(await store.cmd("HGETALL", K.imgs)); return send(res, 200, { ok: true, images: parseJ(all) }); }
      else if (op === "imgRestore") {
        const imgs = b.images || {}; const sets = [], vers = [];
        for (const qid of Object.keys(imgs).slice(0, 60)) {
          const x = imgs[qid]; if (!x || !x.d || !/^image\/(png|jpeg|webp|gif)$/.test(x.t || "")) continue;
          if (String(x.d).length > 900000) continue;
          sets.push(qid, JSON.stringify({ t: x.t, d: x.d })); vers.push(qid, String((d.imgv[qid] || 0) + 1));
        }
        if (sets.length) await store.pipeline([["HSET", K.imgs, ...sets], ["HSET", K.imgv, ...vers]]);
        cache = null;
      }
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
      else if (op === "boxDraw") { const ids = shuffle(BOXES.map(x => x.id)); st.boxAssign = {}; st.teams.forEach((t, i) => { if (i && i % ids.length === 0) ids.push(...shuffle(ids.splice(0))); st.boxAssign[t.id] = ids[i % ids.length]; }); await saveState(st); }
      else if (op === "score") { const pairs = Object.entries(b.scores || {}).flatMap(([k, v]) => [k, Number(v) || 0]); if (pairs.length) await store.cmd("HSET", K.score, ...pairs); cache = null; }
      else if (op === "move") { const p = d.players[b.pid]; if (p && st.teams.find(t => t.id === b.team)) { p.team = b.team; await store.cmd("HSET", K.players, b.pid, JSON.stringify(p)); cache = null; } }
      else if (op === "balance") {
        const ids = st.teams.map(t => t.id);
        const list = shuffle(Object.keys(d.players));
        const moves = [];
        list.forEach((pid, i) => { const p = d.players[pid]; const team = ids[i % ids.length]; if (p.team !== team) { p.team = team; moves.push(pid, JSON.stringify(p)); } });
        if (moves.length) await store.cmd("HSET", K.players, ...moves);
        cache = null;
      }
      else if (op === "kick") { await store.cmd("HDEL", K.players, b.pid); cache = null; }
      else if (op === "reset") {
        if (b.all) await store.cmd("DEL", K.state, K.players, K.rg, K.rgt, K.sub, K.score);
        else { await store.cmd("DEL", K.rg, K.rgt, K.sub, K.score); st.revealed = {}; st.boxAssign = {}; st.stage = { type: "lobby" }; await saveState(st); }
        cache = null;
      } else return send(res, 400, { ok: false });
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false });
  } catch (e) {
    return send(res, 500, { ok: false, message: String(e.message || e) });
  }
};
