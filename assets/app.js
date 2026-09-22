/* Analytics Arena — one script for 3 roles: player (phone), screen (projector), host (trainer). */
(() => {
const ROLE = document.body.dataset.role;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMOJIS = ["🦊","🐙","🦄","🐯","🐸","🐼","🦁","🐧","🐝","🦉","🐬","🌵","🍩","☕","🥐","🚀","🐱","🐶","🐨","🐵","🦋","🐢","🦈","🐲","👾","🤖","👻","🎃","⚡","🔥","🌈","⭐","🍕","🍔","🧁","🍉","🎮","🎧","📸","💎"];
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

let V = null, offset = 0, lastSig = "", lastDockSig = "", busy = false;
let pid = ls.get("mc-pid", null);
let pin = ls.get("mc-pin", null);
const drafts = ls.get("mc-drafts", {});
const now = () => Date.now() + offset;
const teamOf = id => (V && V.teams.find(t => t.id === id)) || { id, name: id };
const tname = id => esc(teamOf(id).name);

/* ---------------- network ---------------- */
async function api(method, body, qs = "") {
  const r = await fetch("/api/game" + qs, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error(j.message || "Connection problem"); err.code = j.error; err.status = r.status; throw err; }
  return j;
}
async function refresh() {
  if (ROLE === "host" && !pin) return; // wait until the trainer types the PIN
  if (busy) return; busy = true;
  try {
    const qs = ROLE === "host" ? "?pin=" + encodeURIComponent(pin || "") : ROLE === "player" && pid ? "?pid=" + encodeURIComponent(pid) : "";
    const j = await api("GET", null, qs);
    offset = j.now - Date.now(); V = j; hideError();
    if (ROLE === "player" && pid && j.me === null) { pid = null; ls.set("mc-pid", null); }
    render();
  } catch (e) {
    if (e.code === "pin") { pin = null; ls.set("mc-pin", null); if (!$("#f-pin")) renderPin(true); else { const er = $("#pinerr"); if (er) er.hidden = false; } }
    else showError(e.code === "db" ? e.message : "Reconnecting…");
  } finally { busy = false; }
}
function loop() { const ms = ROLE === "player" ? 1500 : 1000; refresh().finally(() => setTimeout(loop, document.hidden ? ms * 3 : ms)); }
async function post(body, okMsg) {
  try { await api("POST", body); if (okMsg) toast(okMsg); lastSig = ""; lastDockSig = ""; await refresh(); return true; }
  catch (e) { toast(e.message || "Something went wrong"); return false; }
}
const host = (op, extra = {}) => post({ a: "host", pin, op, ...extra });

/* ---------------- ui bits ---------------- */
function toast(m) { const d = document.createElement("div"); d.className = "toast"; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
function showError(m) { let e = $("#neterr"); if (!e) { e = document.createElement("div"); e.id = "neterr"; e.className = "toast"; e.style.background = "var(--red)"; e.style.color = "#fff"; document.body.appendChild(e); } e.textContent = m; }
function hideError() { const e = $("#neterr"); if (e) e.remove(); }
const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
let lastCd = null;
function tickCountdowns() {
  document.querySelectorAll("[data-cd]").forEach(el => {
    const left = (+el.dataset.cd - now()) / 1000;
    const txt = left > 3 ? "Ready?" : left > 0 ? String(Math.ceil(left)) : "GO!";
    if (el.textContent !== txt) {
      el.textContent = txt; el.classList.toggle("ready", left > 3);
      el.classList.remove("beat"); void el.offsetWidth; el.classList.add("beat");
      if (ROLE !== "player" && txt !== lastCd) { sfx(txt === "GO!" ? "reveal" : left > 3 ? "win" : "tick"); }
      lastCd = txt;
      if (ROLE === "player" && txt !== "Ready?" && navigator.vibrate) navigator.vibrate(txt === "GO!" ? 80 : 20);
    }
    if (left <= -0.5 && el.dataset.done !== "1") { el.dataset.done = "1"; lastSig = ""; render(); }
  });
}
setInterval(tickCountdowns, 100);
function tickTimers() {
  document.querySelectorAll("[data-ends]").forEach(el => {
    const end = +el.dataset.ends, start = +el.dataset.start || end - 20000;
    const left = (end - now()) / 1000, frac = Math.max(0, Math.min(1, (end - now()) / Math.max(1, end - start)));
    const t = el.querySelector("[data-t]"); if (t) t.textContent = left > 0 ? fmt(left) : "0:00";
    el.style.setProperty("--p", frac);
    const bar = el.querySelector("i"); if (bar && el.classList.contains("tbar")) bar.style.width = frac * 100 + "%";
    el.classList.toggle("low", left <= 5);
    if (ROLE !== "player" && left <= 5 && left > 0) tickSound(Math.ceil(left));
    if (left <= 0 && el.dataset.done !== "1") { el.dataset.done = "1"; if (ROLE !== "player") sfx("end"); else if (left > -2.5) setTimeout(() => { lastSig = ""; render(); }, 1600); }
  });
}
setInterval(tickTimers, 200);
function timerAttr(stg) { return stg && stg.endsAt ? `data-ends="${stg.endsAt}" data-start="${stg.startsAt || stg.endsAt - 20000}"` : ""; }
function ring(stg, big) { return stg && stg.endsAt ? `<div class="ring ${big ? "big" : ""}" ${timerAttr(stg)}><span data-t>…</span></div>` : ""; }
function tbar(stg) { return stg && stg.endsAt ? `<div class="tbar" ${timerAttr(stg)}><i></i></div>` : ""; }
const timeUp = stg => stg && stg.endsAt && now() > stg.endsAt;

/* sound (screen + host only, after a click) */
let AC = null, soundOn = false, lastTick = 0;
function sfx(kind) {
  if (!soundOn) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { tick: [[880, 0, .06]], end: [[440, 0, .18], [330, .2, .35]], reveal: [[523, 0, .12], [659, .12, .12], [784, .24, .25]], win: [[523, 0, .15], [659, .15, .15], [784, .3, .15], [1047, .45, .5]], join: [[1200, 0, .05]] }[kind] || [];
    notes.forEach(([f, d, len]) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = "square"; o.frequency.value = f; o.connect(g); g.connect(AC.destination); const t = AC.currentTime + d; g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.001, t + len); o.start(t); o.stop(t + len + .02); });
  } catch (e) {}
}
function tickSound(s) { if (s !== lastTick) { lastTick = s; sfx("tick"); } }

/* confetti */
function confetti(n = 160) {
  let c = $("#confetti"); if (!c) { c = document.createElement("canvas"); c.id = "confetti"; document.body.appendChild(c); }
  const x = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
  const cols = ["#3D8FD1", "#8CCBEB", "#E6F6FF", "#1FCB6A", "#FFC23D"];
  const P = Array.from({ length: n }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 4, vy: 2 + Math.random() * 4, r: Math.random() * 6.3, s: 6 + Math.random() * 8, c: cols[Math.floor(Math.random() * cols.length)] }));
  let f = 0; (function step() { x.clearRect(0, 0, c.width, c.height); P.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .05; p.r += .1; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }); if (++f < 240) requestAnimationFrame(step); else x.clearRect(0, 0, c.width, c.height); })();
}

/* drafts keep what people type safe across re-renders */
document.addEventListener("input", e => { const el = e.target; if (el.dataset.draft) { drafts[el.dataset.draft] = el.value; ls.set("mc-drafts", drafts); } });
function draft(key, fallback) { return drafts[key] ?? fallback ?? ""; }
function typing() { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName); }

const SHAPES = { A: "▲", B: "◆", C: "●", D: "■" };
function ansLabel(c) { if (c.type === "mcq") { const i = "ABCD".indexOf(c.a); return `${SHAPES[c.a]} ${c.a}) ${esc(c.opts[i])}`; } return c.a === "R" ? "🚩 Red flag" : "✅ Green flag"; }
const ptsTxt = n => n + (n > 1 ? " points" : " point");
const inCountdown = st => st && st.type === "rg" && st.phase === "vote" && st.startsAt && now() < st.startsAt;
function levelTitle(c) {
  if (c.round === "F") return ["🚩 Final flag", "One last statement"];
  if (c.kind === "app") return ["⚡ Transfer challenge", c.roundName];
  if (c.kind === "bonus") return ["⭐ Bonus round", c.rule];
  return ["🔓 " + String(c.level || "").split("—")[0].trim() + " unlocked", c.rule];
}
function countdownHTML(c, st, phone) {
  const lv = levelTitle(c);
  return `<div class="${phone ? "pcdwrap" : "cdwrap"}"><div class="eyebrow">${esc(c.roundName)}${c.idx ? "" : " · " + esc(c.level || "")}</div>
    ${c.idx === 0 ? `<div class="lvl-up">${esc(lv[0])}</div><div class="lvl-sub">${esc(lv[1])}</div>` : `<div class="disp ${phone ? "" : "sh2"}" style="${phone ? "font-size:30px" : ""}">Question ${c.idx + 1} of ${c.total}</div>`}
    <div class="cd ready" data-cd="${st.startsAt}">Ready?</div></div>`;
}
function patHTML(p) { return p.map(([n, d]) => `${esc(n)} <span class="${d === "up" ? "up" : "down"}">${d === "up" ? "↑" : d === "down" ? "↓" : "= 0"}</span>`).join(" + "); }

/* =====================================================================
   PLAYER
   ===================================================================== */
let join = { team: null, emoji: ls.get("mc-emoji", EMOJIS[Math.floor(Math.random() * EMOJIS.length)]) };
let lastResultQ = null, editing = false;
function renderPlayer() {
  const app = $("#app");
  if (!V) { app.innerHTML = `<div class="phone"><div class="wait"><span class="em">⏳</span><p>Connecting…</p></div></div>`; return; }
  if (!pid || !V.me || editing) return renderJoin(app);
  const me = V.me, stg = V.stage, cur = V.cur;
  const sig = JSON.stringify([stg, me, cur && { ...cur, voted: 0, of: 0, notes: 0 }, V.teams]);
  if (sig === lastSig) return;
  let prev = null; try { prev = JSON.parse(lastSig)[0]; } catch (e) {}
  if (typing() && prev && prev.type === stg.type && prev.phase === stg.phase) return;
  lastSig = sig;
  const head = `<header><div class="me-badge tcol" data-t="${me.team}"><span class="em">${esc(me.emoji)}</span>${esc(me.name)} · ${tname(me.team)}</div>
    <div class="score-badge">⭐ ${me.score}</div></header>`;
  let body = "";
  const t = stg.type, ph = stg.phase;
  if (t === "lobby") {
    const mates = V.players.filter(p => p.team === me.team);
    body = `<div class="pcard wait"><span class="em">${esc(me.emoji)}</span><h2 class="disp bigtitle">You're in!</h2><p class="muted">Eyes on the big screen — the game starts soon.</p>
      <div class="eyebrow" style="margin-top:18px">${tname(me.team)} · ${mates.length} players</div><div class="mates">${mates.map(p => `<span>${esc(p.emoji)} ${esc(p.name)}</span>`).join("")}</div>
      <button class="btn ghost sm" style="margin-top:18px" data-act="rejoin">Change name or team</button></div>`;
  } else if (t === "rg" && ph === "summary") {
    body = `<div class="pcard wait"><span class="em">🏁</span><h2 class="disp bigtitle">${esc(cur.roundName)} done</h2>
      <div class="stats3" style="margin-top:16px"><div><span class="eyebrow">Your score</span><b>${me.score}/${me.outOf}</b></div><div><span class="eyebrow">Your rank</span><b>#${me.rank}</b></div></div>
      <p class="muted" style="margin-top:14px">${esc(cur.takeaway)}</p></div>`;
  } else if (t === "rg") {
    if (ph === "reveal") {
      const cls = !me.vote ? "none" : me.correct ? "ok" : "no";
      body = `<div class="splash ${cls}"><div class="disp">${!me.vote ? "No vote" : me.correct ? "Correct!" : "Not this time"}</div>
        <p>${me.correct ? "+" + ptsTxt(cur.pts) + " ⭐" : !me.vote ? "You didn't vote on this one." : "Listen to the explanation 👀"}</p></div>
        <div class="pcard"><div class="eyebrow">Answer</div><p style="margin:4px 0 0;font-weight:700;font-size:18px">${ansLabel(cur)}</p><p style="margin:8px 0 0;font-size:18px">${esc(cur.e)}</p></div>
        <div class="stats3"><div><span class="eyebrow">Score</span><b>${me.score}/${me.outOf}</b></div><div><span class="eyebrow">Rank</span><b>#${me.rank}</b></div></div>`;
      if (lastResultQ !== cur.qid) { lastResultQ = cur.qid; if (me.correct) { confetti(90); navigator.vibrate && navigator.vibrate(60); } else if (me.vote) navigator.vibrate && navigator.vibrate([40, 60, 40]); }
    } else if (inCountdown(stg)) {
      body = `<div class="pcard">${countdownHTML(cur, stg, true)}</div>`;
    } else {
      const closed = timeUp(stg);
      const onoff = k => me.vote === k ? "on" : me.vote ? "off" : "";
      const btns = cur.type === "mcq"
        ? `<div class="mcq">${cur.opts.map((o, i) => { const k = "ABCD"[i]; return `<button class="opt o${k} ${onoff(k)}" data-act="vote" data-v="${k}" ${closed ? "disabled" : ""}><span class="sh">${SHAPES[k]}</span><span>${esc(o)}</span></button>`; }).join("")}</div>`
        : `<div class="votebtns">
          <button class="vote r ${onoff("R")}" data-act="vote" data-v="R" ${closed ? "disabled" : ""}>🚩 Red flag</button>
          <button class="vote g ${onoff("G")}" data-act="vote" data-v="G" ${closed ? "disabled" : ""}>✅ Green flag</button>
        </div>`;
      body = `<div class="eyebrow">${esc(cur.roundName)} · ${cur.idx + 1}/${cur.total}${cur.pts > 1 ? " · " + ptsTxt(cur.pts) : ""}</div>
        <p class="pstatement">${esc(cur.t)}</p>${tbar(stg)}
        ${btns}
        <p class="lock">${closed ? "⏰ Time's up" : me.vote ? "🔒 Locked in — tap the other one to change" : "Tap your answer"}</p>`;
    }
  } else if (t === "say") {
    if (ph === "reveal") body = waitCard("👀", "Eyes on the screen", "Let's see what every team wrote.");
    else {
      const key = `say:${cur.id}:${me.team}`; const ts = me.teamSub;
      body = `<div class="pcard"><div class="eyebrow">Team game · Case ${cur.id}</div><div class="pattern-sm" style="margin:8px 0">${patHTML(cur.pat)}</div>
        <p>Say this result like a human, in <b>ONE</b> sentence. Arabic or English — one answer per team.</p>${tbar(stg)}
        <div class="field" style="margin-top:12px"><textarea class="input" id="f-say" data-draft="${key}" dir="auto" maxlength="300" placeholder="وصلنا لـ… بس…">${esc(draft(key, ts && ts.text))}</textarea></div>
        <button class="btn primary cta" style="margin-top:12px" data-act="submitSay" ${timeUp(stg) ? "disabled" : ""}>${ts ? "Update team answer" : "Send team answer"}</button>
        ${ts ? `<p class="saved">✓ Saved by ${esc(ts.by)} — anyone in your team can still edit</p>` : ""}</div>`;
    }
  } else if (t === "box") {
    const b = me.box && cur.boxes.find(x => x.id === me.box);
    if (!b) body = waitCard("🎁", "Waiting for the draw", "Your team will get one sealed box.");
    else if (ph === "reveal") body = waitCard("👀", "Answers revealed", "Check the big screen.");
    else if (ph !== "answer") body = `<div class="pcard wait"><span class="em">🎁</span><div class="eyebrow">${tname(me.team)} got</div><h2 class="disp bigtitle">Box ${b.id}</h2><p><b>${esc(b.format)}</b> · ${esc(b.content)}</p><p class="muted">Get ready…</p></div>`;
    else body = boxForm(b, me);
  } else if (t === "boss") {
    if (ph === "note") {
      const key = "note"; body = `<div class="pcard"><div class="eyebrow">Individual · silent · 2 min</div><h2 class="disp" style="font-size:34px">Your own note</h2>
        <p>Look at the case on the screen. Where is the first drop-off, what is your hypothesis, and what evidence supports it?</p>${tbar(stg)}
        <textarea class="input" id="f-note" data-draft="${key}" dir="auto" maxlength="800" style="min-height:170px;margin-top:10px">${esc(draft(key, me.note && me.note.text))}</textarea>
        <button class="btn primary cta" style="margin-top:12px" data-act="submitNote" ${timeUp(stg) ? "disabled" : ""}>${me.note ? "Update my note" : "Send my note"}</button>
        ${me.note ? `<p class="saved">✓ Note saved — only your trainer sees it</p>` : ""}</div>`;
    } else if (ph === "team") body = bossForm(me);
    else if (ph === "reveal") body = waitCard("👾", `Boss HP: ${V.cur.hp}%`, "Every good answer hits the boss. Watch the screen!");
    else body = waitCard("⚔️", "Boss fight incoming", "Read the case on the screen.");
  } else if (t === "board") {
    body = stg.winner ? waitCard("🏆", "Winner on screen!", `Your final Red/Green score: ${me.score}/${me.outOf}`) : waitCard("📊", "Scoreboard", "Eyes on the screen…");
  }
  app.innerHTML = `<div class="phone">${head}${body}</div>`;
  tickTimers();
}
function waitCard(em, h, p) { return `<div class="pcard wait"><span class="em">${em}</span><h2 class="disp" style="font-size:36px">${esc(h)}</h2><p class="muted">${esc(p)}</p></div>`; }

let boxPick = null;
function boxForm(b, me) {
  const ts = me.teamSub && me.teamSub.box === b.id ? me.teamSub : null;
  const k = "box:" + b.id;
  if (!boxPick || boxPick.k !== k) boxPick = { k, primary: ts ? ts.primary : null, secondary: ts ? ts.secondary : null, diag: ts ? ts.diag.slice() : [] };
  const chips = (field, multi) => `<div class="row">${b.metrics.map(m => { const on = multi ? boxPick.diag.includes(m) : boxPick[field] === m; return `<button class="chip ${m === b.trap ? "trap" : ""}" data-act="pick" data-f="${field}" data-m="${esc(m)}" aria-pressed="${on}">${esc(m)}${m === b.trap ? " 🔥" : ""}</button>`; }).join("")}</div>`;
  return `<div class="pcard"><div class="eyebrow">Mystery Box ${b.id} · ${esc(b.level)} · ${esc(b.format)}</div><h2 class="disp" style="font-size:32px;margin-top:6px">${esc(b.objective)}</h2><p style="margin:4px 0 10px">${esc(b.content)}</p>${tbar(stg())}
    <p class="muted" style="font-size:14px">🔥 = looks VERY HIGH… is it really the proof?</p>
    <div class="qblock"><div class="qh"><span>1</span>Primary KPI — pick one</div>${chips("primary")}</div>
    <div class="qblock"><div class="qh"><span>2</span>Secondary KPI — pick one</div>${chips("secondary")}</div>
    <div class="qblock"><div class="qh"><span>3</span>Diagnostics — pick any</div>${chips("diag", true)}</div>
    <div class="qblock"><div class="qh"><span>4</span>Why?</div><textarea class="input" id="f-why" data-draft="${k}:why" dir="auto" maxlength="300">${esc(draft(k + ":why", ts && ts.why))}</textarea></div>
    <button class="btn primary cta" data-act="submitBox" ${timeUp(stg()) ? "disabled" : ""}>${ts ? "Update team answer" : "Send team answer"}</button>
    ${ts ? `<p class="saved">✓ Saved by ${esc(ts.by)}</p>` : ""}</div>`;
}
const stg = () => V.stage;
function bossForm(me) {
  const ts = me.teamSub; const a = ts ? ts.a : [];
  const qs = V.cur.qs;
  return `<div class="pcard"><div class="eyebrow">Team answer sheet · ${tname(me.team)}</div><h2 class="disp" style="font-size:32px;margin-top:4px">Boss fight</h2>${tbar(stg())}
    ${qs.map((q, i) => {
      const key = "boss:" + i; const val = draft(key, a[i]);
      let ctl;
      if (q.kind === "yesno") ctl = `<div class="row">${["Yes", "No"].map(o => `<button class="chip" data-act="bossPick" data-i="${i}" data-o="${o}" aria-pressed="${val === o}">${o}</button>`).join("")}</div>`;
      else if (q.kind === "drop") ctl = `<div class="row">${V.cur.drop.map(o => `<button class="chip" data-act="bossPick" data-i="${i}" data-o="${esc(o)}" aria-pressed="${val === o}">${esc(o)}</button>`).join("")}</div>`;
      else ctl = `<textarea class="input" id="f-b${i}" data-draft="${key}" dir="auto" maxlength="400" style="min-height:80px">${esc(val)}</textarea>`;
      return `<div class="qblock"><div class="qh"><span>Q${i + 1}</span>${esc(q.q)} <span class="muted mono" style="color:var(--dim)">${q.pts}pt</span></div>${ctl}</div>`;
    }).join("")}
    <button class="btn primary cta" data-act="submitBoss" ${timeUp(stg()) ? "disabled" : ""}>${ts ? "Update team sheet" : "Send team sheet"}</button>
    ${ts ? `<p class="saved">✓ Saved by ${esc(ts.by)}</p>` : ""}</div>`;
}
function renderJoin(app) {
  if (lastSig === "join" && typing()) return;
  lastSig = "join";
  const teams = V.teams;
  const nm = draft("join:name", ls.get("mc-name", ""));
  app.innerHTML = `<div class="phone"><header><div class="logo"><img src="/assets/logo.png" alt="" onerror="this.remove()"><i></i><span>Analytics <b>Arena</b></span></div></header>
   <img class="pmascot" src="/assets/logo.png" alt="" onerror="this.remove()"><div class="pcard"><h2 class="disp bigtitle">Join the game</h2><p class="muted">Red flag or green flag? Let's see how you read the numbers.</p>
    <div class="field" style="margin-top:14px"><label for="f-name">Your name</label><input class="input" id="f-name" data-draft="join:name" maxlength="24" autocomplete="given-name" value="${esc(nm)}" placeholder="e.g. Sara"></div>
    <div class="field" style="margin-top:16px"><label>Your team</label><div class="teampick">${teams.map(t => `<button class="tcol" data-t="${t.id}" data-act="team" data-id="${t.id}" aria-pressed="${join.team === t.id}">${esc(t.name)}<br><small class="mono" style="font-weight:500">${V.players.filter(p => p.team === t.id).length} in</small></button>`).join("")}</div></div>
    <div class="field" style="margin-top:16px"><label>Pick your avatar</label><div class="emojis">${EMOJIS.map(e => `<button data-act="emoji" data-e="${e}" aria-pressed="${join.emoji === e}">${e}</button>`).join("")}</div></div>
    <button class="btn red cta" style="margin-top:20px" data-act="join">Join ▶</button></div></div>`;
}
async function playerAct(a, d) {
  if (a === "team") { join.team = d.id; lastSig = ""; render(); }
  else if (a === "emoji") { join.emoji = d.e; ls.set("mc-emoji", d.e); lastSig = ""; render(); }
  else if (a === "join") {
    const name = ($("#f-name").value || "").trim();
    if (!name) return toast("Write your name first");
    if (!join.team) return toast("Pick your team");
    try { const j = await api("POST", { a: "join", name, team: join.team, emoji: join.emoji, pid }); pid = j.pid; editing = false; ls.set("mc-pid", pid); ls.set("mc-name", name); lastSig = ""; await refresh(); }
    catch (e) { toast(e.message); }
  }
  else if (a === "rejoin") { join.team = V.me.team; join.emoji = V.me.emoji; drafts["join:name"] = V.me.name; editing = true; lastSig = ""; render(); }
  else if (a === "vote") { if (navigator.vibrate) navigator.vibrate(25); V.me.vote = d.v; lastSig = ""; renderPlayer(); await post({ a: "vote", pid, qid: V.cur.qid, v: d.v }); }
  else if (a === "submitSay") { const text = $("#f-say").value.trim(); if (!text) return toast("Write one sentence first"); await post({ a: "submit", pid, data: { text } }, "Team answer sent ✓"); }
  else if (a === "pick") {
    if (d.f === "diag") { const i = boxPick.diag.indexOf(d.m); i >= 0 ? boxPick.diag.splice(i, 1) : boxPick.diag.push(d.m); }
    else boxPick[d.f] = boxPick[d.f] === d.m ? null : d.m;
    lastSig = ""; render();
  }
  else if (a === "submitBox") {
    if (!boxPick.primary) return toast("Pick a Primary KPI");
    await post({ a: "submit", pid, data: { primary: boxPick.primary, secondary: boxPick.secondary, diag: boxPick.diag, why: ($("#f-why").value || "").trim() } }, "Team answer sent ✓");
  }
  else if (a === "bossPick") { drafts["boss:" + d.i] = d.o; ls.set("mc-drafts", drafts); lastSig = ""; render(); }
  else if (a === "submitBoss") { const ans = V.cur.qs.map((q, i) => (q.kind === "text" ? ($("#f-b" + i) || {}).value : drafts["boss:" + i]) || ""); await post({ a: "submit", pid, data: { a: ans } }, "Team sheet sent ✓"); }
  else if (a === "submitNote") { const text = $("#f-note").value.trim(); if (!text) return toast("Write your note first"); await post({ a: "submit", pid, data: { text } }, "Note saved ✓"); }
}

/* =====================================================================
   SCREEN (also used inside the host page)
   ===================================================================== */
let prevPlayers = 0, prevPhaseKey = "", prevHP = null;
function screenHTML() {
  const s = V.stage, c = V.cur, t = s.type, ph = s.phase;
  const top = `<div class="sbar"><div class="logo"><img src="/assets/logo.png" alt="" onerror="this.remove()"><i></i><span>Analytics <b>Arena</b></span></div><div class="count">👥 ${V.players.length} players</div></div>`;
  let h = "";
  if (t === "lobby") {
    const url = location.origin.replace(/^https?:\/\//, "");
    h = `<div class="joinbox"><div class="qr" id="qr"></div><div><div class="eyebrow">Join on your phone</div><div class="url">${esc(url)}</div>
      <p class="sh2 disp" style="margin:.4em 0 0">Name · team · go</p></div><img class="mascot" src="/assets/logo.png" alt="" onerror="this.remove()"></div>
      <div class="teams">${V.teams.map(tm => { const ps = V.players.filter(p => p.team === tm.id); return `<div class="team tcol" data-t="${tm.id}"><h3 class="disp">${esc(tm.name)} <span class="mono muted" style="font-size:.6em">${ps.length}</span></h3><div class="pl">${ps.map(p => `<span>${esc(p.emoji)} ${esc(p.name)}</span>`).join("")}</div></div>`; }).join("")}</div>`;
  } else if (t === "rg" && ph === "summary") {
    h = `<div class="eyebrow">${esc(c.roundName)} · ${esc(c.level)}</div><div class="summary"><div>${c.items.map(it => `<div class="sumrow"><span class="sq" style="background:${it.a === "R" ? "var(--red)" : it.a === "G" ? "var(--green)" : it.a ? "var(--sky)" : "var(--line2)"}"></span><span>${esc(it.t)}</span><span class="row" style="flex-wrap:nowrap"><span class="hbar" style="flex:1"><i style="width:${it.pct || 0}%"></i></span><span class="mono">${it.pct == null ? "—" : it.pct + "%"}</span></span></div>`).join("")}</div>
      <div><div class="eyebrow" style="margin-bottom:.6em">Top players · out of ${c.outOf}</div><div class="podium">${c.top.length ? c.top.map((p, i) => `<div class="pod"><span class="rk">#${i + 1}</span><span style="font-size:1.4em">${esc(p.emoji)}</span><span>${esc(p.name)}</span><b>${p.s}</b></div>`).join("") : `<p class="muted">No points yet.</p>`}</div></div></div>
      <div class="takeaway">Takeaway: <span>${esc(c.takeaway)}</span></div>`;
  } else if (t === "rg" && inCountdown(s)) {
    h = countdownHTML(c, s, false);
  } else if (t === "rg") {
    const rev = ph === "reveal"; const tot = rev ? Object.values(c.c).reduce((a, b) => a + b, 0) : 0; const pct = k => tot ? Math.round(c.c[k] / tot * 100) : 0;
    const choicesHTML = c.type === "mcq"
      ? `<div class="sopts">${c.opts.map((o, i) => { const k = "ABCD"[i]; return `<div class="sopt o${k} ${rev ? (c.a === k ? "win" : "lose") : ""}"><span class="sh">${SHAPES[k]}</span><span class="tx">${esc(o)}</span>${rev ? `<span class="pc">${pct(k)}%</span>` : ""}</div>`; }).join("")}</div>`
      : `<div class="flags">${["R", "G"].map(k => `<div class="flag ${k.toLowerCase()} ${rev ? (c.a === k ? "win" : "lose") : ""}"><div style="flex:1"><div class="disp">${k === "R" ? "🚩 Red flag" : "✅ Green flag"}</div>${rev ? `<div class="vbar"><i style="width:${pct(k)}%"></i></div>` : ""}</div>${rev ? `<div class="pct">${pct(k)}%</div>` : ""}</div>`).join("")}</div>`;
    h = `<div class="row"><div class="eyebrow">${esc(c.roundName)} · ${esc(c.level)} · ${c.idx + 1}/${c.total}${c.pts > 1 ? " · " + ptsTxt(c.pts) : ""}</div><div class="spacer"></div>${c.mic && rev ? `<div class="mic">🎤 ${esc(c.mic.emoji)} ${esc(c.mic.name)}</div>` : ""}</div>
      <p class="big-statement ${c.type === "mcq" ? "q" : ""}">${esc(c.t)}</p>
      ${choicesHTML}
      ${rev ? `<div class="explain ${c.d ? "" : "one"}"><div><div class="eyebrow">Why</div><p>${esc(c.e)}</p></div>${c.d ? `<div class="disc"><div class="eyebrow">Discuss</div><p>${esc(c.d)}</p></div>` : ""}</div>`
        : `<div class="meta">${ring(s, true)}<div><div class="voted mono">${c.voted}/${c.of}</div><div class="eyebrow">voted</div></div><div class="dotsrow">${V.players.map((p, i) => `<span class="${i < c.voted ? "in" : ""}"></span>`).join("")}</div></div>`}`;
  } else if (t === "say") {
    const rev = ph === "reveal";
    h = `<div class="row"><div class="eyebrow">Say it like a human · Case ${c.id} · team game</div><div class="spacer"></div>${!rev ? ring(s) : ""}</div>
      <div class="pattern">${patHTML(c.pat)}</div>
      ${!rev ? `<p class="sh2 disp" style="margin:0">Say it like a human. One sentence.</p>
        <div class="teams">${V.teams.map(tm => { const ok = c.submitted.includes(tm.id); return `<div class="team tcol" data-t="${tm.id}"><h3 class="disp">${esc(tm.name)}</h3><div class="st ${ok ? "ok" : ""}">${ok ? "✓ Answer in" : "✍️ Writing…"}</div></div>`; }).join("")}</div>`
      : `<div class="answers">${V.teams.map(tm => { const a = (c.answers || []).find(x => x.tid === tm.id); return `<div class="ans tcol" data-t="${tm.id}"><h4>${esc(tm.name)}</h4><p dir="auto">${a ? esc(a.text) : "<span class='muted'>No answer</span>"}</p></div>`; }).join("")}</div>
        <div class="kv"><div style="grid-column:1/-1;border-color:var(--green)"><div class="eyebrow">Model answer</div><p style="font-size:2em;font-weight:700;margin:.2em 0 0">“${esc(c.model.human)}”</p>${c.model.humanAr ? `<p class="human" style="font-size:1.4em;color:var(--muted)">${esc(c.model.humanAr)}</p>` : ""}</div><div><div class="eyebrow">Analytical meaning</div><p>${esc(c.model.meaning)}</p></div><div><div class="eyebrow">First action</div><p>${esc(c.model.action)}</p></div><div><div class="eyebrow">Bonus variant</div><p dir="auto">${esc(c.model.variant)}</p></div></div>`}`;
  } else if (t === "box") {
    const drawn = Object.keys(c.assign || {}).length > 0; const rev = ph === "reveal";
    const owner = bid => Object.keys(c.assign).find(k => c.assign[k] === bid);
    h = `<div class="row"><div class="eyebrow">Mystery box · one sealed case per team</div><div class="spacer"></div>${ph === "answer" ? ring(s) : ""}</div>`;
    if (!drawn) h += `<div class="boxes">${["A", "B", "C", "D"].map(() => `<div class="box sealed"><div class="q">?</div></div>`).join("")}</div>`;
    else h += `<div class="boxes">${V.teams.filter(tm => c.assign[tm.id]).map(tm => { const tid = tm.id; const b = c.boxes.find(x => x.id === c.assign[tid]); const pk = rev && c.picks && c.picks[tid]; const ex = rev && c.expected[b.id];
      const mark = (val, list) => !val ? `<span class="muted">—</span>` : `${esc(val)} ${list.length === 0 ? "" : list.includes(val) ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'}`;
      return `<div class="box tcol" data-t="${tid}"><div class="row" style="justify-content:space-between"><span class="letter">${b.id}</span><span class="own">${tname(tid)}${ph === "answer" && c.submitted.includes(tid) ? " ✓" : ""}</span></div>
        <div class="eyebrow">${esc(b.level)} · ${esc(b.format)}</div><div>${esc(b.content)}</div><div class="obj">${esc(b.objective)}</div>
        ${rev ? `<div class="pick"><span class="k">Primary</span><span>${pk ? mark(pk.primary, ex.ex.p) + (pk.primary === b.trap ? ' <span class="no">TRAP!</span>' : "") : "—"}</span></div>
          <div class="pick"><span class="k">Secondary</span><span>${pk ? mark(pk.secondary, ex.ex.s) : "—"}</span></div>
          <div class="pick"><span class="k">Diag</span><span>${pk && pk.diag.length ? pk.diag.map(esc).join(", ") : "—"}</span></div>
          <div style="margin-top:.4em"><div class="eyebrow">Expected</div><b>${esc(ex.primary)}</b><div class="muted" style="font-size:.9em">+ ${esc(ex.secondary)} · ${esc(ex.diag)}</div><div style="font-size:.9em;margin-top:.3em">${esc(ex.why)}</div></div>`
        : `<div class="mchips">${b.metrics.map(m => `<span class="${m === b.trap ? "trap" : ""}">${esc(m)}${m === b.trap ? " 🔥 VERY HIGH" : ""}</span>`).join("")}</div>`}</div>`; }).join("")}</div>`;
  } else if (t === "boss") {
    const k = c.case; const rev = ph === "reveal"; const qi = s.q ?? 0;
    const left = `<div><div class="eyebrow">${esc(k.brand)} · ${esc(k.offer)} · Objective: ${esc(k.objective)}</div>
      <div class="kpi" style="margin-top:.5em"><div><div class="eyebrow">Target · ${esc(k.kpi)}</div><div class="v">${k.target}%</div></div><div><div class="eyebrow">Actual</div><div class="v miss">${k.actual}%</div></div></div>
      <div class="meter"><i style="width:${k.actual / 5 * 100}%"></i><b style="left:${k.target / 5 * 100}%"></b></div>
      <ul class="sdata" style="margin-top:.8em">${k.data.map(r => `<li>${esc(r[0])}<span class="lvl ${r[2]}">${esc(r[1])}</span></li>`).join("")}</ul>
      <div class="rule" style="margin-top:.8em">No diagnosis without evidence.</div></div>`;
    let right;
    if (rev) {
      const q = c.qs[qi]; const key = qi <= (s.q ?? -1) ? (V.host ? c.keys[qi] : c.keys[qi]) : null;
      right = `<div><div class="row"><div class="qdots">${c.qs.map((_, i) => `<span class="${i === qi ? "on" : i < qi ? "done" : ""}"></span>`).join("")}</div></div>
        <div class="qcard" style="margin-top:.8em"><div class="eyebrow">Q${qi + 1} · ${q.pts} pts</div><div class="qq">${esc(q.q)}</div>${key ? `<div class="keyline"><b>Key:</b> ${esc(key)}</div>` : ""}
        <div class="teamans">${V.teams.map(tm => { const sh = c.sheets && c.sheets[tm.id]; return `<div class="tcol" data-t="${tm.id}"><b>${esc(tm.name)}</b><p dir="auto">${sh && sh.a[qi] ? esc(sh.a[qi]) : "<span class='muted'>—</span>"}</p></div>`; }).join("")}</div></div></div>`;
    } else {
      const lbl = ph === "note" ? ["① Individual note", "Silent. On your own phone. 2 minutes."] : ph === "team" ? ["② Team answer", "One answer sheet per team. Answer 1–4 first."] : ["Boss fight", "Read the case. Where does the journey break?"];
      right = `<div style="display:grid;gap:1em;align-content:start"><div class="phasebig">${ring(s, true)}<div><div class="disp sh2">${lbl[0]}</div><p class="muted" style="margin:.3em 0 0;font-size:1.2em">${lbl[1]}</p></div></div>
        ${ph === "note" ? `<div class="voted mono">${c.notes}/${V.players.length} <span class="eyebrow">notes in</span></div>` : ""}
        ${ph === "team" ? `<div class="teams" style="grid-template-columns:repeat(auto-fit,minmax(10em,1fr))">${V.teams.map(tm => { const ok = c.submitted.includes(tm.id); return `<div class="team tcol" data-t="${tm.id}" style="min-height:0"><h3 class="disp">${esc(tm.name)}</h3><div class="st ${ok ? "ok" : ""}">${ok ? "✓ Sheet in" : "⚔️ Fighting…"}</div></div>`; }).join("")}</div>` : ""}
        <div class="qcard"><div class="eyebrow">The 7 questions</div><ol style="margin:.4em 0 0;padding-left:1.3em;font-size:1.1em">${c.qs.map(q => `<li>${esc(q.q)}</li>`).join("")}</ol></div></div>`;
    }
    const hit = prevHP != null && c.hp < prevHP; prevHP = c.hp;
    const hpbar = `<div class="bosshp ${hit ? "hit" : ""} ${c.hp === 0 ? "dead" : ""}"><div class="bn">👾 ${c.hp === 0 ? "Boss defeated!" : "Boss · The missed KPI"}</div>
      <div class="hp"><i style="width:${c.hp}%"></i></div><div class="hpn mono">${c.hp}% HP</div>
      <div class="dmg">${V.teams.map(tm => `<span class="tcol" data-t="${tm.id}">⚔️ ${esc(tm.name)} ${c.dmg[tm.id] || 0}</span>`).join("")}</div></div>`;
    h = `${hpbar}<div class="bossgrid">${left}${right}</div>`;
  } else if (t === "board") {
    const cols = [["Say it", "say", c.max.say, "var(--t4)"], ["Mystery box", "box", c.max.box, "var(--t2)"], ["Boss fight", "boss", c.max.boss, "var(--t1)"]];
    const MAX = c.max.say + c.max.box + c.max.boss; const top = c.rows[0]; const winners = c.rows.filter(r => r.total === top.total && top.total > 0);
    h = `<div class="row"><h2 class="disp sh" style="margin:0">Scoreboard</h2><div class="spacer"></div><div class="legend">${cols.map(x => `<span style="--c:${x[3]}">${x[0]} /${x[2]}</span>`).join("")}</div></div>
      <div class="board">${c.rows.map((r, i) => `<div class="brow tcol ${c.winner && winners.includes(r) ? "win" : ""}" data-t="${r.tid}" style="animation-delay:${i * .12}s"><span class="rk">#${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="trk">${cols.map(x => `<i style="width:${r[x[1]] / MAX * 100}%;background:${x[3]}"></i>`).join("")}</span><span class="tot">${r.total}</span></div>`).join("")}</div>
      ${c.winner && winners.length ? `<div class="winner"><img class="wmascot" src="/assets/logo.png" alt="" onerror="this.remove()">${winners.map(w => `<div class="w tcol" data-t="${w.tid}">🏆 ${esc(w.name)}</div>`).join("")}<div class="takeaway" style="margin-top:.3em">Turn numbers into <span>action.</span></div></div>` : ""}`;
  }
  return top + `<div class="stage">${h}</div>`;
}
function renderScreen(root) {
  const sig = JSON.stringify([V.stage, V.cur && { ...V.cur, notVoted: 0, keys: V.stage.type === "boss" ? V.stage.q : 0 }, V.players, V.teams, inCountdown(V.stage)]);
  if (sig === lastSig) return;
  lastSig = sig;
  root.innerHTML = `<div class="screen">${screenHTML()}</div>`;
  if (V.stage.type === "lobby") drawQR();
  if (V.players.length > prevPlayers && prevPlayers) sfx("join");
  prevPlayers = V.players.length;
  const pk = V.stage.type + ":" + V.stage.phase + ":" + (V.cur && V.cur.qid) + ":" + V.stage.winner + ":" + V.stage.q;
  if (pk !== prevPhaseKey) {
    if (V.stage.phase === "reveal") sfx("reveal");
    if (V.stage.type === "board" && V.stage.winner) { sfx("win"); confetti(260); }
    prevPhaseKey = pk;
  }
  tickTimers();
}
function drawQR() {
  const el = $("#qr"); if (!el) return;
  if (window.QRCode) { el.innerHTML = ""; try { new QRCode(el, { text: location.origin + "/", width: 400, height: 400, colorDark: "#0B2238", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); } catch (e) {} }
  else el.innerHTML = `<span style="color:#000;text-align:center;font-weight:700">Open the link →</span>`;
}

/* =====================================================================
   HOST
   ===================================================================== */
const SECTIONS = [["lobby", "Lobby"], ["rg:1", "R/G 1"], ["say", "Say it"], ["rg:RATES", "A vs B"], ["rg:2", "R/G 2"], ["rg:PULSE", "PULSE"], ["box", "Mystery box"], ["rg:3", "KPI round"], ["rg:QB", "QUICKBITE"], ["rg:4", "R/G 4"], ["rg:VOLT", "VOLT"], ["boss", "Boss fight"], ["rg:F", "Final flag"], ["board", "Scoreboard"], ["rg:BANK", "Bonus quiz"]];
let dockMin = ls.get("mc-dockmin", false);
function renderPin(bad) {
  $("#app").innerHTML = `<div class="pinwrap"><div class="pcard" style="max-width:420px;width:100%"><div class="logo" style="margin-bottom:12px"><img src="/assets/logo.png" alt="" onerror="this.remove()"><i></i><span>Trainer</span></div>
    <h2 class="disp bigtitle">Host PIN</h2><p class="muted">The PIN you set in Vercel (HOST_PIN). Default is 1234.</p>
    <input class="input" id="f-pin" type="password" inputmode="numeric" autocomplete="off" style="margin-top:10px">
    <p class="err" id="pinerr" style="margin-top:10px" ${bad ? "" : "hidden"}>Wrong PIN — try again.</p><button class="btn red cta" style="margin-top:14px" data-act="pin">Enter</button></div></div>`;
  setTimeout(() => $("#f-pin") && $("#f-pin").focus(), 50);
}
function renderHost() {
  if (!pin) return renderPin(false);
  let root = $("#hostStage"), dock = $("#dock");
  if (!root) { $("#app").innerHTML = `<div id="hostStage"></div><div id="dock" class="dock"></div>`; root = $("#hostStage"); dock = $("#dock"); lastSig = ""; lastDockSig = ""; }
  renderScreen(root);
  const dsig = JSON.stringify([V.stage, V.cur, V.players, V.teams, V.host.score, dockMin]);
  if (dsig !== lastDockSig && !(typing() && dock.contains(document.activeElement))) { lastDockSig = dsig; dock.innerHTML = dockHTML(); }
  dock.classList.toggle("min", dockMin);
  document.documentElement.style.setProperty("--dockH", dockMin ? "54px" : dock.offsetHeight + "px");
  document.body.style.paddingBottom = (dockMin ? 54 : dock.offsetHeight) + "px";
}
function seg(field, max, val) { let h = `<span class="seg">`; for (let i = 0; i <= max; i++) h += `<button class="${val === i ? "on" : ""}" data-act="score" data-f="${esc(field)}" data-v="${i}">${i}</button>`; return h + "</span>"; }
function curSection() { const s = V.stage; return s.type === "rg" ? "rg:" + s.round : s.type; }
function dockHTML() {
  const s = V.stage, c = V.cur, H = V.host, sc = H.score;
  const nav = `<div class="dock-top"><span class="lbl">Trainer</span><div class="nav">${SECTIONS.map(([k, l]) => `<button class="${curSection() === k ? "on" : ""}" data-act="go" data-k="${k}">${l}</button>`).join("")}</div><div class="spacer"></div>
    <button class="btn sm" data-act="timerAdd">+30s</button><button class="btn sm" data-act="timerStop">Stop timer</button><button class="btn sm" data-act="scores">🔒 Private scores</button><button class="btn sm" data-act="edOpen">✏️ Questions</button>
    <button class="btn sm ${soundOn ? "amber" : ""}" data-act="sound">${soundOn ? "🔊" : "🔇"}</button><button class="btn sm" data-act="min" title="P">${dockMin ? "▲ Show" : "▼ Hide"} <span class="kbd">P</span></button></div>`;
  let b = "";
  if (s.type === "lobby") {
    b = `<div class="ctx"><span class="info">Players join at <b>${esc(location.origin)}</b> · ${V.players.length} joined</span></div>
      <div class="ctx"><b>Number of teams</b>${[4,5,6,7,8,9,10].map(n => `<button class="btn sm ${V.teams.length === n ? "amber" : ""}" data-act="teamCount" data-n="${n}">${n}</button>`).join("")}<span class="info">${V.players.length} players → about ${Math.ceil(V.players.length / V.teams.length) || 0} per team</span></div>
      <div class="ctx">${V.teams.map((t, i) => `<input class="hinput" id="tn-${t.id}" value="${esc(t.name)}" aria-label="Team ${i + 1} name" style="width:130px">`).join("")}<button class="btn sm" data-act="saveTeams">Save team names</button>
      <div class="spacer"></div><button class="btn sm ghost" data-act="resetScores">Reset scores</button><button class="btn sm ghost" data-act="resetAll">Reset everything</button></div>
      <div style="overflow-x:auto"><table class="htable"><tbody>${V.players.map(p => `<tr><td>${esc(p.emoji)} ${esc(p.name)}</td><td>${V.teams.map(t => `<button class="btn sm ${p.team === t.id ? "amber" : "ghost"}" data-act="move" data-p="${p.id}" data-t="${t.id}">${esc(t.name)}</button>`).join(" ")}</td><td><button class="btn sm ghost" data-act="kick" data-p="${p.id}">Remove</button></td></tr>`).join("")}</tbody></table></div>
      <div class="ctx"><button class="btn red" data-act="go" data-k="rg:1">Start Red/Green Round 1 ▶</button></div>`;
  } else if (s.type === "rg") {
    const n = H.roundLens[s.round]; const idx = s.idx || 0;
    if (s.phase === "summary") b = `<div class="ctx"><span class="info">Round summary on screen.</span><button class="btn sm" data-act="rgGo" data-i="${n - 1}">← Back to last statement</button><div class="spacer"></div><button class="btn primary" data-act="nextSection">Next section ▶</button></div>`;
    else {
      const nv = (c.notVoted || []).map(id => V.players.find(p => p.id === id)).filter(Boolean);
      b = `<div class="ctx"><b>${esc(c.roundName)} · ${idx + 1}/${n}</b><span class="info">Answer: <span class="spoiler">${ansLabel(c)}</span> · votes ${c.voted}/${c.of} (${Object.entries(c.c).map(([k, v]) => (c.type === "mcq" ? k : k === "R" ? "🚩" : "✅") + v).join(" ")})</span><div class="spacer"></div>
        <button class="btn sm" data-act="rgGo" data-i="${idx - 1}" ${idx === 0 ? "disabled" : ""}>← Prev</button>
        ${s.phase === "vote" ? `<button class="btn sm" data-act="rgRestart">Restart timer</button><button class="btn red" data-act="rgReveal">Reveal <span class="kbd">R</span></button>`
          : `${idx < n - 1 ? `<button class="btn primary" data-act="rgGo" data-i="${idx + 1}">Next statement ▶ <span class="kbd">→</span></button>` : `<button class="btn primary" data-act="rgSummary">Round summary ▶</button>`}`}</div>
        ${s.phase === "vote" && nv.length ? `<div class="ctx info">Not voted yet: ${nv.map(p => esc(p.name)).join(", ")}</div>` : ""}
        ${s.phase === "reveal" ? `<div class="ctx"><button class="btn sm amber" data-act="mic">🎤 Pick someone to explain</button>${s.mic ? `<span class="info">${esc((V.players.find(p => p.id === s.mic) || {}).name)}</span><button class="btn sm" data-act="reason" data-p="${s.mic}">+1 Reasoning</button><button class="btn sm" data-act="part" data-p="${s.mic}">+1 Participation</button><button class="btn sm ghost" data-act="micClear">Clear</button>` : ""}${c.d ? `<span class="info">Discuss: ${esc(c.d)}</span>` : ""}</div>` : ""}`;
    }
  } else if (s.type === "say") {
    const R = H.rubric.say;
    b = `<div class="ctx"><b>Case</b>${H.says.map(id => `<button class="btn sm ${c.id === id ? "amber" : ""}" data-act="sayCase" data-c="${id}">${id}</button>`).join("")}<div class="spacer"></div>
      ${s.phase === "answer" ? `<button class="btn sm" data-act="timer" data-d="120">2:00</button><button class="btn sm" data-act="timer" data-d="180">3:00</button><span class="info">${c.submitted.length}/${V.teams.length} teams in</span><button class="btn red" data-act="sayReveal">Reveal answers</button>`
        : `<button class="btn sm" data-act="sayCase" data-c="${c.id}">Back to writing</button>${c.id !== "C" ? `<button class="btn primary" data-act="sayCase" data-c="${String.fromCharCode(c.id.charCodeAt(0) + 1)}">Next case ▶</button>` : `<button class="btn primary" data-act="nextSection">Next section ▶</button>`}`}</div>
      <div style="overflow-x:auto"><table class="htable"><thead><tr><th>Team · case ${c.id}</th><th>Their sentence</th>${R.map(r => `<th>${esc(r[1])} /${r[2]}</th>`).join("")}<th>Say total /15</th></tr></thead><tbody>
      ${V.teams.map(t => { const a = (c.answers || []).find(x => x.tid === t.id); return `<tr><td><b>${esc(t.name)}</b></td><td dir="auto" style="max-width:280px">${a ? esc(a.text) : "—"}</td>${R.map(([k, , mx]) => `<td>${seg(`say:${c.id}:${t.id}:${k}`, mx, sc[`say:${c.id}:${t.id}:${k}`])}</td>`).join("")}<td class="mono">${H.teamTotals[t.id].say}</td></tr>`; }).join("")}</tbody></table></div>
      ${s.phase !== "reveal" ? `<div class="ctx info">Model: <span dir="rtl" class="spoiler">${esc(c.model.human)}</span></div>` : ""}`;
  } else if (s.type === "box") {
    const drawn = Object.keys(c.assign || {}).length > 0; const R = H.rubric.box;
    b = `<div class="ctx">${!drawn || s.phase === "draw" ? `<button class="btn ${drawn ? "" : "red"}" data-act="boxDraw">${drawn ? "Redraw" : "🎁 Draw boxes"}</button>` : ""}
      ${drawn ? `<button class="btn ${s.phase === "answer" ? "" : "primary"}" data-act="boxStart">${s.phase === "answer" ? "Restart" : "Start answering"} 7:00</button>` : ""}
      ${s.phase === "answer" ? `<span class="info">${c.submitted.length}/${V.teams.length} teams in</span><button class="btn red" data-act="boxReveal">Reveal answers</button>` : ""}
      ${s.phase === "reveal" ? `<button class="btn sm" data-act="boxSuggest">Fill suggested scores</button><div class="spacer"></div><button class="btn primary" data-act="nextSection">Next section ▶</button>` : ""}</div>
      ${drawn ? `<div style="overflow-x:auto"><table class="htable"><thead><tr><th>Team</th><th>Their picks</th>${R.map(r => `<th>${esc(r[1])} /${r[2]}</th>`).join("")}<th>/10</th></tr></thead><tbody>
      ${V.teams.map(t => { const bid = c.assign[t.id]; const pk = c.picks && c.picks[t.id]; const ex = c.expected[bid]; const box = c.boxes.find(x => x.id === bid) || {};
        const mk = (v, l) => v ? `${esc(v)}${l.length ? (l.includes(v) ? " ✓" : " ✗") : ""}` : "—";
        return `<tr><td><b>${esc(t.name)}</b> · Box ${bid}</td><td class="hint">${pk ? `P: ${mk(pk.primary, ex.ex.p)}${pk.primary === box.trap ? " (TRAP)" : ""}<br>S: ${mk(pk.secondary, ex.ex.s)}<br>D: ${pk.diag.map(esc).join(", ") || "—"}<br>Why: ${esc(pk.why) || "—"}` : "—"}<br><span class="muted spoiler">Key: ${esc(ex.primary)} / ${esc(ex.secondary)}</span></td>
        ${R.map(([k, , mx]) => `<td>${seg(`box:${t.id}:${k}`, mx, sc[`box:${t.id}:${k}`])}</td>`).join("")}<td class="mono">${H.teamTotals[t.id].box}</td></tr>`; }).join("")}</tbody></table></div>` : ""}`;
  } else if (s.type === "boss") {
    const qi = s.q ?? 0; const pts = H.rubric.boss;
    b = `<div class="ctx"><button class="btn sm ${!s.phase || s.phase === "intro" ? "amber" : ""}" data-act="boss" data-p="intro">Case</button><button class="btn sm ${s.phase === "note" ? "amber" : ""}" data-act="boss" data-p="note" data-d="120">① Individual note 2:00 (optional)</button>
      <button class="btn sm ${s.phase === "team" ? "amber" : ""}" data-act="boss" data-p="team" data-d="300">② Team 5:00</button><button class="btn sm" data-act="boss" data-p="team" data-d="0">Team — no timer</button><span class="info">notes ${c.notes}/${V.players.length} · sheets ${c.submitted.length}/${V.teams.length}</span><div class="spacer"></div>
      ${s.phase === "reveal" ? `<button class="btn sm" data-act="bossQ" data-q="${qi - 1}" ${qi === 0 ? "disabled" : ""}>← Q${qi}</button><b>Q${qi + 1}</b>${qi < 6 ? `<button class="btn primary" data-act="bossQ" data-q="${qi + 1}">Q${qi + 2} ▶</button>` : `<button class="btn primary" data-act="nextSection">Next section ▶</button>`}`
        : `<button class="btn red" data-act="bossQ" data-q="0">Reveal answers ▶</button>`}</div>
      ${s.phase === "reveal" ? `<div class="ctx info">Key Q${qi + 1}: ${esc(c.keys[qi])}</div>` : ""}
      <div style="overflow-x:auto"><table class="htable"><thead><tr><th>Team</th>${pts.map((p, i) => `<th>Q${i + 1} /${p}</th>`).join("")}<th>/30</th></tr></thead><tbody>
      ${V.teams.map(t => `<tr><td><b>${esc(t.name)}</b></td>${pts.map((p, i) => `<td>${seg(`boss:${t.id}:q${i}`, p, sc[`boss:${t.id}:q${i}`])}</td>`).join("")}<td class="mono">${H.teamTotals[t.id].boss}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (s.type === "board") {
    b = `<div class="ctx"><button class="btn ${s.winner ? "" : "red"}" data-act="winner">${s.winner ? "Hide winner" : "🏆 Reveal winner"}</button><span class="info">Individual scores stay in 🔒 Private scores.</span></div>`;
  }
  return nav + `<div class="dock-body">${b}</div>`;
}
function scoresModal() {
  const H = V.host; const rows = H.individuals.slice().sort((a, b) => b.total - a.total);
  const m = document.createElement("div"); m.className = "modal"; m.id = "scoresModal";
  m.innerHTML = `<div class="in"><div class="row"><h2 class="disp sh2" style="margin:0">Private scores</h2><div class="spacer"></div><button class="btn sm" data-act="csv">Download CSV</button><button class="btn sm primary" data-act="closeModal">Close</button></div>
   <p class="muted">Total /100 = Red/Green 40% · Boss note 35% · Reasoning 15% · Participation 10%. Don't project this.</p>
   <div style="overflow-x:auto"><table class="htable"><thead><tr><th>Intern</th><th>Team</th><th>Quiz pts /${H.rgTotal}</th><th>Boss note /10</th><th>Reasoning /5</th><th>Participation /5</th><th>Total</th><th>Their note</th></tr></thead><tbody>
   ${rows.map(r => `<tr><td>${esc(r.emoji)} <b>${esc(r.name)}</b></td><td>${tname(r.team)}</td><td class="mono">${r.rg}</td><td>${seg("ind:note:" + r.id, 10, r.note)}</td><td>${seg("ind:reason:" + r.id, 5, r.re)}</td><td>${seg("ind:part:" + r.id, 5, r.pa)}</td><td class="mono"><b>${r.total}</b></td><td dir="auto" class="hint" style="max-width:260px">${esc(H.notes[r.id] || "—")}</td></tr>`).join("")}
   </tbody></table></div></div>`;
  const old = $("#scoresModal"); if (old) old.replaceWith(m); else document.body.appendChild(m);
}
function csv() {
  const H = V.host; const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  let out = "Intern,Team,Quiz points /" + H.rgTotal + ",Boss note /10,Reasoning /5,Participation /5,Total /100,Boss note text\n";
  H.individuals.forEach(r => out += [q(r.name), q(teamOf(r.team).name), r.rg, r.note, r.re, r.pa, r.total, q(H.notes[r.id] || "")].join(",") + "\n");
  out += "\nTeam,Say It /15,Mystery Box /10,Boss Fight /30,Total /55\n";
  V.teams.forEach(t => { const x = H.teamTotals[t.id]; out += [q(t.name), x.say, x.box, x.boss, x.total].join(",") + "\n"; });
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + out], { type: "text/csv" })); a.download = "analytics-arena-scores.csv"; document.body.appendChild(a); a.click(); a.remove();
}
/* ---------------- question editor ---------------- */
let ED = null, edRound = "1", edOrig = "";
function edOpen() { ED = JSON.parse(JSON.stringify(V.host.quiz)); edOrig = JSON.stringify(ED); edRound = V.stage.type === "rg" && V.host.rounds[V.stage.round] ? V.stage.round : "1"; renderEditor(); }
function renderEditor() {
  const R = V.host.rounds;
  const items = ED.map((q, i) => ({ q, i })).filter(x => x.q.r === edRound);
  const card = ({ q, i }, n) => `<div class="qed">
    <div class="row"><b class="mono">#${n + 1}</b>
      <span class="seg"><button class="${q.type !== "mcq" ? "on" : ""}" data-act="edType" data-i="${i}" data-v="rg">🚩✅ Red/Green</button><button class="${q.type === "mcq" ? "on" : ""}" data-act="edType" data-i="${i}" data-v="mcq">ABCD Choices</button></span>
      <span class="muted small">Points</span><span class="seg">${[1, 2, 3, 4, 5].map(p => `<button class="${(q.pts || 1) === p ? "on" : ""}" data-act="edPts" data-i="${i}" data-v="${p}">${p}</button>`).join("")}</span>
      <span class="spacer"></span>
      <button class="btn sm ghost" data-act="edMove" data-i="${i}" data-v="-1" ${n === 0 ? "disabled" : ""} title="Move up">↑</button>
      <button class="btn sm ghost" data-act="edMove" data-i="${i}" data-v="1" ${n === items.length - 1 ? "disabled" : ""} title="Move down">↓</button>
      <button class="btn sm ghost" data-act="edDel" data-i="${i}" title="Delete">🗑</button></div>
    <label class="eyebrow">Statement / question</label>
    <textarea class="hinput" rows="2" data-ef="t" data-i="${i}" dir="auto">${esc(q.t)}</textarea>
    ${q.type === "mcq"
      ? `<label class="eyebrow">Options — tap the circle to mark the correct one</label>${[0, 1, 2, 3].map(k => { const L = "ABCD"[k]; return `<div class="row" style="flex-wrap:nowrap"><button class="radio ${q.a === L ? "on" : ""}" data-act="edAns" data-i="${i}" data-v="${L}" title="Correct answer">${q.a === L ? "✓" : L}</button><input class="hinput" style="flex:1" data-ef="opt" data-o="${k}" data-i="${i}" value="${esc((q.opts || [])[k] || "")}" placeholder="Option ${L}${k > 1 ? " (optional)" : ""}" dir="auto"></div>`; }).join("")}`
      : `<label class="eyebrow">Correct answer</label><div class="row"><button class="btn sm ${q.a === "R" ? "red-on" : "ghost"}" data-act="edAns" data-i="${i}" data-v="R">🚩 Red flag</button><button class="btn sm ${q.a === "G" ? "green-on" : "ghost"}" data-act="edAns" data-i="${i}" data-v="G">✅ Green flag</button></div>`}
    <label class="eyebrow">Why — shown after reveal</label>
    <textarea class="hinput" rows="2" data-ef="e" data-i="${i}" dir="auto">${esc(q.e || "")}</textarea>
    <label class="eyebrow">Discussion prompt (optional)</label>
    <input class="hinput" data-ef="d" data-i="${i}" value="${esc(q.d || "")}" dir="auto">
  </div>`;
  let m = $("#qEditor"); const scroll = m ? m.scrollTop : 0;
  if (!m) { m = document.createElement("div"); m.className = "modal"; m.id = "qEditor"; document.body.appendChild(m); }
  m.innerHTML = `<div class="in"><div class="row"><h2 class="disp sh2" style="margin:0;font-size:32px">✏️ Edit questions</h2>${V.host.customQuiz ? `<span class="chip" style="font-size:12px">edited version live</span>` : `<span class="chip" style="font-size:12px">original questions</span>`}<div class="spacer"></div>
      <button class="btn sm ghost" data-act="edReset">Reset to original</button><button class="btn sm" data-act="edClose">Close</button><button class="btn sm red" data-act="edSave">💾 Save changes</button></div>
    <p class="muted small" style="margin:8px 0 12px">Changes go live for everyone as soon as you save — no GitHub needed. Editing a question that was already answered keeps the votes.</p>
    <div class="nav">${Object.entries(R).map(([k, r]) => `<button class="${edRound === k ? "on" : ""}" data-act="edRound" data-r="${k}">${esc(r.name)} <span class="mono" style="opacity:.6">${ED.filter(q => q.r === k).length}</span></button>`).join("")}</div>
    <div class="muted small" style="margin-top:8px">${esc(R[edRound].rule)} · ${esc(R[edRound].level)}</div>
    ${items.map(card).join("") || `<p class="muted">No questions in this round yet.</p>`}
    <div class="row" style="margin-top:12px"><button class="btn sm" data-act="edAdd" data-v="rg">+ Add Red/Green statement</button><button class="btn sm" data-act="edAdd" data-v="mcq">+ Add multiple choice</button><div class="spacer"></div><button class="btn sm red" data-act="edSave">💾 Save changes</button></div></div>`;
  m.scrollTop = scroll;
}
document.addEventListener("input", e => {
  const el = e.target; if (!ED || !el.dataset.ef) return; const q = ED[+el.dataset.i]; if (!q) return;
  if (el.dataset.ef === "opt") { q.opts = q.opts || ["", "", "", ""]; while (q.opts.length < 4) q.opts.push(""); q.opts[+el.dataset.o] = el.value; }
  else q[el.dataset.ef] = el.value;
});
function edAct(a, d) {
  const i = +d.i, q = ED && ED[i];
  if (a === "edRound") edRound = d.r;
  else if (a === "edType") { q.type = d.v; if (d.v === "mcq") { q.opts = q.opts && q.opts.length ? q.opts : ["", "", "", ""]; if (!"ABCD".includes(q.a)) q.a = "A"; } else { q.a = q.a === "G" ? "G" : "R"; } }
  else if (a === "edPts") q.pts = +d.v;
  else if (a === "edAns") q.a = d.v;
  else if (a === "edDel") { if (!confirm("Delete this question?")) return; ED.splice(i, 1); }
  else if (a === "edMove") { const same = ED.map((x, j) => x.r === edRound ? j : -1).filter(j => j >= 0); const pos = same.indexOf(i), to = same[pos + (+d.v)]; if (to == null) return; [ED[i], ED[to]] = [ED[to], ED[i]]; }
  else if (a === "edAdd") {
    const same = ED.map((x, j) => x.r === edRound ? j : -1).filter(j => j >= 0); const at = same.length ? same[same.length - 1] + 1 : ED.length;
    ED.splice(at, 0, d.v === "mcq" ? { id: "", r: edRound, type: "mcq", a: "A", pts: 2, t: "", opts: ["", "", "", ""], e: "", d: "" } : { id: "", r: edRound, type: "rg", a: "R", pts: 1, t: "", e: "", d: "" });
  }
  renderEditor();
  if (a === "edAdd") { const m = $("#qEditor"); const tas = m.querySelectorAll('textarea[data-ef="t"]'); const last = tas[tas.length - 1]; if (last) { last.scrollIntoView({ block: "center" }); last.focus(); } }
}
function goSection(k) {
  if (k === "lobby") return host("stage", { stage: { type: "lobby" } });
  if (k.startsWith("rg:")) return host("stage", { stage: { type: "rg", round: k.slice(3), idx: 0, phase: "vote" }, dur: "auto" });
  if (k === "say") return host("stage", { stage: { type: "say", c: "A", phase: "answer" } });
  if (k === "box") return host("stage", { stage: { type: "box", phase: "draw" } });
  if (k === "boss") return host("stage", { stage: { type: "boss", phase: "intro" } });
  if (k === "board") return host("stage", { stage: { type: "board", winner: false } });
}
async function hostAct(a, d) {
  const s = V && V.stage;
  switch (a) {
    case "pin": pin = $("#f-pin").value.trim(); ls.set("mc-pin", pin); $("#app").innerHTML = ""; lastSig = ""; lastDockSig = ""; return refresh();
    case "go": return goSection(d.k);
    case "edOpen": return edOpen();
    case "edClose": if (JSON.stringify(ED) !== edOrig && !confirm("Close without saving your changes?")) return; ED = null; { const m = $("#qEditor"); m && m.remove(); } return;
    case "edSave": { const ok = await host("quizSave", { quiz: ED }); if (ok) { toast("Saved ✓ — live for everyone"); ED = JSON.parse(JSON.stringify(V.host.quiz)); edOrig = JSON.stringify(ED); renderEditor(); } return; }
    case "edReset": if (!confirm("Go back to the original questions from the session file? Your edits will be removed.")) return; await host("quizReset"); ED = JSON.parse(JSON.stringify(V.host.quiz)); edOrig = JSON.stringify(ED); renderEditor(); toast("Original questions restored"); return;
    case "edRound": case "edType": case "edPts": case "edAns": case "edDel": case "edMove": case "edAdd": return edAct(a, d);
    case "nextSection": { const i = SECTIONS.findIndex(x => x[0] === curSection()); return goSection(SECTIONS[Math.min(SECTIONS.length - 1, i + 1)][0]); }
    case "min": dockMin = !dockMin; ls.set("mc-dockmin", dockMin); lastDockSig = ""; return render();
    case "sound": soundOn = !soundOn; sfx("join"); lastDockSig = ""; return render();
    case "timer": return host("timer", { dur: +d.d });
    case "timerAdd": return host("timer", { dur: 30, add: true });
    case "timerStop": return host("timer", { dur: 0 });
    case "scores": return scoresModal();
    case "closeModal": { const m = $("#scoresModal"); m && m.remove(); return; }
    case "csv": return csv();
    case "score": { await host("score", { scores: { [d.f]: +d.v } }); if ($("#scoresModal")) scoresModal(); return; }
    case "teamCount": if (+d.n !== V.teams.length && (!V.players.length || confirm("Change to " + d.n + " teams? Players on removed teams get moved to the remaining ones."))) return host("teamCount", { n: +d.n }); return;
    case "saveTeams": return host("teams", { teams: V.teams.map(t => ({ id: t.id, name: ($("#tn-" + t.id) || {}).value })) });
    case "move": return host("move", { pid: d.p, team: d.t });
    case "kick": if (confirm("Remove this player?")) return host("kick", { pid: d.p }); return;
    case "resetScores": if (confirm("Clear every vote, answer and score? Players stay joined.")) return host("reset", { all: false }); return;
    case "resetAll": if (confirm("Delete EVERYTHING including players? Use this before a new session.")) return host("reset", { all: true }); return;
    case "rgGo": return host("stage", { stage: { type: "rg", round: s.round, idx: +d.i, phase: "vote" }, dur: "auto" });
    case "rgRestart": return host("stage", { stage: { ...s, phase: "vote", mic: null }, dur: "auto" });
    case "rgReveal": return host("stage", { stage: { type: "rg", round: s.round, idx: s.idx || 0, phase: "reveal" } });
    case "rgSummary": return host("stage", { stage: { type: "rg", round: s.round, idx: s.idx, phase: "summary" } });
    case "mic": { const pool = V.players.filter(p => p.id !== s.mic); if (!pool.length) return; return host("mic", { pid: pool[Math.floor(Math.random() * pool.length)].id }); }
    case "micClear": return host("mic", { pid: null });
    case "reason": case "part": { const f = (a === "reason" ? "ind:reason:" : "ind:part:") + d.p; const cur = V.host.score[f] || 0; await host("score", { scores: { [f]: Math.min(5, cur + 1) } }); return toast("+1 → " + (V.players.find(p => p.id === d.p) || {}).name); }
    case "sayCase": return host("stage", { stage: { type: "say", c: d.c, phase: "answer" } });
    case "sayReveal": return host("stage", { stage: { type: "say", c: s.c, phase: "reveal" } });
    case "boxDraw": await host("boxDraw"); return host("stage", { stage: { type: "box", phase: "draw" } });
    case "boxStart": return host("stage", { stage: { type: "box", phase: "answer" }, dur: 420 });
    case "boxReveal": return host("stage", { stage: { type: "box", phase: "reveal" } });
    case "boxSuggest": {
      const c = V.cur, out = {};
      V.teams.forEach(t => { const bid = c.assign[t.id], pk = c.picks[t.id], ex = c.expected[bid].ex, box = c.boxes.find(x => x.id === bid); if (!pk) return;
        out[`box:${t.id}:p`] = pk.primary && pk.primary !== box.trap && (ex.p.includes(pk.primary)) ? 4 : 0;
        out[`box:${t.id}:s`] = pk.secondary && ex.s.includes(pk.secondary) ? 2 : pk.secondary ? 1 : 0;
        out[`box:${t.id}:d`] = ex.d.length ? (pk.diag.some(m => ex.d.includes(m)) ? 2 : pk.diag.length ? 1 : 0) : (pk.diag.length ? 1 : 0);
        out[`box:${t.id}:w`] = pk.why && pk.why.length > 15 ? 1 : 0; });
      await host("score", { scores: out }); return toast("Suggested scores filled — adjust Why & Diagnostics by hand");
    }
    case "boss": return host("stage", { stage: { type: "boss", phase: d.p }, dur: d.d ? +d.d : 0 });
    case "bossQ": return host("stage", { stage: { type: "boss", phase: "reveal", q: Math.max(0, Math.min(6, +d.q)) } });
    case "winner": return host("stage", { stage: { type: "board", winner: !s.winner } });
  }
}

/* ---------------- boot ---------------- */
function render() {
  if (!V) { if (ROLE === "player") renderPlayer(); return; }
  if (ROLE === "player") renderPlayer();
  else if (ROLE === "screen") renderScreen($("#app"));
  else renderHost();
}
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  e.preventDefault();
  if (el.dataset.act === "soundScreen") { soundOn = !soundOn; el.textContent = soundOn ? "🔊 Sound on" : "🔇 Sound off"; sfx("join"); return; }
  (ROLE === "host" ? hostAct : playerAct)(el.dataset.act, { ...el.dataset });
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "f-pin") return hostAct("pin", {});
  if (e.key === "Enter" && e.target.id === "f-name") return playerAct("join", {});
  if (ROLE !== "host" || typing() || !V) return;
  if ($("#qEditor") && e.key !== "Escape") return;
  const s = V.stage;
  if (e.key === "p" || e.key === "P") hostAct("min", {});
  if (s.type === "rg" && s.phase !== "summary") {
    if ((e.key === "r" || e.key === "R") && s.phase === "vote") hostAct("rgReveal", {});
    if (e.key === "ArrowRight") { if (s.phase === "vote") hostAct("rgReveal", {}); else if ((s.idx || 0) < V.host.roundLens[s.round] - 1) hostAct("rgGo", { i: (s.idx || 0) + 1 }); else hostAct("rgSummary", {}); }
  }
  if (e.key === "Escape") { if ($("#qEditor")) hostAct("edClose", {}); else hostAct("closeModal", {}); }
});
if (ROLE === "host" && !pin) renderPin(false);
loop();
})();
