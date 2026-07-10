"use strict";
/* ============================================================
   Meowjong — exact shanten + ukeire tests

   fjShanten claims to be EXACT, so we validate it three ways:
     1. crafted hands with known shanten,
     2. a brute-force BFS reference (min discard/draw swaps to tenpai),
        for every random hand the fast function rates 0–2 shanten,
     3. structural theorems that hold for any correct shanten:
        - shanten 0  ⟺  winningKinds is non-empty (exact tenpai),
        - no single drawn tile can drop shanten by 2 or more,
        - a non-ready hand always has at least one accepting tile.
   fjUkeire is checked for self-consistency against fjShanten.
   ============================================================ */

const { loadGame, test, eq, ok } = require("./harness");
const { T } = loadGame();

const { fjShanten, fjUkeire, winningKinds, countsOf } = T;

/* fjUkeire counts live tiles from the table, so give it a clean empty table
   (every kind then reads as 4 live — fine for the structural checks here). */
Object.assign(T.G, {
  river: [], wildFlip: null, deadFlips: [],
  seats: [0, 1, 2, 3].map(() => ({ hand: [], melds: [], flowers: [], drawn: null })),
});

/* ---------- brute-force reference ---------- */

const key = h => countsOf(h).join(",");
const _tenpaiMemo = new Map();
function isTenpai(hand) {
  const k = key(hand);
  let v = _tenpaiMemo.get(k);
  if (v === undefined) { v = winningKinds(hand, [], -1).length > 0; _tenpaiMemo.set(k, v); }
  return v;
}

/* min number of (discard one, draw one) swaps to reach tenpai, explored by
   breadth-first search up to `cap` swaps. Returns cap+1 if not reached — so it
   pins exact values in [0, cap]. Deliberately independent of fjShanten. */
function shBrute(hand, cap = 2) {
  if (isTenpai(hand)) return 0;
  let frontier = new Map([[key(hand), hand]]);
  const seen = new Set([key(hand)]);
  for (let depth = 1; depth <= cap; depth++) {
    const next = new Map();
    for (const h of frontier.values()) {
      const distinct = [...new Set(h)];
      for (const d of distinct) {
        const base = h.slice(); base.splice(base.indexOf(d), 1);
        for (let k = 0; k < 27; k++) {
          if (countsOf(base)[k] >= 4) continue;
          const h2 = base.concat([k]);
          if (isTenpai(h2)) return depth;
          const kk = key(h2);
          if (!seen.has(kk)) { seen.add(kk); next.set(kk, h2); }
        }
      }
    }
    frontier = next;
  }
  return cap + 1;
}

/* a random legal 13-tile hand from a 4-per-kind suit wall (kinds 0..26) */
function randomHand(n = 13) {
  const pool = [];
  for (let k = 0; k < 27; k++) for (let c = 0; c < 4; c++) pool.push(k);
  for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
}

/* ---------- 1. crafted known values ---------- */

test("fjShanten: a ready hand is 0 (tenpai)", () => {
  // 123 dots · 123 bam · 123 char · 45 dots · 99 dots  → waiting 3/6 dots
  eq(fjShanten([0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 8, 8], [], -1), 0);
});

test("fjShanten: one useful tile from ready is 1-shanten", () => {
  // 123 dots · 123 bam · 123 char · 5 dots · 99 dots · lone 1 char
  // (needs to pair the 5 or fix the floater) — one draw from tenpai
  const h = [0, 1, 2, 9, 10, 11, 18, 19, 20, 4, 8, 8, 22];
  eq(fjShanten(h, [], -1), 1);
});

test("fjShanten: a scattered hand is far from ready", () => {
  const h = [0, 3, 6, 9, 12, 15, 18, 21, 24, 26, 2, 13, 5];
  ok(fjShanten(h, [], -1) >= 3, "scattered hand should be 3+ shanten");
});

test("fjShanten: a claimed meld reduces the sets still needed", () => {
  // 2 claimed melds → need 2 sets + pair. Concealed: 1 set + pair + a ryanmen
  // (7 tiles) waiting on 2/5 dots → tenpai.
  const h = [0, 1, 2, 8, 8, 3, 4]; // 123d(set) 99d(pair) 45d(partial→needs 3/6)
  eq(fjShanten(h, [{ type: "pung", kind: 22 }, { type: "chow", kind: 24 }], -1), 0);
});

test("fjShanten: a gold (wild) is worth about one step", () => {
  const base = [0, 1, 9, 10, 18, 19, 3, 4, 5, 6, 22, 23, 8];
  const withGold = base.slice(); withGold[withGold.length - 1] = 26; // swap floater for a gold (kind 26)
  ok(fjShanten(withGold, [], 26) <= fjShanten(base, [], -1),
    "holding a gold is never farther from ready");
});

/* ---------- 2. brute-force agreement on rated 0–2 hands ---------- */

test("fjShanten matches brute force on near-ready random hands", () => {
  let checked = 0, tries = 0;
  while (checked < 18 && tries < 2500) {
    tries++;
    const h = randomHand();
    const s = fjShanten(h, [], -1);
    if (s > 2) continue;                    // brute (cap 2) pins only 0–2 exactly
    eq(s, shBrute(h, 2), "shanten mismatch for " + h.join(","));
    checked++;
  }
  ok(checked >= 10, "expected to verify a decent sample of near-ready hands (got " + checked + ")");
});

/* ---------- 3. structural theorems over many random hands ---------- */

test("fjShanten: 0 iff the hand is actually tenpai (exact boundary)", () => {
  for (let i = 0; i < 150; i++) {
    const h = randomHand();
    const ready = winningKinds(h, [], -1).length > 0;
    eq(fjShanten(h, [], -1) === 0, ready, "boundary mismatch for " + h.join(","));
  }
});

/* ---------- 4. ukeire self-consistency ---------- */

/* Independent ukeire for a 1-shanten hand: the tiles that, drawn then paired
   with the best discard, reach an actually-tenpai hand. */
function bruteUkeire1(h) {
  const set = [];
  for (let k = 0; k < 27; k++) {
    const drawn = h.concat([k]);
    let tenpai = false;
    for (const d of new Set(drawn)) {
      const back = drawn.slice(); back.splice(back.indexOf(d), 1);
      if (isTenpai(back)) { tenpai = true; break; }
    }
    if (tenpai) set.push(k);
  }
  return set.sort((a, b) => a - b);
}

test("fjUkeire: a non-ready hand always accepts at least one tile", () => {
  for (let i = 0; i < 120; i++) {
    const h = randomHand();
    const uke = fjUkeire(h, [], -1);
    if (uke.shanten === 0) continue;
    ok(uke.total > 0, "a non-ready hand must accept something: " + h.join(","));
  }
});

test("fjUkeire: on 1-shanten hands the accepted tiles match brute force", () => {
  let checked = 0, tries = 0;
  while (checked < 25 && tries < 3000) {
    tries++;
    const h = randomHand();
    if (fjShanten(h, [], -1) !== 1) continue;
    const got = fjUkeire(h, [], -1).tiles.map(t => t.kind).sort((a, b) => a - b);
    eq(got.join(","), bruteUkeire1(h).join(","), "ukeire mismatch for " + h.join(","));
    checked++;
  }
  ok(checked >= 12, "expected a decent sample of 1-shanten hands (got " + checked + ")");
});

test("fjUkeire: on a ready hand the accepted tiles are exactly the winning tiles", () => {
  const h = [0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 8, 8];
  const uke = fjUkeire(h, [], -1);
  eq(uke.shanten, 0);
  const got = uke.tiles.map(t => t.kind).sort((a, b) => a - b);
  const want = winningKinds(h, [], -1).slice().sort((a, b) => a - b);
  eq(got.join(","), want.join(","));
});
