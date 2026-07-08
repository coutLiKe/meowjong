"use strict";
/* ============================================================
   Meowjong — DOM rendering & interaction helpers
   ============================================================ */

function $(sel) { return document.querySelector(sel); }

/* Small corner index for learners (toggleable): number for suits,
   E/S/W/N for winds, R/G/W for dragons. */
function cornerText(kind) {
  if (kind < 27) return String(rankOf(kind));
  if (isWind(kind)) return WINDS[kind - 27].key;
  return DRAGONS[kind - 31].key;
}

/* SVG faces are pure functions of kind — parse once, reuse forever (revamp M1). */
const FACE_CACHE = Object.create(null);
function tileFace(kind) {
  return FACE_CACHE[kind] || (FACE_CACHE[kind] = tileFaceSVG(kind));
}

/* Create a tile element. kind === null → face-down back.
   Uses <span> so tiles can live inside <p> text (a <div> would close the paragraph). */
function tileEl(kind, opts = {}) {
  const d = document.createElement("span");
  if (kind === null || kind === undefined) {
    d.className = "tile back" + (opts.small ? " small" : "") + (opts.mini ? " mini" : "");
    d.textContent = "🀄";
    d.title = "A face-down tile — hidden from you";
    d.setAttribute("aria-label", "face-down tile");
    return d;
  }
  let cls = "tile";
  const isGold = typeof G !== "undefined" && G.wildKind !== null && G.wildKind !== undefined && kind === G.wildKind;
  if (isGold) cls += " gold";
  if (opts.small) cls += " small";
  if (opts.mini) cls += " mini";
  if (opts.selected) cls += " selected";
  if (opts.suggest) cls += " suggest";
  if (opts.last) cls += " last-discard";
  d.className = cls;
  d.innerHTML = `<span class="corner">${cornerText(kind)}</span>` + tileFace(kind);
  d.title = tileName(kind);
  // a11y: every tile carries a spoken label (screen readers read this, not the SVG)
  d.setAttribute("aria-label", tileName(kind) + (isGold ? " (gold / wild)" : ""));
  d.dataset.kind = kind;
  return d;
}

function meldEl(meld) {
  const wrap = document.createElement("div");
  wrap.className = "meld";
  let kinds;
  if (meld.type === "chow") kinds = [meld.kind, meld.kind + 1, meld.kind + 2];
  else kinds = new Array(meld.type === "kong" ? 4 : 3).fill(meld.kind);
  for (const k of kinds) wrap.appendChild(tileEl(meld.concealed && meld.type === "kong" ? null : k, { small: true }));
  wrap.title = (MELD_LABEL[meld.type] || meld.type).toUpperCase() + (meld.concealed ? " (concealed)" : "");
  return wrap;
}

/* ---------- Panels ---------- */

function renderOpponents() {
  for (let i = 1; i <= 3; i++) {
    const s = G.seats[i];
    const panel = $("#opp-" + i);
    panel.querySelector(".opp-name").textContent = s.emoji + " " + s.name;
    panel.querySelector(".opp-score").textContent = s.score + " pts";
    panel.querySelector(".opp-wind").textContent = "Wind: " + WINDS[s.wind].key;
    panel.classList.toggle("active-turn", G.activeSeat === i);
    const handRow = panel.querySelector(".opp-hand");
    handRow.innerHTML = "";
    if (G.peek && !isPartyMode()) {
      for (const t of sortHand(s.hand.slice())) handRow.appendChild(tileEl(t, { small: true }));
    } else {
      for (const t of s.hand) handRow.appendChild(tileEl(null, { mini: true }));
      const n = document.createElement("span");
      n.className = "hand-count";
      n.textContent = s.hand.length + " tiles";
      handRow.appendChild(n);
    }
    const meldRow = panel.querySelector(".opp-melds");
    meldRow.innerHTML = "";
    for (const m of s.melds) meldRow.appendChild(meldEl(m));
    if (s.melds.length) {
      const lbl = document.createElement("span");
      lbl.className = "meld-label";
      lbl.textContent = "claimed sets (locked in, face-up):";
      meldRow.prepend(lbl);
    }
    renderFlowerRow(panel.querySelector(".opp-flowers"), s.flowers || []);
  }
}

/* flowers (winds) exposed beside a hand — public, they multiply the score */
function renderFlowerRow(el, flowers) {
  if (!el) return;
  el.innerHTML = "";
  if (!flowers.length) return;
  const lbl = document.createElement("span");
  lbl.className = "flower-label";
  lbl.textContent = `🌸 ×${flowers.length}`;
  lbl.title = flowers.length + " flowers — their win pays " + flowers.length + "× the base";
  el.appendChild(lbl);
  for (const f of flowers) el.appendChild(tileEl(f, { mini: true, small: false }));
}

/* The discard river — INCREMENTAL renderer (revamp M1).
   Within a hand the river only ever appends (a discard) or pops from the end
   (a claim / ron), so existing cells keep their DOM identity: new tiles can
   animate in and a claimed tile records its exit position for the gather
   flight. Any deeper mismatch (re-deal, guest snapshot divergence) falls back
   to a full rebuild — correctness always wins over motion. */
function renderRiver() {
  const river = $("#river");
  if (!G.river.length) {
    river.innerHTML = `<span class="river-empty">Discarded tiles pile up here. The newest one glows — that's the one you can claim.</span>`;
    return;
  }
  const emptyNote = river.querySelector(".river-empty");
  if (emptyNote) river.innerHTML = "";

  let cells = river.querySelectorAll(".river-cell");
  // a claim/ron took the newest tile back off the pile
  while (cells.length > G.river.length) {
    const last = cells[cells.length - 1];
    const t = last.querySelector(".tile");
    if (t && typeof fxRecordExit === "function") fxRecordExit(Number(t.dataset.kind), t, "river");
    last.remove();
    cells = river.querySelectorAll(".river-cell");
  }
  // paranoia: if the retained prefix doesn't match state, rebuild from scratch
  for (let i = 0; i < cells.length; i++) {
    const t = cells[i].querySelector(".tile");
    if (!t || Number(t.dataset.kind) !== G.river[i].kind) { river.innerHTML = ""; cells = river.querySelectorAll(".river-cell"); break; }
  }
  // append the new discards
  for (let i = cells.length; i < G.river.length; i++) {
    const { kind, seat } = G.river[i];
    const cell = document.createElement("div");
    cell.className = "river-cell";
    cell.appendChild(tileEl(kind, { small: true }));
    const badge = document.createElement("span");
    badge.className = "river-badge";
    badge.textContent = G.seats[seat].emoji;
    badge.title = "discarded by " + G.seats[seat].name;
    cell.appendChild(badge);
    river.appendChild(cell);
  }
  // the newest tile carries the claimable highlight
  river.querySelectorAll(".tile.last-discard").forEach(t => t.classList.remove("last-discard"));
  if (G.lastDiscard !== null) {
    const lastT = river.querySelector(".river-cell:last-child .tile");
    if (lastT) lastT.classList.add("last-discard");
  }
  river.scrollTop = river.scrollHeight;
}

/* M7 · the wall laid out on the felt (visible in Full 3D only — CSS-gated).
   ~22 face-down minis stand in for the whole wall and deplete with it, so the
   end-of-hand tension is visible on the table, not just in the HUD number.
   Reconciles by count, so mid-hand updates remove at most one tile. */
function renderWallRow() {
  const row = $("#wall-row");
  if (!row) return;
  const left = G.wall.length;
  const max = Math.max(left, Number(row.dataset.max) || 0);
  row.dataset.max = max;
  const SEGMENTS = 22;
  const want = max ? Math.ceil((SEGMENTS * left) / max) : 0;
  while (row.children.length > want) row.lastChild.remove();
  while (row.children.length < want) row.appendChild(tileEl(null, { mini: true }));
  row.title = "The wall — " + left + " tiles left to draw";
}

function renderStatus() {
  $("#wall-count").textContent = G.wall.length;
  $("#round-label").textContent = "Hand " + G.handNumber;
  // M6 HUD: depleting wall bar. Track the hand's full wall size as a
  // high-water mark — a fresh deal always exceeds any mid-hand value.
  const fill = $("#wall-fill");
  if (fill) {
    const max = Math.max(G.wall.length, Number(fill.dataset.max) || 0);
    fill.dataset.max = max;
    fill.style.width = (max ? Math.round((100 * G.wall.length) / max) : 0) + "%";
  }
  renderWallRow();
  const you = G.seats[0];
  $("#your-score").textContent = you.score + " pts";
  const yw = $("#your-wind");
  if (yw) yw.textContent = you.wind !== null && you.wind !== undefined ? "Wind: " + WINDS[you.wind].key : "";
  // the flipped gold (wild) tile
  const slot = $("#gold-slot");
  slot.innerHTML = "";
  if (G.wildKind !== null && G.wildKind !== undefined) {
    slot.appendChild(tileEl(G.wildKind, { small: true }));
    const note = document.createElement("span");
    note.className = "gold-note";
    note.innerHTML = ` = <b>${tileName(G.wildKind)}</b> — its 3 other copies are wild`;
    slot.appendChild(note);
  }
  renderFlowerRow($("#your-flowers"), you.flowers || []);
  // turn-order reflects actual seat names (party mode changes them).
  // M7.2: shown as a tooltip on the "You" pill — the inline line was clutter.
  const order = $("#turn-order");
  if (order) {
    const txt = "turn order: You → " +
      [1, 2, 3].map(i => G.seats[i].emoji + " " + G.seats[i].name).join(" → ") + " → back to you…";
    order.textContent = txt;
    const pill = $("#player-top");
    if (pill) pill.title = txt;
  }
}

/* Your hand — PERSISTENT, KEYED renderer (revamp M1, the keystone).
   Instead of clearing and rebuilding, existing tile nodes are matched to the
   new state by kind and moved/updated in place. That gives every tile a stable
   DOM identity across renders, which is what makes motion possible:
   - retained tiles FLIP-animate to their new slots (hand closes gaps smoothly)
   - removed tiles register their last screen position (fxRecordExit) so the
     discard/claim choreography can fly a ghost from where the tile really was
   - entering tiles get a draw-in entrance.
   Game logic is untouched: this renders the same state, just without amnesia. */
function renderHand() {
  const you = G.seats[0];
  const handRow = $("#hand");
  const canClick = G.awaitingDiscard;
  const suggestKind = G.suggestKind;

  // one-time click + keyboard delegation (survives reconciliation).
  // a11y: Enter/Space on a focused clickable tile acts like a click, so the
  // hand is fully playable from the keyboard.
  if (!handRow._delegated) {
    handRow._delegated = true;
    const activate = t => {
      if (!t || !handRow.contains(t) || !t.classList.contains("clickable")) return;
      const idx = Array.prototype.indexOf.call(handRow.children, t);
      onHandTileClick(idx, Number(t.dataset.kind));
    };
    handRow.addEventListener("click", e => activate(e.target.closest ? e.target.closest(".tile") : null));
    handRow.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      const t = e.target.closest ? e.target.closest(".tile") : null;
      if (t && t.classList.contains("clickable")) { e.preventDefault(); activate(t); }
    });
  }

  // the tiles the state says we should show, in order
  const desired = you.hand.map(k => ({ kind: k, drawn: false }));
  if (you.drawn !== null && you.drawn !== undefined) desired.push({ kind: you.drawn, drawn: true });

  const existing = Array.prototype.filter.call(handRow.children,
    el => el.classList && el.classList.contains("tile"));

  // FLIP step 1: remember where every current tile is on screen
  const flip = typeof fxFlipEnabled === "function" && fxFlipEnabled() && existing.length > 0;
  const firstRects = flip ? new Map(existing.map(el => [el, el.getBoundingClientRect()])) : null;

  // match state→nodes by kind (prefer an exact drawn-flag match so the fresh
  // draw keeps its identity when it later merges into the sorted hand)
  const pool = existing.slice();
  const nodes = desired.map(d => {
    let i = pool.findIndex(el => Number(el.dataset.kind) === d.kind && el.classList.contains("drawn") === d.drawn);
    if (i < 0) i = pool.findIndex(el => Number(el.dataset.kind) === d.kind);
    if (i >= 0) return pool.splice(i, 1)[0];
    const el = tileEl(d.kind, {});
    el.dataset.enter = "1";
    return el;
  });

  // leftovers left the hand (discard/kong/claim material): record their last
  // position for flight animations, then drop the nodes
  for (const el of pool) {
    if (typeof fxRecordExit === "function") fxRecordExit(Number(el.dataset.kind), el, "hand");
    el.remove();
  }

  // reorder / insert, and refresh state classes in place
  nodes.forEach((el, idx) => {
    if (handRow.children[idx] !== el) handRow.insertBefore(el, handRow.children[idx] || null);
    const d = desired[idx];
    el.classList.toggle("drawn", d.drawn);
    el.classList.toggle("clickable", canClick);
    el.classList.toggle("selected", G.selectedIdx === idx);
    el.classList.toggle("suggest", suggestKind !== null && d.kind === suggestKind);
    el.classList.toggle("gold", G.wildKind !== null && G.wildKind !== undefined && d.kind === G.wildKind);
    // a11y: only discardable tiles are focusable buttons; others are inert
    if (canClick) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-pressed", G.selectedIdx === idx ? "true" : "false");
    } else {
      el.removeAttribute("role");
      el.removeAttribute("tabindex");
      el.removeAttribute("aria-pressed");
    }
  });
  // anything after the tiles that isn't ours (defensive)
  while (handRow.children.length > nodes.length) handRow.lastChild.remove();

  // FLIP steps 2–4: measure new positions, invert, play
  if (flip && typeof fxFlipPlay === "function") fxFlipPlay(nodes, firstRects);

  const meldRow = $("#your-melds");
  meldRow.innerHTML = "";
  for (const m of you.melds) meldRow.appendChild(meldEl(m));
  $("#player-panel").classList.toggle("active-turn", G.activeSeat === 0);
}

function renderAll() {
  renderOpponents();
  renderRiver();
  renderStatus();
  renderHand();
  if (typeof netAfterRender === "function") netAfterRender();
}

/* ---------- Actions bar ---------- */

function showActions(buttons) {
  const bar = $("#actions");
  bar.innerHTML = "";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = "action-btn " + (b.cls || "");
    btn.innerHTML = b.label;
    btn.addEventListener("click", b.cb);
    bar.appendChild(btn);
  }
}
function clearActions() { $("#actions").innerHTML = ""; }

function setPrompt(text) { $("#prompt").innerHTML = text || ""; }

/* ---------- Coach panel ---------- */

function coachSay(html, mood = "🐱") {
  $("#coach-face").textContent = mood;
  $("#coach-msg").innerHTML = html;
}

/* Collapse/expand Professor Paws' card. `persist` records the choice so it
   survives reloads; the auto-collapse-on-mobile path calls it without. */
function setCoachCollapsed(collapsed, persist) {
  const coach = $("#coach");
  if (!coach) return;
  coach.classList.toggle("collapsed", collapsed);
  document.body.classList.toggle("paws-collapsed", collapsed);
  const btn = $("#coach-collapse");
  if (btn) {
    btn.textContent = collapsed ? "🐱" : "—";
    const label = collapsed ? "Open Professor Paws" : "Collapse Professor Paws";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
  if (persist && typeof storeSet === "function") storeSet("meowjong-paws-collapsed", collapsed ? "1" : "0");
}

/* ---------- Log ---------- */

function log(msg, cls = "", localOnly = false) {
  const el = document.createElement("div");
  el.className = "log-line " + cls;
  el.innerHTML = msg;
  const box = $("#log");
  box.appendChild(el);
  while (box.children.length > 80) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  if (!localOnly && typeof netBroadcastLog === "function") netBroadcastLog(msg, cls);
}

/* ---------- Modal ---------- */

function showModal(html, buttons = []) {
  $("#modal-content").innerHTML = html;
  const bar = $("#modal-buttons");
  bar.innerHTML = "";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = "action-btn " + (b.cls || "");
    btn.innerHTML = b.label;
    btn.addEventListener("click", b.cb);
    bar.appendChild(btn);
  }
  $("#modal-overlay").classList.remove("hidden");
}
function hideModal() { $("#modal-overlay").classList.add("hidden"); }

/* ---------- End-of-hand modal (shared safe renderer: host & guest) ----------
   Built from STRUCTURED DATA only — no raw HTML passthrough — so a party guest
   can never be fed script by the host. Names are HTML-escaped; tile kinds are
   coerced to a valid integer range before they touch any renderer. */
function _kindClamp(k) { const n = k | 0; return n < 0 ? 0 : n > 33 ? 33 : n; }

function endHowText(d) {
  if (d.howType === "qiangjin") return "by <b>ROBBING THE GOLD 抢金</b> — the flipped gold completed a ready dealt hand!";
  if (d.howType === "threegold") return "with <b>THREE GOLDS 三金倒</b> — an instant win!";
  if (d.howType === "selfdraw") return "by self-draw 自摸 🀄";
  return `on ${escapeHtml(d.discarderName || "")}'s discard of ${tileShort(_kindClamp(d.winTile))}`;
}

function endModalHtml(d) {
  if (!d || d.kind === "draw") {
    return "<h2>🤝 The wall ran out!</h2><p>Nobody completed a hand — it's a draw. No points change hands. On to the next one!</p>";
  }
  const esc = escapeHtml;
  const handKinds = (d.handKinds || []).map(_kindClamp);
  const flowers = (d.flowers || []).map(_kindClamp);
  const melds = (d.melds || [])
    .filter(m => m && (m.type === "pung" || m.type === "kong" || m.type === "chow"))
    .map(m => ({ type: m.type, kind: _kindClamp(m.kind), concealed: !!m.concealed }));
  const h2 = d.youWin
    ? "<h2>🎉 Hú! 胡 — You win!</h2>"
    : `<h2>${esc(d.winnerEmoji || "")} ${esc(d.winnerName || "")} wins this hand</h2>`;
  let body = `<p>${esc(d.winnerName || "")} won ${endHowText(d)}</p>`;
  body += `<p><b>The winning hand</b> — grouped into its sets + pair (gold = ${tileShort(_kindClamp(d.wild))} 🥇):</p>` +
    winGroupsHTML(handKinds, _kindClamp(d.wild), melds.length);
  if (melds.length) {
    body += `<p><b>Claimed sets:</b></p><div class="tile-row">`;
    for (const m of melds) body += meldEl(m).outerHTML;
    body += `</div>`;
  }
  if (flowers.length) body += `<p><b>Flowers (${flowers.length}):</b></p>` + tilesHTML(flowers);
  body += `<p><b>Scoring:</b></p><ul class="fan-list">`;
  for (const l of (d.scoreLines || [])) body += `<li>${esc(l.name)} — ${esc(l.desc)} <b>(+${l.pts | 0})</b></li>`;
  const from = d.everyonePays ? "(everyone pays)" : `— mostly from ${esc(d.discarderName || "")}, who discarded the winning tile`;
  body += `</ul><p><b>Total: ${d.total | 0} points</b> → ${esc(d.winnerName || "")} collects <b>${d.winnerPayout | 0}</b> ${from}.</p>`;
  return h2 + body;
}

/* ---------- Winning-path visualization (presentation only) ----------
   Reconstructs which tiles form each set + the pair, mirroring the engine's
   proven recursion (canFormSetsW / runRec), so a winner can SEE *why* the hand
   wins. Returns { pair:[k,k], sets:[[k,k,k],...] } or null when the shape can't
   be partitioned (e.g. an instant three-gold win) — the caller then falls back
   to a flat row. Never touches game state; used only for the win modal. */
function decomposeWin(handKinds, wildKind, setsNeeded) {
  const counts = countsOf(handKinds);
  const wpool = (wildKind >= 0 && wildKind < 34) ? counts[wildKind] : 0;
  if (wildKind >= 0 && wildKind < 34) counts[wildKind] = 0;
  for (let p = 0; p < 34; p++) {            // the pair must be natural tiles
    if (counts[p] >= 2) {
      counts[p] -= 2;
      const sets = _buildSets(counts, setsNeeded, wpool, wildKind);
      counts[p] += 2;
      if (sets) return { pair: [p, p], sets };
    }
  }
  return null;
}

function _buildSets(c, n, w, wild) {
  let k = 0; while (k < 34 && c[k] === 0) k++;
  if (k === 34) {                            // only wilds left → pure-wild triplets
    if (w !== 3 * n) return null;
    const out = []; for (let i = 0; i < n; i++) out.push([wild, wild, wild]); return out;
  }
  if (n === 0) return null;
  for (let a = Math.min(3, c[k]); a >= 1; a--) {   // triplet: a naturals + (3-a) wilds
    if (w < 3 - a) continue;
    c[k] -= a;
    const rest = _buildSets(c, n - 1, w - (3 - a), wild);
    c[k] += a;
    if (rest) {
      const set = [];
      for (let i = 0; i < a; i++) set.push(k);
      for (let i = 0; i < 3 - a; i++) set.push(wild);
      return [set, ...rest];
    }
  }
  if (k < 27) {                               // run containing k (smallest natural)
    const base = Math.floor(k / 9) * 9, r = k - base;
    for (let s = Math.max(0, r - 2); s <= Math.min(6, r); s++) {
      const res = _buildRun(c, base + s, k, n, w, wild);
      if (res) return res;
    }
  }
  return null;
}

function _buildRun(c, start, k, n, w, wild) {
  const runKinds = [];
  function rec(d, wLeft) {
    if (d === 3) return _buildSets(c, n - 1, wLeft, wild);
    const t = start + d;
    if (t === k) {                            // k must use its own natural copy
      c[t]--; runKinds.push(t);
      const r = rec(d + 1, wLeft);
      if (r) return r;
      c[t]++; runKinds.pop(); return null;
    }
    if (c[t] > 0) {
      c[t]--; runKinds.push(t);
      const r = rec(d + 1, wLeft);
      if (r) return r;
      c[t]++; runKinds.pop();
    }
    if (wLeft > 0) {                          // fill the gap with a wild
      runKinds.push(wild);
      const r = rec(d + 1, wLeft - 1);
      if (r) return r;
      runKinds.pop();
    }
    return null;
  }
  const rest = rec(0, w);
  return rest ? [runKinds.slice(), ...rest] : null;
}

/* The winning hand shown as its sets + pair, so players see the structure. */
function winGroupsHTML(handKinds, wildKind, meldCount) {
  const setsNeeded = 4 - (meldCount || 0);
  const groups = decomposeWin(handKinds, wildKind, setsNeeded);
  if (!groups) return tilesHTML(handKinds);   // instant win / unusual shape
  const cluster = (kinds, label) => {
    const wrap = document.createElement("div");
    for (const k of kinds) wrap.appendChild(tileEl(k, { small: true }));
    return `<div class="win-group"><div class="win-group-tiles">${wrap.innerHTML}</div>` +
           `<span class="win-group-label">${label}</span></div>`;
  };
  let html = `<div class="win-groups">`;
  groups.sets.forEach((set, i) => { html += cluster(set, "Set " + (i + 1)); });
  html += cluster(groups.pair, "Pair");
  return html + `</div>`;
}

/* Render a row of tiles as inline HTML (for tutorial / win screens) */
function tilesHTML(kinds, small = true) {
  const wrap = document.createElement("div");
  for (const k of kinds) wrap.appendChild(tileEl(k, { small }));
  return `<div class="tile-row">${wrap.innerHTML}</div>`;
}
function T(kind) {
  const el = tileEl(kind, { small: true });
  return `<span class="inline-tile">${el.outerHTML}</span>`;
}

/* ---------- Tile guide (legend) ---------- */

function buildLegend() {
  const groups = [
    { kinds: [0, 4, 8],        caption: "<b>Dots</b> (circles), 1–9 — count the circles" },
    { kinds: [9, 13, 17],      caption: "<b>Bamboo</b> (sticks), 1–9 — count the sticks" },
    { kinds: [18, 22, 26],     caption: "<b>Characters</b> — Chinese numeral over 萬 (\"10,000\")" },
    { kinds: [27, 28, 29, 30], caption: "<b>Winds = FLOWERS 🌸</b> — never kept in hand: expose & redraw. Each one multiplies your winning score!" },
    { kinds: [null],           caption: "Face-down tile (hidden). <b>No dragons in FJ style.</b> The glowing 🥇 tile shown at the table is the GOLD — wild!" },
  ];
  const body = $("#legend-body");
  body.innerHTML = "";
  for (const g of groups) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const row = document.createElement("div");
    row.className = "legend-tiles";
    for (const k of g.kinds) row.appendChild(tileEl(k, { small: true }));
    const cap = document.createElement("div");
    cap.className = "legend-caption";
    cap.innerHTML = g.caption;
    item.appendChild(row);
    item.appendChild(cap);
    body.appendChild(item);
  }
}
