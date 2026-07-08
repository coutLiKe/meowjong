"use strict";
/* ============================================================
   Meowjong — randomization fairness regression tests.

   Guards the promise that "every player receives tiles by the
   same blind draw from one shuffled wall." These tests replicate
   the REAL deal procedure (startHand → replaceInitialFlowers →
   flipGold in js/main.js) using the game's own primitives
   (buildWall, isWind, sortHand, roughShanten), then assert that:

     • no seat gets a systematically stronger starting hand,
     • the dealer role confers no starting-hand edge (only tempo),
     • every tile kind appears with equal frequency in dealt hands,
     • the Fisher–Yates shuffle is position-uniform,
     • the deal never duplicates or loses a tile.

   Tolerances are deliberately wide (≈6–10 standard errors) so a
   fair system passes with astronomically low false-failure odds,
   while any structural bias (seat-0 favoritism, a broken shuffle,
   a redeal/strength-gate) shifts the statistics far enough to fail.

   These tests assert FAIRNESS ONLY — they must keep passing no
   matter how tile art, AI, or UI changes.
   ============================================================ */

const { loadGame, test, ok } = require("./harness");
const { T } = loadGame();

const r4 = x => Math.round(x * 10000) / 10000;   // stable rounding for messages
const shOf = (hand, wild) => T.roughShanten(hand, [], wild);

/* Faithful re-implementation of the production deal (js/main.js). Uses only
   the game's exported primitives, so a change to buildWall/isWind/etc. is
   exercised here exactly as it would be in a real hand. */
function dealHands(dealer) {
  const wall = T.buildWall();
  const seats = [0, 1, 2, 3].map(() => ({ hand: [], flowers: [] }));
  for (let i = 0; i < 4; i++) {
    for (let t = 0; t < 13; t++) seats[i].hand.push(wall.pop());
    T.sortHand(seats[i].hand);
  }
  // Winds in a starting hand become flowers, replaced from the front (back wall), dealer-first.
  for (let off = 0; off < 4; off++) {
    const s = seats[(dealer + off) % 4];
    while (true) {
      const winds = s.hand.filter(T.isWind);
      if (!winds.length) break;
      s.hand = s.hand.filter(t => !T.isWind(t));
      for (const wd of winds) { s.flowers.push(wd); if (wall.length) s.hand.push(wall.shift()); }
    }
    T.sortHand(s.hand);
  }
  // Flip the gold: first non-wind off the front; winds flipped past are dead.
  let wild = null;
  const deadFlips = [];
  while (wall.length) {
    const t = wall.shift();
    if (T.isWind(t)) { deadFlips.push(t); continue; }
    wild = t; break;
  }
  if (wild === null) wild = 0;
  return { seats, wild, deadFlips, wall };
}

/* One shared Monte-Carlo run feeds the three statistical tests below, so the
   expensive part (deals + shanten scoring) happens once. */
const SIM = (() => {
  const N = 12000;
  const sumSh = [0, 0, 0, 0];
  const near = [0, 0, 0, 0];            // count of hands at shanten <= 1
  let dealerSh = 0, otherSh = 0;
  const suit = new Array(27).fill(0);   // suit-kind appearances in hands (0..26)
  let suitTotal = 0;
  for (let n = 0; n < N; n++) {
    const dealer = (Math.random() * 4) | 0;   // dealer rotates, as in a real match
    const { seats, wild } = dealHands(dealer);
    for (let i = 0; i < 4; i++) {
      const sh = shOf(seats[i].hand, wild);
      sumSh[i] += sh;
      if (sh <= 1) near[i]++;
      if (i === dealer) dealerSh += sh; else otherSh += sh;
      for (const k of seats[i].hand) if (k < 27) { suit[k]++; suitTotal++; }
    }
  }
  return {
    N,
    seatMean: sumSh.map(s => s / N),
    nearPct: near.map(x => 100 * x / N),
    dealerMean: dealerSh / N,
    nonDealerMean: otherSh / (3 * N),
    suit, suitTotal,
  };
})();

/* ---------- 1. No seat is favored ---------- */

test("deal fairness — all four seats have equal starting-hand strength", () => {
  const mean = SIM.seatMean;
  const grand = mean.reduce((a, b) => a + b, 0) / 4;
  for (let i = 0; i < 4; i++) {
    ok(Math.abs(mean[i] - grand) < 0.05,
      `seat ${i}${i === 0 ? " (human)" : ""} mean shanten ${r4(mean[i])} vs grand ${r4(grand)} — imbalance too large`);
  }
  const nearPct = SIM.nearPct;
  ok(Math.max(...nearPct) - Math.min(...nearPct) < 2.0,
    `near-ready (<=1 shanten) spread too wide across seats: [${nearPct.map(r4).join(", ")}]%`);
  // Specifically: the human (seat 0) is not advantaged over the best cat.
  ok(nearPct[0] <= Math.max(nearPct[1], nearPct[2], nearPct[3]) + 1.5,
    `human near-ready rate ${r4(nearPct[0])}% exceeds the cats' — possible player bias`);
});

/* ---------- 2. Dealer role = tempo only, not stronger tiles ---------- */

test("deal fairness — dealer role gives no starting-hand advantage", () => {
  ok(Math.abs(SIM.dealerMean - SIM.nonDealerMean) < 0.05,
    `dealer mean shanten ${r4(SIM.dealerMean)} vs non-dealer ${r4(SIM.nonDealerMean)} — dealer should get tempo, not better tiles`);
});

/* ---------- 3. Every kind appears equally often across dealt hands ---------- */

test("distribution fairness — suit kinds appear with uniform frequency in hands", () => {
  const exp = SIM.suitTotal / 27;   // winds leave hands as flowers, so score suit kinds 0..26
  let chi = 0, maxDev = 0;
  for (let k = 0; k < 27; k++) {
    chi += (SIM.suit[k] - exp) * (SIM.suit[k] - exp) / exp;
    maxDev = Math.max(maxDev, Math.abs(SIM.suit[k] - exp) / exp);
  }
  // 26 df: fair ⇒ chi ≈ 26. Threshold 75 is very loose but catches any real skew.
  ok(chi < 75, `suit-kind frequency chi-square ${r4(chi)} on 26 df is too high — non-uniform deal`);
  ok(maxDev < 0.04, `a suit kind deviates ${r4(100 * maxDev)}% from uniform — non-uniform deal`);
});

/* ---------- 4. The shuffle itself is position-uniform ---------- */

test("shuffle uniformity — a fixed wall position is uniform over all kinds", () => {
  const N = 18000, K = 31;
  const counts = new Array(K).fill(0);
  for (let n = 0; n < N; n++) counts[T.buildWall()[0]]++;   // sample position 0
  const exp = N / K;
  let chi = 0;
  for (let k = 0; k < K; k++) chi += (counts[k] - exp) * (counts[k] - exp) / exp;
  // 30 df: fair ⇒ chi ≈ 30 ± ~8. Threshold 80 is ~6.5σ — never flaky, catches a biased shuffle.
  ok(chi < 80, `wall[0] kind distribution chi-square ${r4(chi)} on 30 df is too high — shuffle may be biased`);
});

/* ---------- 5. The deal conserves the full 124-tile set ---------- */

test("deal integrity — no tile is duplicated or lost during the deal", () => {
  for (let n = 0; n < 200; n++) {
    const { seats, wild, deadFlips, wall } = dealHands((Math.random() * 4) | 0);
    const c = new Array(31).fill(0);
    for (const s of seats) { for (const k of s.hand) c[k]++; for (const k of s.flowers) c[k]++; }
    for (const k of deadFlips) c[k]++;
    for (const k of wall) c[k]++;
    c[wild]++;   // the flipped gold tile itself
    for (let k = 0; k <= 30; k++) {
      ok(c[k] === 4, `kind ${k} accounted ${c[k]}/4 times after deal — tiles created or destroyed`);
    }
  }
});
