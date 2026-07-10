"use strict";
/* ============================================================
   Meowjong — motion & presentation layer (revamp M0–M4)

   PURE PRESENTATION. This module never touches game rules, state,
   scoring, or the party protocol. Every effect is:
     • gated behind a user motion setting (full / subtle / off),
     • disabled when the OS asks for reduced motion,
     • defensive — missing elements are no-ops, never throwers.

   Levels (body class):
     fx-full    3D felt table + all motion (default)
     fx-subtle  flat board, gentle motion only
     fx-off     no motion, no depth
   Plus fx-reduced (from prefers-reduced-motion) which suppresses
   travel, idle breathing, camera moves and confetti regardless.
   ============================================================ */

const FX = {
  level: "full",          // full | subtle | off
  reduced: false,         // OS prefers-reduced-motion
  _riverLen: 0,           // last river length we animated an entry for
};

function fxLevelStored() {
  const v = (typeof storeGet === "function") ? storeGet("meowjong-fx") : null;
  return (v === "full" || v === "subtle" || v === "off") ? v : "full";
}

/* Motion allowed at all right now? (idle/travel/camera/confetti) */
function fxMotion() { return FX.level !== "off" && !FX.reduced; }
/* 3D depth allowed? (static — survives reduced-motion) */
function fxDepth() { return FX.level === "full"; }

function fxApplyClasses() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle("fx-full", FX.level === "full");
  b.classList.toggle("fx-subtle", FX.level === "subtle");
  b.classList.toggle("fx-off", FX.level === "off");
  b.classList.toggle("fx-depth", fxDepth());
  b.classList.toggle("fx-motion", fxMotion());
  b.classList.toggle("fx-reduced", FX.reduced);
}

function fxSetLevel(level) {
  FX.level = (level === "full" || level === "subtle" || level === "off") ? level : "full";
  if (typeof storeSet === "function") storeSet("meowjong-fx", FX.level);
  fxApplyClasses();
  const sel = document.getElementById("fx-level");
  if (sel && sel.value !== FX.level) sel.value = FX.level;
}

function fxInit() {
  FX.level = fxLevelStored();
  try {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    FX.reduced = mq.matches;
    mq.addEventListener ? mq.addEventListener("change", e => { FX.reduced = e.matches; fxApplyClasses(); })
                        : mq.addListener(e => { FX.reduced = e.matches; fxApplyClasses(); });
  } catch (_) { FX.reduced = false; }
  fxApplyClasses();
  const sel = document.getElementById("fx-level");
  if (sel) {
    sel.value = FX.level;
    sel.addEventListener("change", e => fxSetLevel(e.target.value));
  }
  fxInitTilt();
}

/* ---------- small helpers ---------- */

function fxReq(fn) { if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn); else setTimeout(fn, 16); }
function $fx(sel, root) { return (root || document).querySelector(sel); }

/* Add a class, then strip it after `ms` so the animation can replay next time. */
function fxPulse(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;          // reflow → restart animation
  el.classList.add(cls);
  setTimeout(() => el && el.classList.remove(cls), ms);
}

/* ---------- M1 · FLIP + exit registry (the persistent-tile payoff) ---------- */

function fxFlipEnabled() { return fxMotion(); }

/* Retained hand tiles glide from their old slot to their new one (First-Last-
   Invert-Play); entering tiles get the draw-in entrance. Transform-only, GPU. */
function fxFlipPlay(nodes, firstRects) {
  const moves = [];
  for (const el of nodes) {
    if (el.dataset.enter) {
      delete el.dataset.enter;
      if (fxMotion()) fxPulse(el, "fx-draw-in", 420);
      continue;
    }
    const f = firstRects.get(el);
    if (!f) continue;
    const l = el.getBoundingClientRect();
    const dx = f.left - l.left, dy = f.top - l.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    moves.push([el, dx, dy]);
  }
  if (!moves.length) return;
  for (const [el, dx, dy] of moves) {
    el.classList.add("fx-flip");
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  void document.body.offsetWidth;   // commit the inverted position
  for (const [el] of moves) {
    el.style.transition = "transform .28s cubic-bezier(.22,.61,.36,1)";
    el.style.transform = "";
    setTimeout(() => { el.classList.remove("fx-flip"); el.style.transition = ""; }, 340);
  }
}

/* Tiles that leave a container record their final screen position here so a
   flight animation can start from where the tile actually was. Entries are
   short-lived (600 ms) and capped — a registry, not a leak. */
FX._exits = [];
function fxRecordExit(kind, el, src) {
  if (!fxMotion()) return;
  try {
    FX._exits.push({ kind, src: src || "hand", rect: el.getBoundingClientRect(), t: performance.now() });
    if (FX._exits.length > 8) FX._exits.shift();
  } catch (_) {}
}
function fxTakeExit(kind, src) {
  const now = performance.now();
  for (let i = FX._exits.length - 1; i >= 0; i--) {
    const e = FX._exits[i];
    if (now - e.t > 600) continue;
    if ((kind === null || e.kind === kind) && (!src || e.src === src)) {
      FX._exits.splice(i, 1);
      return e;
    }
  }
  return null;
}

/* Fly a ghost tile from a screen rect to a destination element, then reveal
   the real node with a landing squash. Pure presentation; self-cleaning. */
function fxFly(fromRect, toEl, kind, small) {
  if (!fxMotion() || !toEl || !fromRect || typeof tileEl !== "function") return false;
  const to = toEl.getBoundingClientRect();
  if (!to.width) return false;
  const ghost = tileEl(kind, { small: !!small });
  ghost.classList.add("fx-ghost");
  ghost.style.left = fromRect.left + "px";
  ghost.style.top = fromRect.top + "px";
  ghost.style.width = fromRect.width + "px";
  ghost.style.height = fromRect.height + "px";
  document.body.appendChild(ghost);
  toEl.style.visibility = "hidden";
  void ghost.offsetWidth;
  const dx = to.left - fromRect.left, dy = to.top - fromRect.top;
  ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${to.width / fromRect.width}, ${to.height / fromRect.height}) rotate(3deg)`;
  setTimeout(() => {
    ghost.remove();
    toEl.style.visibility = "";
    fxPulse(toEl, "fx-land", 320);
  }, 400);
  return true;
}

/* ---------- discard: the tile TRAVELS to the river, then settles ---------- */

function fxAfterDiscard() {
  const river = document.getElementById("river");
  if (!river) return;
  const cells = river.querySelectorAll(".river-cell");
  const grew = cells.length > FX._riverLen;
  FX._riverLen = cells.length;
  if (!grew) return;
  // sound is a separate opt-in from visual motion, so it plays even at fx-off
  if (typeof sndDiscard === "function") sndDiscard();
  if (!fxMotion()) return;
  const tile = cells[cells.length - 1] && cells[cells.length - 1].querySelector(".tile");
  if (!tile) return;
  const kind = Number(tile.dataset.kind);
  // your discard: fly from where the tile sat in your hand
  const exit = fxTakeExit(kind, "hand");
  if (exit && fxFly(exit.rect, tile, kind, true)) return;
  // an opponent's discard: fly from their panel instead
  const seat = (typeof G !== "undefined" && G.lastDiscard) ? G.lastDiscard.seat : 0;
  if (seat > 0) {
    const src = $fx(`#opp-${seat} .opp-hand`);
    if (src && fxFly(src.getBoundingClientRect(), tile, kind, true)) return;
  }
  fxPulse(tile, "fx-drop", 460);   // fallback: drop-in
}

/* keep the river-length counter honest across re-deals / renders that shrink it */
function fxSyncRiver() {
  const river = document.getElementById("river");
  FX._riverLen = river ? river.querySelectorAll(".river-cell").length : 0;
}

/* ---------- draw: the freshly drawn tile slides into the hand ---------- */

function fxAfterDraw() {
  if (typeof sndDraw === "function") sndDraw();
  if (!fxMotion()) return;
  const drawn = $fx("#hand .tile.drawn");
  fxPulse(drawn, "fx-draw-in", 420);
}

/* ---------- claim: the claimed tile flies from the river into the meld ---------- */

function fxAfterClaim(seat) {
  const sel = seat === 0 ? "#your-melds .meld:last-child" : `#opp-${seat} .opp-melds .meld:last-child`;
  const meld = $fx(sel);
  if (meld && typeof sndClaim === "function") sndClaim(meld.children.length);
  if (!fxMotion() || !meld) return;
  const exit = fxTakeExit(null, "river");   // renderRiver recorded the popped tile
  if (exit) fxFly(exit.rect, meld, exit.kind, true);
  fxPulse(meld, "fx-gather", 520);
  setTimeout(() => fxSpark(meld), 360);     // M9: a little spark as it locks in
  // M10: shout the call over the meld, and the claiming cat gets excited
  const melds = (typeof G !== "undefined" && G.seats && G.seats[seat]) ? G.seats[seat].melds : null;
  const last = melds && melds.length ? melds[melds.length - 1] : null;
  const word = last ? ({ chow: "CHI!", pung: "PENG!", kong: "GANG!" })[last.type] : null;
  if (word) setTimeout(() => fxClaimPop(meld, word), 160);
  if (seat > 0) fxEmote(seat, "😼");
}

/* A bold call-out ("PENG!") that pops above an element, then floats away. */
function fxClaimPop(el, text) {
  if (!fxMotion() || !el) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const pop = document.createElement("div");
  pop.className = "fx-claim-pop";
  pop.textContent = text;
  pop.style.left = (r.left + r.width / 2) + "px";
  pop.style.top = (r.top - 4) + "px";
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

/* The cat reacts: its name pill bounces and an emoji floats up from it. */
function fxEmote(seat, emoji) {
  if (!fxMotion()) return;
  const pill = $fx(`#opp-${seat} .opp-top`);
  if (!pill) return;
  fxPulse(pill, "fx-bounce", 650);
  const r = pill.getBoundingClientRect();
  if (!r.width) return;
  const e = document.createElement("div");
  e.className = "fx-emote";
  e.textContent = emoji;
  e.style.left = (r.left + r.width / 2) + "px";
  e.style.top = r.top + "px";
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 1100);
}

/* ---------- hover: tiles tilt toward the cursor (full effects only) ---------- */

function fxInitTilt() {
  const hand = document.getElementById("hand");
  if (!hand || hand._fxTilt) return;
  hand._fxTilt = true;
  hand.addEventListener("pointermove", e => {
    if (!fxMotion() || FX.level !== "full") return;
    const t = e.target.closest ? e.target.closest(".tile") : null;
    if (!t || !hand.contains(t)) return;
    const r = t.getBoundingClientRect();
    if (!r.width) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    t.style.setProperty("--rx", (-py * 9).toFixed(1) + "deg");
    t.style.setProperty("--ry", (px * 9).toFixed(1) + "deg");
  }, { passive: true });
  hand.addEventListener("pointerout", e => {
    const t = e.target.closest ? e.target.closest(".tile") : null;
    if (t) { t.style.removeProperty("--rx"); t.style.removeProperty("--ry"); }
  }, { passive: true });
}

/* ---------- camera: gentle push-in when it becomes your turn ---------- */

function fxTurnStart() {
  if (!fxMotion()) return;
  fxPulse(document.getElementById("center"), "fx-turn", 620);
}

/* ---------- win: glow + brief shake + optional confetti ---------- */

function fxWin(youWin, special) {
  if (typeof sndWin === "function") sndWin(youWin, special);
  const center = document.getElementById("center");
  if (fxMotion()) fxPulse(center, "fx-winshake", 700);
  const hand = document.getElementById("hand");
  if (hand && fxMotion()) fxPulse(hand, "fx-winglow", 1400);
  if (youWin && fxMotion() && !FX.reduced) fxConfetti();
}

/* Lazy, self-destroying confetti canvas over the board. No always-on context. */
function fxConfetti() {
  const host = document.getElementById("table") || document.body;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  const cv = document.createElement("canvas");
  cv.className = "fx-confetti";
  cv.width = Math.max(1, rect.width | 0);
  cv.height = Math.max(1, rect.height | 0);
  host.appendChild(cv);
  const ctx = cv.getContext("2d");
  const colors = ["#e8895a", "#7fa877", "#ffd65a", "#c96b3d", "#6b5ea8", "#fff3d6"];
  const N = Math.min(140, Math.round(cv.width / 6));
  const P = [];
  for (let i = 0; i < N; i++) P.push({
    x: cv.width * (0.3 + 0.4 * Math.random()),
    y: cv.height * 0.35 + (Math.random() * 20 - 10),
    vx: (Math.random() - 0.5) * 6,
    vy: -6 - Math.random() * 7,
    g: 0.22 + Math.random() * 0.12,
    s: 4 + Math.random() * 5,
    rot: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.4,
    c: colors[(Math.random() * colors.length) | 0],
  });
  const t0 = performance.now();
  function frame(t) {
    const life = t - t0;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of P) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - life / 1600);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (life < 1600) fxReq(frame); else cv.remove();
  }
  fxReq(frame);
}

/* ============================================================
   M9 · polish pass — count-up scores, board toasts, meld sparks.
   All presentation-only and motion-gated; each is a no-op (or an
   instant value set) when motion is off or the OS asks for reduced
   motion, so nothing here changes what the game communicates.
   ============================================================ */

/* ---------- count-up: a changed score ticks to its new value ---------- */
function fxCountUp(el, value, suffix = "") {
  if (!el) return;
  const prev = (el._scoreVal !== undefined) ? el._scoreVal : value;
  el._scoreVal = value;
  if (!fxMotion() || FX.reduced || prev === value) { el.textContent = value + suffix; return; }
  const token = (el._scoreTok = (el._scoreTok || 0) + 1);
  const t0 = performance.now(), dur = 650, from = prev, delta = value - from;
  function step(t) {
    if (el._scoreTok !== token) return;              // superseded by a newer change
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);                // ease-out cubic
    el.textContent = Math.round(from + delta * e) + suffix;
    if (p < 1) fxReq(step); else el.textContent = value + suffix;
  }
  fxReq(step);
}

/* ---------- toast: a brief banner at the top of the board ----------
   For flair only (the coach + log already carry the same info), so it
   stays quiet when motion is off. kind: "ready" | "danger" | "info". */
function fxToast(text, kind) {
  if (!fxMotion()) return;
  const t = document.createElement("div");
  t.className = "fx-toast fx-toast-" + (kind || "info");
  t.textContent = text;
  t.setAttribute("role", "status");
  document.body.appendChild(t);
  void t.offsetWidth;                                 // reflow → play the enter
  t.classList.add("fx-toast-in");
  setTimeout(() => { t.classList.remove("fx-toast-in"); t.classList.add("fx-toast-out"); }, 2400);
  setTimeout(() => t.remove(), 2900);
}

/* ---------- spark: a small burst when a meld locks in ---------- */
function fxSpark(el) {
  if (!fxMotion() || FX.reduced || !el || typeof el.getBoundingClientRect !== "function") return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, N = 8;
  for (let i = 0; i < N; i++) {
    const s = document.createElement("span");
    s.className = "fx-spark";
    s.style.left = cx + "px"; s.style.top = cy + "px";
    document.body.appendChild(s);
    const ang = (Math.PI * 2 * i) / N + Math.random() * 0.5;
    const dist = 16 + Math.random() * 16;
    void s.offsetWidth;
    s.style.transform = `translate(${(Math.cos(ang) * dist).toFixed(1)}px, ${(Math.sin(ang) * dist).toFixed(1)}px) scale(.3)`;
    s.style.opacity = "0";
    setTimeout(() => s.remove(), 480);
  }
}

/* ============================================================
   M10 · the win ceremony — staged scoring reveal in the end modal.
   The modal's blocks pop in one at a time (hand groups → scoring
   lines with rising ticks → the total counting up with a punch),
   and any click fast-forwards to the finished modal. Pure
   presentation: with motion off (or reduced) the modal simply
   appears complete, exactly as before.
   ============================================================ */

FX._wseqTok = 0;

function fxWinSequence(modal) {
  const token = ++FX._wseqTok;               // cancels any previous ceremony
  if (!fxMotion() || FX.reduced || !modal) return;
  const content = modal.querySelector("#modal-content");
  const buttons = modal.querySelector("#modal-buttons");
  if (!content) return;

  // Reveal units: top-level blocks, with the hand groups and the scoring
  // lines exploded so each one pops individually.
  const units = [];
  for (const el of content.children) {
    if (el.classList && el.classList.contains("win-groups")) units.push(...el.children);
    else if (el.tagName === "UL") units.push(...el.children);
    else units.push(el);
  }
  if (units.length < 3) return;              // draws/tiny modals: not worth staging
  const totalEl = content.querySelector(".win-total");

  for (const u of units) u.classList.add("wseq-hide");
  if (buttons) buttons.classList.add("wseq-hide");

  const timers = [];
  const finish = () => {
    for (const t of timers) clearTimeout(t);
    for (const u of units) u.classList.remove("wseq-hide");
    if (buttons) buttons.classList.remove("wseq-hide");
    if (totalEl) {
      totalEl._scoreTok = (totalEl._scoreTok || 0) + 1;   // stop a running count-up
      totalEl.textContent = totalEl.dataset.total || totalEl.textContent;
    }
    modal.removeEventListener("click", skip, true);
  };
  const skip = () => { if (token === FX._wseqTok) finish(); };
  modal.addEventListener("click", skip, true);   // impatient? one click shows it all

  let t = 80, lineIdx = 0;
  for (const u of units) {
    const isGroup = u.classList.contains("win-group");
    const isLine = u.tagName === "LI";
    const li = lineIdx;
    if (isLine) lineIdx++;
    const holdsTotal = !!(totalEl && u.contains(totalEl));
    timers.push(setTimeout(() => {
      if (token !== FX._wseqTok) return;
      u.classList.remove("wseq-hide");
      u.classList.add("wseq-in");
      if (isGroup && typeof sndClack === "function") sndClack(0.05, 1100, 0.22);
      else if (isLine && typeof sndScoreTick === "function") sndScoreTick(li);
      if (holdsTotal) {
        if (typeof fxCountUp === "function" && totalEl) {
          totalEl._scoreVal = 0;
          fxCountUp(totalEl, Number(totalEl.dataset.total) || 0);
        }
        if (totalEl) totalEl.classList.add("wseq-total-pop");
        if (typeof sndScoreTotal === "function") sndScoreTotal();
      }
    }, t));
    t += holdsTotal ? 650 : isGroup ? 200 : isLine ? 260 : 140;
  }
  timers.push(setTimeout(() => {
    if (token !== FX._wseqTok) return;
    if (buttons) { buttons.classList.remove("wseq-hide"); buttons.classList.add("wseq-in"); }
    modal.removeEventListener("click", skip, true);
  }, t + 220));
}
