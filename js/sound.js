"use strict";
/* ============================================================
   Meowjong — sound (revamp M8)

   PURE PRESENTATION, like fx.js. Every sound is synthesized in the
   browser with the Web Audio API (short oscillator tones + filtered
   noise "clacks") — no audio files, no licensing, no asset pipeline,
   so the game stays a single zero-build file://-friendly page.

   Off by default. Sound only starts once the player opts in via the
   Options popover — that click is itself the user gesture that
   satisfies the autoplay policy, so the AudioContext is only ever
   created in response to one.
   ============================================================ */

const SND = {
  enabled: false,
  volume: 0.6,
  ctx: null,
  master: null,
};

function sndStored() {
  const on = (typeof storeGet === "function") ? storeGet("meowjong-sound") : null;
  const vol = (typeof storeGet === "function") ? storeGet("meowjong-sound-vol") : null;
  SND.enabled = on === "on";
  const v = vol !== null ? parseFloat(vol) : NaN;
  SND.volume = !isNaN(v) ? Math.min(1, Math.max(0, v)) : 0.6;
}

/* Lazily create the AudioContext. Must only be reached from a user gesture
   (the sound toggle's change handler) — never called at page load. */
function sndEnsureCtx() {
  if (SND.ctx) return SND.ctx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    SND.ctx = new Ctx();
    SND.master = SND.ctx.createGain();
    SND.master.gain.value = SND.volume;
    SND.master.connect(SND.ctx.destination);
    return SND.ctx;
  } catch (_) { return null; }
}

function sndInit() {
  sndStored();
  const toggle = document.getElementById("toggle-sound");
  const vol = document.getElementById("sound-volume");
  if (toggle) {
    toggle.checked = SND.enabled;
    toggle.addEventListener("change", e => sndSetEnabled(e.target.checked));
  }
  if (vol) {
    vol.value = String(Math.round(SND.volume * 100));
    vol.addEventListener("input", e => sndSetVolume(Number(e.target.value) / 100));
  }
  sndBindUIClicks();
}

function sndSetEnabled(on) {
  SND.enabled = !!on;
  if (typeof storeSet === "function") storeSet("meowjong-sound", SND.enabled ? "on" : "off");
  if (!SND.enabled) return;
  const ctx = sndEnsureCtx();
  if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (_) {} }
  sndTone(660, 0.09, "sine", 0.18);   // a soft confirmation chirp so turning it on gives feedback
}

function sndSetVolume(v) {
  SND.volume = Math.min(1, Math.max(0, v));
  if (typeof storeSet === "function") storeSet("meowjong-sound-vol", String(SND.volume));
  if (SND.master) SND.master.gain.value = SND.volume;
}

function sndReady() { return SND.enabled && !!sndEnsureCtx(); }

/* ---------- low-level synth voices ---------- */

/* A short, clean tone with a quick attack and exponential decay. */
function sndTone(freq, dur, type, peak, when = 0) {
  if (!sndReady()) return;
  try {
    const ctx = SND.ctx, t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(SND.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (_) {}
}

/* Filtered decaying noise burst — reads as a tile hitting felt/wood far
   better than a pure tone would. Used for draw/discard/claim "clacks". */
function sndClack(dur, freq, peak, when = 0) {
  if (!sndReady()) return;
  try {
    const ctx = SND.ctx, t0 = ctx.currentTime + when;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(gain).connect(SND.master);
    src.start(t0);
  } catch (_) {}
}

/* ---------- event voices — called from fx.js's existing hooks ---------- */

function sndDraw() {
  sndClack(0.05, 1600, 0.14);
  sndTone(720, 0.05, "sine", 0.05, 0.01);
}

function sndDiscard() {
  sndClack(0.06, 950, 0.3);
}

/* size = number of tiles in the claimed meld (3 for chi/pung, 4 for a kong) */
function sndClaim(size) {
  const n = Math.max(2, size || 3);
  for (let i = 0; i < n; i++) sndClack(0.05, 1050, 0.28, i * 0.06);
  sndTone(880, 0.14, "triangle", 0.12, n * 0.06);
}

function sndTenpai() {
  sndTone(523.25, 0.11, "sine", 0.14, 0);     // C5
  sndTone(783.99, 0.16, "sine", 0.14, 0.1);   // G5 — a small rising interval
}

/* youWin gets a brighter chord than an opponent's win; `special` (an instant
   three-gold or robbing-the-gold win) layers on a bigger shimmer sting. */
function sndWin(youWin, special) {
  const notes = youWin ? [523.25, 659.25, 783.99, 1046.50] : [440, 554.37, 659.25];
  notes.forEach((f, i) => sndTone(f, 0.5, "sine", 0.12, i * 0.03));
  if (special) notes.forEach((f, i) => sndTone(f * 2, 0.35, "triangle", 0.06, 0.25 + i * 0.03));
}

function sndClick() {
  sndTone(500, 0.035, "square", 0.05);
}

/* Quiet feedback tick on chrome/menu buttons and toggles — not on the in-game
   action buttons (Discard/Chi/Peng/Kong/Hú), which already get a contextual
   sound moments later once the resulting state change resolves. */
function sndBindUIClicks() {
  document.addEventListener("click", e => {
    if (!sndReady()) return;
    const el = e.target.closest ? e.target.closest("header button, .menu-btn, .toggle") : null;
    if (el) sndClick();
  }, { passive: true });
}
