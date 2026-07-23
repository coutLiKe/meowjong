"use strict";
/* ============================================================
   Meowjong — cross-session hand history (Pillar 3 extension of G6)
   Extends the current-hand-only recap (G.myDiscardLog, main.js) into a
   persistent, capped archive so past hands stay browsable after "Next
   hand". Purely additive: no new analysis, just persisting what G6's
   discard trace already computes, at the same hand-end hooks stats.js
   uses. Solo-only, mirroring myDiscardLog's own existing scope.
   ============================================================ */

const HAND_HISTORY_KEY = "meowjong-hand-history";
const HAND_HISTORY_VERSION = 1;
const HAND_HISTORY_CAP = 20;

function handHistoryLoad() {
  const raw = storeGet(HAND_HISTORY_KEY);
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== HAND_HISTORY_VERSION || !Array.isArray(d.hands)) return [];
    return d.hands;
  } catch (e) { return []; }
}

function handHistorySave(hands) {
  storeSet(HAND_HISTORY_KEY, JSON.stringify({ v: HAND_HISTORY_VERSION, hands }));
}

/* Records the local human's just-finished hand — called from the same
   doWin/drawGame hooks statsRecordHandEnd already uses. discardTrace reuses
   the exact {kind, before, after} shape G.myDiscardLog already builds
   during play; oldest entries are evicted past the cap. */
function handHistoryRecord({ youWon = false, selfDraw = false, instantWin = false, flowers = 0, points = 0, dealtIn = false, handKinds = [] } = {}) {
  const hands = handHistoryLoad();
  hands.push({
    date: Date.now(),
    youWon, selfDraw, instantWin, dealtIn,
    flowers: flowers | 0, points: points | 0,
    handKinds: handKinds.slice(),
    discardTrace: (G.myDiscardLog || []).map(e => ({ kind: e.kind, before: e.before, after: e.after })),
  });
  while (hands.length > HAND_HISTORY_CAP) hands.shift();
  handHistorySave(hands);
}
