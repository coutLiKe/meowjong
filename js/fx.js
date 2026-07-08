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
