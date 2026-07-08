"use strict";
/* ============================================================
   Meowjong — FJ (Fujian) style game state & main loop
   Seat controllers: 'local' | 'remote' (party guest) | 'ai'
   FJ specifics:
   - winds are flowers: drawn → exposed → replacement from back wall
   - a gold (wild) tile is flipped after the deal; 3 copies live
   - instant wins: 抢金 (gold completes a ready dealt hand) and
     三金倒 (holding three golds)
   ============================================================ */

const G = {
  seats: [
    { name: "You",              emoji: "🧑", control: "local"  },
    { name: "Mochi",            emoji: "🐈", control: "ai" },
    { name: "Biscuit",          emoji: "🐈‍⬛", control: "ai" },
    { name: "Captain Whiskers", emoji: "🐯", control: "ai" },
  ],
  wall: [], river: [], dealer: 0, activeSeat: null, lastDiscard: null,
  handNumber: 1, gen: 0, peek: false, autoCoach: true,
  awaitingDiscard: false, selectedIdx: null, suggestKind: null,
  turnCtx: null, choiceSink: null,
  wildKind: null,    // the wild (gold) kind this hand
  wildFlip: null,    // the flipped display copy
  deadFlips: [],     // winds flipped while searching for the gold
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function removeN(arr, kind, n) {
  for (let i = 0; i < n; i++) {
    const idx = arr.indexOf(kind);
    if (idx >= 0) arr.splice(idx, 1);
  }
}
function isInteractive(s) { return s.control !== "ai"; }
function wildOf() { return (G.wildKind === null || G.wildKind === undefined) ? -1 : G.wildKind; }
function goldsIn(tiles) { const w = wildOf(); return w < 0 ? 0 : tiles.filter(t => t === w).length; }

/* ---------- Safe localStorage (throws in Safari private mode / quota) ---------- */
function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

/* ---------- Save / resume (single-player match ledger) ----------
   Saved at each hand boundary: scores, dealer, hand number, match length.
   Resuming restores the ledger and deals a fresh hand (a suspended async
   turn-loop can't be serialized safely; the in-progress hand's tiles are
   random anyway). One atomic JSON write per hand; corrupt/party saves are
   rejected on load so a bad blob can never crash or hijack the game. */
const SAVE_KEY = "meowjong-save";
const SAVE_VERSION = 2;
const MATCH_HANDS = 8;          // a session length; extendable via "keep playing"

function isSoloMatch() {
  if (typeof isPartyMode === "function" && isPartyMode()) return false;
  return G.seats[0] && G.seats[0].control === "local" &&
    G.seats.slice(1).every(s => s && s.control === "ai");
}

function saveMatch() {
  if (!isSoloMatch()) return;   // party matches can't be resumed (P2P session)
  storeSet(SAVE_KEY, JSON.stringify({
    v: SAVE_VERSION,
    scores: G.seats.map(s => s.score | 0),
    names: G.seats.map(s => s.name),
    emojis: G.seats.map(s => s.emoji),
    controls: G.seats.map(s => s.control),
    dealer: G.dealer, handNumber: G.handNumber,
    matchTarget: G.matchTarget || MATCH_HANDS,
    ts: Date.now(),
  }));
}

function loadMatch() {
  const raw = storeGet(SAVE_KEY);
  if (!raw) return null;
  let d;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (!d || d.v !== SAVE_VERSION) return null;
  if (!Array.isArray(d.scores) || d.scores.length !== 4 || d.scores.some(n => !Number.isFinite(n))) return null;
  if (!Array.isArray(d.controls) || d.controls[0] !== "local" || d.controls.slice(1).some(c => c !== "ai")) return null;
  if (!(d.dealer >= 0 && d.dealer < 4) || !(d.handNumber >= 1)) return null;
  return d;
}

function clearSave() { storeSet(SAVE_KEY, ""); }

function resumeMatch() {
  const d = loadMatch();
  if (!d) { newMatch(); return; }
  for (let i = 0; i < 4; i++) {
    G.seats[i].score = d.scores[i] | 0;
    if (d.names && d.names[i]) G.seats[i].name = String(d.names[i]);
    if (d.emojis && d.emojis[i]) G.seats[i].emoji = String(d.emojis[i]);
    G.seats[i].control = d.controls[i];
  }
  G.dealer = d.dealer | 0;
  G.handNumber = d.handNumber | 0;
  G.matchTarget = d.matchTarget || MATCH_HANDS;
  hideMenu();
  coachSay("Welcome back! Resuming your match — fresh tiles for this hand. 🐱", "🎓");
  startHand();
}

/* In-game reference for how THIS implementation of FJ mahjong is scored and
   which optional rules are simplified — so players who know FJ aren't surprised. */
function showHouseRules() {
  showModal(`
    <h2>📋 House rules & scoring</h2>
    <p>This is <b>FJ (Fujian / Fuzhou) style</b>. How it's played here:</p>
    <p><b>Tiles:</b> 124 — Dots, Bamboo, Characters (1–9) + the four Winds. <b>No dragons.</b></p>
    <p><b>Winds are flowers 🌸:</b> never kept in hand — exposed and replaced from the back wall.</p>
    <p><b>The Gold 🥇:</b> one flipped tile's other 3 copies are wild. It completes any run or
    triplet, but <b>can't be your pair</b> and <b>can't be claimed</b> from a discard.</p>
    <p><b>Winning:</b> 4 sets + 1 pair, then call <b>Hú! 胡</b>.</p>
    <p><b>Scoring:</b> winner gets <b>10 × flower count</b> (min ×1); <b>+20</b> for no flowers,
    <b>+10</b> self-draw, <b>+30</b> Three Golds 三金倒, <b>+50</b> Robbing the Gold 抢金.
    On a discard win the discarder pays double; on self-draws &amp; instant wins everyone pays.</p>
    <p><b>A match is ${MATCH_HANDS} hands</b>, then final standings (you can keep playing).</p>
    <p class="log-dim"><b>Simplified for approachability:</b> chi only from the player on your
    left; no robbing-the-kong; the dealer isn't eligible for 抢金; no reserved dead wall.</p>`,
    [{ label: "Got it", cls: "primary", cb: hideModal }]);
}

function showStandings() {
  const ranked = G.seats
    .map(s => ({ name: s.name, emoji: s.emoji, score: s.score, you: s.control === "local" }))
    .sort((a, b) => b.score - a.score);
  const target = G.matchTarget || MATCH_HANDS;
  let html = `<h2>🏁 Match complete!</h2><p>Final standings after ${target} hands:</p><ol class="standings">`;
  ranked.forEach((r, i) => {
    html += `<li class="${r.you ? "you" : ""}">${i === 0 ? "🏆 " : ""}${escapeHtml(r.emoji)} <b>${escapeHtml(r.name)}</b> — ${r.score} pts${r.you ? " (you)" : ""}</li>`;
  });
  html += `</ol>`;
  showModal(html, [
    { label: "New match", cls: "primary", cb: () => { hideModal(); newMatch(); } },
    { label: "Keep playing", cls: "secondary", cb: () => { G.matchTarget = target + MATCH_HANDS; saveMatch(); hideModal(); startHand(); } },
    { label: "Main menu", cls: "secondary", cb: () => { hideModal(); gotoMenu(); } },
  ]);
}

/* ---------- Fatal-error recovery ---------- */
/* Any uncaught error in the async turn pipeline would otherwise freeze the game
   silently. Surface it and offer a clean recovery instead of a soft-lock. */
function reportFatal(err) {
  try { console.error("[Meowjong] recovered from error:", err); } catch (e) {}
  if (G._fatalShown) return;
  G._fatalShown = true;
  const clear = () => { G._fatalShown = false; hideModal(); };
  if (typeof NET !== "undefined" && NET.role === "guest") {
    showModal("<h2>Something went wrong</h2><p>The game hit an unexpected error. Reload to rejoin the room.</p>",
      [{ label: "Reload", cls: "primary", cb: () => location.reload() }]);
    return;
  }
  showModal("<h2>Something went wrong</h2><p>The game hit an unexpected error and recovered. Your match scores are kept; this hand will be re-dealt.</p>",
    [
      { label: "Re-deal this hand", cls: "primary", cb: () => { clear(); startHand(); } },
      { label: "Main menu", cls: "secondary", cb: () => { clear(); gotoMenu(); } },
    ]);
}

/* Clear the local player's (or a guest's) open prompt UI without sending an
   action — used when the host cancels a hand out from under a guest. */
function clearLocalPrompt() {
  G.awaitingDiscard = false;
  G.selectedIdx = null;
  G.turnCtx = null;
  G.choiceSink = null;
  clearActions();
  setPrompt("");
  if (typeof analystIdle === "function") analystIdle();
}

/* Resolve any turn/claim promise still awaiting a human choice, so abandoned
   hand loops exit through their gen check instead of leaking their coroutine. */
function cancelPendingChoices() {
  if (G.choiceSink) {
    const sink = G.choiceSink;
    G.choiceSink = null;
    G.awaitingDiscard = false;
    G.turnCtx = null;
    sink({ type: "auto" });
  }
  if (typeof NET !== "undefined" && NET.pending) {
    for (const k in NET.pending) {
      const resolve = NET.pending[k];
      delete NET.pending[k];
      resolve({ type: "auto" });
    }
  }
}

/* Route a coach message to whichever human sits at seatIdx (if any) */
function coachFor(seatIdx, msg, mood = "🐱") {
  const s = G.seats[seatIdx];
  if (s.control === "local") { if (G.autoCoach) coachSay(msg, mood); }
  else if (s.control === "remote") netSendTo(seatIdx, { t: "coach", msg, mood });
}

/* Route a private log line (e.g. "You draw …") to the right human */
function logFor(seatIdx, msg, cls = "") {
  const s = G.seats[seatIdx];
  if (s.control === "local") log(msg, cls, true);
  else if (s.control === "remote") netSendTo(seatIdx, { t: "log", msg, cls });
}

/* ---------- Match / hand setup ---------- */

function newMatch() {
  for (const s of G.seats) s.score = 500;
  G.dealer = 0;
  G.handNumber = 1;
  G.matchTarget = MATCH_HANDS;
  startHand();
}

function startHand() {
  G.gen++;
  cancelPendingChoices();   // free any coroutine left awaiting a choice from a prior hand
  saveMatch();              // checkpoint the ledger so a reload can resume this hand
  G.wall = buildWall();
  G.river = [];
  G.lastDiscard = null;
  G.activeSeat = null;
  G.awaitingDiscard = false;
  G.selectedIdx = null;
  G.suggestKind = null;
  G.wildKind = null;
  G.wildFlip = null;
  G.deadFlips = [];
  G.goldHinted = false;
  G.gold2Hinted = false;
  G.flowerHinted = false;
  for (let i = 0; i < 4; i++) {
    const s = G.seats[i];
    s.hand = [];
    s.melds = [];
    s.flowers = [];
    s.drawn = null;
    s.threatWarned = false;
    s.wind = (i - G.dealer + 4) % 4;
    for (let t = 0; t < 13; t++) s.hand.push(G.wall.pop());
    sortHand(s.hand);
  }
  clearActions();
  setPrompt("");
  if (typeof netBroadcastPromptCancel === "function") netBroadcastPromptCancel();
  if (typeof netCloseModals === "function") netCloseModals();
  log(`<b>— Hand ${G.handNumber} begins! ${G.seats[G.dealer].name} ${G.seats[G.dealer].emoji} is the dealer (East). —</b>`, "log-important");

  replaceInitialFlowers();
  flipGold();
  renderAll();
  if (typeof fxSyncRiver === "function") fxSyncRiver();

  if (G.autoCoach) coachSay(`A fresh hand! The gold is <b>${tileShort(wildOf())}</b> — its remaining copies are wild. Goal: <b>4 sets + 1 pair</b> (the pair must be natural tiles, no golds).`, "🥇");

  // Instant wins before any turn: dealt three golds, or 抢金 (gold completes a ready hand)
  for (let off = 0; off < 4; off++) {
    const seat = (G.dealer + off) % 4;
    const s = G.seats[seat];
    if (goldsIn(s.hand) >= 3) { doWin(seat, null, true, null, {}); return; }
  }
  for (let off = 1; off < 4; off++) {
    const seat = (G.dealer + off) % 4;
    const s = G.seats[seat];
    const c = countsOf(s.hand.concat([wildOf()]));
    if (isWinningCounts(c, 4 - s.melds.length, wildOf())) {
      doWin(seat, wildOf(), false, null, { qiangJin: true });
      return;
    }
  }
  handLoop(G.gen);
}

/* Winds dealt into starting hands become flowers, replaced from the back wall (dealer first) */
function replaceInitialFlowers() {
  for (let off = 0; off < 4; off++) {
    const i = (G.dealer + off) % 4;
    const s = G.seats[i];
    while (true) {
      const winds = s.hand.filter(t => isWind(t));
      if (!winds.length) break;
      s.hand = s.hand.filter(t => !isWind(t));
      for (const wd of winds) {
        s.flowers.push(wd);
        if (G.wall.length) s.hand.push(G.wall.shift());
      }
    }
    sortHand(s.hand);
    if (s.flowers.length) {
      log(`🌸 ${s.emoji} ${s.name} starts with ${s.flowers.length} flower${s.flowers.length > 1 ? "s" : ""}: ${s.flowers.map(tileShort).join(" ")}`);
    }
  }
}

/* Flip tiles from the back wall until a suit tile appears — that kind is the gold (wild) */
function flipGold() {
  while (G.wall.length) {
    const t = G.wall.shift();
    if (isWind(t)) { G.deadFlips.push(t); continue; }
    G.wildKind = t;
    G.wildFlip = t;
    break;
  }
  // Defensive: a 124-tile FJ wall always contains suit tiles, but never let a
  // degenerate wall leave wildKind null (would crash tileShort(-1) everywhere).
  if (G.wildKind === null) { G.wildKind = 0; G.wildFlip = 0; }
  log(`🥇 <b>The gold is flipped: ${tileShort(wildOf())}</b> (${tileName(wildOf())}) — its 3 remaining copies are <b>WILD</b>.${G.deadFlips.length ? ` <span class="log-dim">(flipped past ${G.deadFlips.map(tileShort).join(" ")})</span>` : ""}`, "log-important");
}

function nextHand(winnerSeat) {
  if (winnerSeat === null || winnerSeat !== G.dealer) {
    if (winnerSeat !== null) G.dealer = (G.dealer + 1) % 4;
  } else {
    log(`${G.seats[G.dealer].name} won as dealer and stays dealer!`);
  }
  G.handNumber++;
  if (isSoloMatch() && G.handNumber > (G.matchTarget || MATCH_HANDS)) { clearSave(); showStandings(); return; }
  startHand();
}

/* ---------- Drawing (flowers auto-resolve) ---------- */

/* Draw a tile for seatIdx; winds go to their flower row with a replacement
   from the back wall. Returns a suit tile, or null if the wall ran out. */
function drawResolved(seatIdx, fromBack = false) {
  const s = G.seats[seatIdx];
  let back = fromBack;
  while (true) {
    if (!G.wall.length) return null;
    const t = back ? G.wall.shift() : G.wall.pop();
    if (isWind(t)) {
      s.flowers.push(t);
      log(`🌸 ${s.emoji} ${s.name} draws flower <b>${tileShort(t)}</b> — exposed, replacement from the back wall. (${s.flowers.length} flower${s.flowers.length > 1 ? "s" : ""})`);
      back = true;
      continue;
    }
    return t;
  }
}

/* ---------- Main loop ---------- */

async function handLoop(gen) {
  try {
    let seat = G.dealer, mode = "draw";
    while (gen === G.gen) {
      const res = await takeTurn(seat, mode, gen);
      if (gen !== G.gen || !res || res.type === "end") return;
      const claim = await resolveClaims(seat, res.kind, gen);
      if (gen !== G.gen) return;
      if (!claim) { seat = (seat + 1) % 4; mode = "draw"; continue; }
      if (claim.type === "win") { await doWin(claim.seat, res.kind, false, seat); return; }
      applyClaim(claim, seat);
      seat = claim.seat;
      mode = claim.claimType === "kong" ? "kongdraw" : "nodraw";
    }
  } catch (err) {
    if (gen !== G.gen) return;   // superseded by an intended cancellation — ignore
    reportFatal(err);
  }
}

async function takeTurn(seat, mode, gen) {
  G.activeSeat = seat;
  const s = G.seats[seat];
  if (mode !== "nodraw") {
    const t = drawResolved(seat, mode === "kongdraw");
    if (t === null) { drawGame(); return { type: "end" }; }
    if (isInteractive(s)) {
      s.drawn = t;
      logFor(seat, `You draw <b>${tileShort(t)}</b> <span class="log-dim">(${tileName(t)})</span>.`);
    } else {
      s.hand.push(t);
    }
  }
  renderAll();
  if (mode !== "nodraw" && isInteractive(s) && typeof fxAfterDraw === "function") fxAfterDraw();
  return isInteractive(s) ? interactiveTurnLoop(seat, mode, gen) : aiTurnLoop(seat, mode, gen);
}

/* ---------- Human turn (local or remote) ---------- */

async function interactiveTurnLoop(seatIdx, mode, gen) {
  const s = G.seats[seatIdx];
  while (true) {
    const wild = wildOf();
    const tiles = s.hand.concat(s.drawn !== null ? [s.drawn] : []);
    const golds = goldsIn(tiles);
    const shapeWin = mode !== "nodraw" && isWinningCounts(countsOf(tiles), 4 - s.melds.length, wild);
    const threeGold = golds >= 3;
    const canWin = shapeWin || threeGold;
    const cKongs = mode !== "nodraw" && G.wall.length ? concealedKongs(tiles, wild) : [];
    const aKongs = mode !== "nodraw" && G.wall.length ? addedKongs(tiles, s.melds, wild) : [];

    let choice;
    if (s.control === "local") {
      if (G.autoCoach) coachTurnUpdate(canWin, threeGold, mode);
      choice = await new Promise(resolve => beginTurnPrompt({ canWin, threeGold, cKongs, aKongs, mode }, resolve));
    } else {
      choice = await netHostPrompt(seatIdx, { t: "prompt", kind: "turn", ctx: { canWin, threeGold, cKongs, aKongs, mode } });
    }
    if (gen !== G.gen) return { type: "end" };

    if (choice.type === "auto") {
      if (canWin) { await doWin(seatIdx, null, true, null, {}); return { type: "end" }; }
      const d = chooseDiscard(tiles, wild);
      choice = { type: "discard", kind: d.kind, idx: tiles.indexOf(d.kind) };
    }
    if (choice.type === "win" && canWin) {
      await doWin(seatIdx, null, true, null, {});
      return { type: "end" };
    }
    if (choice.type === "kong" && (cKongs.includes(choice.kind) || aKongs.includes(choice.kind))) {
      performOwnKong(seatIdx, choice.kind, cKongs.includes(choice.kind) ? "concealed" : "added");
      const rep = drawResolved(seatIdx, true);
      if (rep === null) { drawGame(); return { type: "end" }; }
      s.drawn = rep;
      log(`${s.emoji} ${s.name} declares a <b>gang</b> of ${tileShort(choice.kind)} and draws a bonus tile from the back wall!`, "log-claim");
      mode = "draw";
      renderAll();
      continue;
    }
    if (choice.type === "discard") {
      const kind = applyInteractiveDiscard(s, choice, tiles);
      if (kind === null) continue;
      pushDiscard(seatIdx, kind);
      const waits = winningKinds(s.hand, s.melds, wild);
      if (waits.length) {
        const parts = waits.map(k => `${tileShort(k)}${k === wild ? " 🥇" : ""} <b>(${liveCount(k, seatIdx)} left)</b>`);
        let msg = `😻 <b>You're ready (tenpai)!</b> You win the moment anyone discards — or you draw — one of: ${parts.join(", ")}`;
        if (waits.every(k => liveCount(k, seatIdx) === 0)) msg += `<br>⚠️ …though every copy is already visible. That wait is <b>dead</b> — reshape next turn!`;
        coachFor(seatIdx, msg, "😻");
      }
      return { type: "discard", kind };
    }
  }
}

function applyInteractiveDiscard(s, choice, tiles) {
  let idx = Number.isInteger(choice.idx) && tiles[choice.idx] === choice.kind ? choice.idx : tiles.indexOf(choice.kind);
  if (idx < 0) return null;
  if (s.drawn !== null && idx === s.hand.length) {
    s.drawn = null;
  } else {
    s.hand.splice(idx, 1);
    if (s.drawn !== null) { s.hand.push(s.drawn); s.drawn = null; sortHand(s.hand); }
  }
  return choice.kind;
}

/* ---------- Turn prompt UI (local player AND party guests) ---------- */

function beginTurnPrompt(ctx, sink) {
  G.awaitingDiscard = true;
  G.selectedIdx = null;
  G.turnCtx = ctx;
  G.choiceSink = sink;
  setPrompt(ctx.mode === "nodraw"
    ? "You claimed a set — now <b>discard</b>: click a tile to select it, click it again to throw it."
    : "<b>Your turn!</b> Click a tile to select it, then click it again (or press Discard) to throw it.");
  refreshTurnActions();
  renderAll();
  if (ctx.mode !== "nodraw" && typeof fxTurnStart === "function") fxTurnStart();
  if (typeof analystOnTurn === "function") analystOnTurn();
}

function refreshTurnActions() {
  if (!G.awaitingDiscard || !G.turnCtx) return;
  const you = G.seats[0];
  const btns = [];
  if (G.turnCtx.canWin) {
    btns.push({
      label: G.turnCtx.threeGold ? "Hú! 胡 — Three Golds! (Win!)" : "Hú! 胡 (Win!)",
      cls: "primary pulse",
      cb: () => finishHumanChoice({ type: "win" }),
    });
  }
  for (const k of G.turnCtx.cKongs) {
    btns.push({ label: `Gang ${tileShort(k)}`, cb: () => finishHumanChoice({ type: "kong", kind: k }) });
  }
  for (const k of G.turnCtx.aKongs) {
    btns.push({ label: `Gang ${tileShort(k)} (add to Peng)`, cb: () => finishHumanChoice({ type: "kong", kind: k }) });
  }
  if (G.selectedIdx !== null) {
    const tiles = you.hand.concat(you.drawn !== null ? [you.drawn] : []);
    const k = tiles[G.selectedIdx];
    btns.push({ label: `Discard ${tileShort(k)}`, cls: "primary", cb: () => doHumanDiscard(G.selectedIdx) });
  }
  showActions(btns);
}

function onHandTileClick(idx, kind) {
  if (!G.awaitingDiscard) return;
  if (G.selectedIdx === idx) { doHumanDiscard(idx); return; }
  G.selectedIdx = idx;
  if (G.autoCoach) {
    const you = G.seats[0];
    const tiles = you.hand.concat(you.drawn !== null ? [you.drawn] : []);
    const copies = tiles.filter(t => t === kind).length;
    let msg;
    if (kind === wildOf()) {
      msg = `🥇 <b>That's your GOLD (wild)!</b> It can complete any set — throwing it away is almost always a mistake. ${copies >= 2 ? "And you have " + copies + " — three golds wins instantly!" : ""}`;
    } else {
      msg = `${tileName(kind)} — you're holding ${copies} of ${copies === 1 ? "these" : "them"}. Click it <b>again</b> (or press Discard) to throw it.`;
      const danger = dangerNote(kind);
      if (danger) msg += `<br><br>${danger}`;
    }
    coachSay(msg);
  }
  refreshTurnActions();
  renderHand();
}

function doHumanDiscard(idx) {
  const you = G.seats[0];
  const tiles = you.hand.concat(you.drawn !== null ? [you.drawn] : []);
  if (idx === null || idx < 0 || idx >= tiles.length) return;
  finishHumanChoice({ type: "discard", idx, kind: tiles[idx] });
}

function finishHumanChoice(choice) {
  G.awaitingDiscard = false;
  G.selectedIdx = null;
  G.suggestKind = null;
  G.turnCtx = null;
  clearActions();
  setPrompt("");
  const sink = G.choiceSink;
  G.choiceSink = null;
  if (typeof analystIdle === "function") analystIdle();
  if (sink) sink(choice);
}

/* ---------- AI turn ---------- */

async function aiTurnLoop(seat, mode, gen) {
  const s = G.seats[seat];
  const wild = wildOf();
  await sleep(750);
  if (gen !== G.gen) return { type: "end" };

  if (goldsIn(s.hand) >= 3) { await doWin(seat, null, true, null, {}); return { type: "end" }; }
  if (mode !== "nodraw") {
    if (isWinningCounts(countsOf(s.hand), 4 - s.melds.length, wild)) {
      await doWin(seat, null, true, null, {});
      return { type: "end" };
    }
    for (const k of concealedKongs(s.hand, wild)) {
      if (!G.wall.length) break;
      performOwnKong(seat, k, "concealed");
      const rep = drawResolved(seat, true);
      if (rep === null) { drawGame(); return { type: "end" }; }
      s.hand.push(rep);
      log(`${s.name} declares a concealed <b>gang</b> and draws a bonus tile.`, "log-claim");
      renderAll();
      await sleep(500);
      if (isWinningCounts(countsOf(s.hand), 4 - s.melds.length, wild)) {
        await doWin(seat, null, true, null, {});
        return { type: "end" };
      }
    }
  }
  const d = chooseDiscard(s.hand, wild);
  removeN(s.hand, d.kind, 1);
  sortHand(s.hand);
  pushDiscard(seat, d.kind);
  return { type: "discard", kind: d.kind };
}

/* ---------- Discards & claims ---------- */

function pushDiscard(seat, kind) {
  G.river.push({ kind, seat });
  G.lastDiscard = { kind, seat };
  log(`${G.seats[seat].emoji} ${G.seats[seat].name} discards <b>${tileShort(kind)}</b> <span class="log-dim">(${tileName(kind)})</span>.`);
  renderAll();
  if (typeof fxAfterDiscard === "function") fxAfterDiscard();
}

async function resolveClaims(discarder, kind, gen) {
  const wild = wildOf();
  const isGoldDiscard = kind === wild;   // a discarded gold can only be won on, never melded
  const rank = c => c.claimType === "win" ? 0 : c.claimType === "chow" ? 2 : 1;
  const order = s => (s - discarder + 4) % 4;
  const claims = [];

  // AI intentions first — they're known immediately
  for (let off = 1; off <= 3; off++) {
    const seat = (discarder + off) % 4;
    const s = G.seats[seat];
    if (s.control !== "ai") continue;
    const winsIt = isWinningCounts(countsOf(s.hand.concat([kind])), 4 - s.melds.length, wild);
    if (winsIt) { claims.push({ seat, claimType: "win", type: "win" }); continue; }
    if (isGoldDiscard) continue;
    if (canKongFromDiscard(s.hand, kind, wild) && G.wall.length) { claims.push({ seat, claimType: "kong", type: "meld", kind }); continue; }
    if (aiWantsPung(s.hand, kind, wild)) { claims.push({ seat, claimType: "pung", type: "meld", kind }); continue; }
    if (seat === (discarder + 1) % 4) {
      const chow = aiWantsChow(s.hand, kind, wild);
      if (chow) claims.push({ seat, claimType: "chow", type: "meld", kind, tiles: chow.tiles });
    }
  }

  // Strongest AI claim already on the table (for pruning pointless human options)
  let bestAi = null;
  for (const c of claims) {
    if (!bestAi || rank(c) < rank(bestAi) || (rank(c) === rank(bestAi) && order(c.seat) < order(bestAi.seat))) bestAi = c;
  }

  const prompts = [];
  for (let off = 1; off <= 3; off++) {
    const seat = (discarder + off) % 4;
    const s = G.seats[seat];
    if (s.control === "ai") continue;
    const opts = {
      win: isWinningCounts(countsOf(s.hand.concat([kind])), 4 - s.melds.length, wild),
      pung: !isGoldDiscard && canPung(s.hand, kind, wild),
      kong: !isGoldDiscard && canKongFromDiscard(s.hand, kind, wild) && G.wall.length > 0,
      chows: (!isGoldDiscard && seat === (discarder + 1) % 4) ? chowOptions(s.hand, kind, wild) : [],
    };
    // don't offer choices that an AI claim already beats — Peng outranks Chi,
    // winning outranks everything, ties go to whoever is next in turn order
    if (bestAi) {
      const beats = r => r < rank(bestAi) || (r === rank(bestAi) && order(seat) < order(bestAi.seat));
      if (!beats(2)) opts.chows = [];
      if (!beats(1)) { opts.pung = false; opts.kong = false; }
      if (!beats(0)) opts.win = false;
    }
    if (!(opts.win || opts.pung || opts.kong || opts.chows.length)) continue;
    const label = `${G.seats[discarder].emoji} ${G.seats[discarder].name}`;
    const promise = s.control === "local"
      ? new Promise(res => claimPromptUI(opts, kind, label, res))
      : netHostPrompt(seat, { t: "prompt", kind: "claim", opts, tile: kind, discarderLabel: label });
    prompts.push({ seat, opts, promise });
  }

  const results = prompts.length ? await Promise.all(prompts.map(p => p.promise)) : [];
  if (gen !== G.gen) return null;

  for (let i = 0; i < results.length; i++) {
    const c = results[i];
    const { seat, opts } = prompts[i];
    if (!c || c.type === "pass") continue;
    if (c.type === "auto") {
      if (opts.win) claims.push({ seat, claimType: "win", type: "win" });
      continue;
    }
    if (c.type !== "claim") continue;
    if (c.claimType === "win" && opts.win) claims.push({ seat, claimType: "win", type: "win" });
    else if (c.claimType === "kong" && opts.kong) claims.push({ seat, claimType: "kong", type: "meld", kind });
    else if (c.claimType === "pung" && opts.pung) claims.push({ seat, claimType: "pung", type: "meld", kind });
    else if (c.claimType === "chow" && c.tiles && opts.chows.some(p => p[0] === c.tiles[0] && p[1] === c.tiles[1])) {
      claims.push({ seat, claimType: "chow", type: "meld", kind, tiles: c.tiles });
    }
  }

  if (!claims.length) return null;
  claims.sort((a, b) => rank(a) - rank(b) || order(a.seat) - order(b.seat));
  const chosen = claims[0];
  if (chosen.claimType === "win") return { type: "win", seat: chosen.seat };
  await sleep(400);
  return chosen;
}

/* Claim prompt UI — shared by the local player and party guests. */
function claimPromptUI(opts, kind, discarderLabel, sink) {
  const done = (c) => { clearActions(); setPrompt(""); if (typeof analystIdle === "function") analystIdle(); sink(c); };
  setPrompt(`${discarderLabel} discarded <b>${tileShort(kind)}</b> — you can claim it!`);
  if (G.autoCoach) coachClaimAdvice(opts, kind);
  if (typeof analystOnClaim === "function") analystOnClaim(opts, kind);

  const mainButtons = () => {
    const btns = [];
    if (opts.win) btns.push({ label: "Hú! 胡 (Win!)", cls: "primary pulse", cb: () => done({ type: "claim", claimType: "win" }) });
    if (opts.kong) btns.push({ label: `Gang ${tileShort(kind)}`, cb: () => done({ type: "claim", claimType: "kong" }) });
    if (opts.pung) btns.push({ label: `Peng ${tileShort(kind)}`, cb: () => done({ type: "claim", claimType: "pung" }) });
    if (opts.chows.length === 1) {
      const [a, b] = opts.chows[0];
      btns.push({ label: `Chi (${tileShort(a)} ${tileShort(b)})`, cb: () => done({ type: "claim", claimType: "chow", tiles: opts.chows[0] }) });
    } else if (opts.chows.length > 1) {
      btns.push({ label: "Chi…", cb: () => {
        const sub = opts.chows.map(pair => ({
          label: `Use ${tileShort(pair[0])} + ${tileShort(pair[1])}`,
          cb: () => done({ type: "claim", claimType: "chow", tiles: pair }),
        }));
        sub.push({ label: "← Back", cls: "secondary", cb: () => showActions(mainButtons()) });
        showActions(sub);
      }});
    }
    btns.push({ label: "Pass", cls: "secondary", cb: () => done({ type: "pass" }) });
    return btns;
  };
  showActions(mainButtons());
}

function coachClaimAdvice(opts, kind) {
  if (opts.win) { coachSay(`<b>TAKE IT!!</b> That ${tileName(kind)} completes your hand — click <b>Hú!</b> 🎉`, "🙀"); return; }
  const you = G.seats[0];
  let msg = "";
  if (opts.pung || opts.kong) {
    msg += `A <b>Peng</b> turns your pair of ${tileShort(kind)} into a complete triplet. `;
    msg += aiWantsPung(you.hand, kind, wildOf())
      ? "I'd <b>take it</b> — it clearly moves you forward!"
      : "But I'd <b>pass</b> — claiming locks tiles face-up, and your hand has better plans.";
  } else if (opts.chows.length) {
    msg += `A <b>Chi</b> would complete a run with your ${opts.chows[0].map(tileShort).join(" and ")}. `;
    msg += aiWantsChow(you.hand, kind, wildOf())
      ? "I'd <b>take it</b> — a free set!"
      : "But I'd <b>pass</b> — those tiles may be more useful where they are.";
  }
  coachSay(msg, "🤔");
}

function applyClaim(claim, discarder) {
  const s = G.seats[claim.seat];
  G.river.pop();
  G.lastDiscard = null;
  if (claim.claimType === "pung") {
    removeN(s.hand, claim.kind, 2);
    s.melds.push({ type: "pung", kind: claim.kind, concealed: false });
  } else if (claim.claimType === "kong") {
    removeN(s.hand, claim.kind, 3);
    s.melds.push({ type: "kong", kind: claim.kind, concealed: false });
  } else {
    removeN(s.hand, claim.tiles[0], 1);
    removeN(s.hand, claim.tiles[1], 1);
    const start = Math.min(claim.kind, claim.tiles[0], claim.tiles[1]);
    s.melds.push({ type: "chow", kind: start, concealed: false });
  }
  log(`${s.emoji} <b>${s.name} claims ${(MELD_LABEL[claim.claimType] || claim.claimType).toUpperCase()}!</b> on ${tileShort(claim.kind)} from ${G.seats[discarder].name}.`, "log-claim");
  renderAll();
  if (typeof fxAfterClaim === "function") fxAfterClaim(claim.seat);
  if (s.melds.length >= 3 && !s.threatWarned) {
    s.threatWarned = true;
    const flowerBit = s.flowers.length >= 3 ? ` They also have <b>${s.flowers.length} flowers</b>, so their win pays big.` : "";
    const warning = `🚨 <b>Defense time!</b> ${s.emoji} ${s.name} now has <b>${s.melds.length} sets showing</b> — likely only a set and a pair from winning.${flowerBit} Prefer discards already in the pile or with most copies visible, and be very careful with fresh middle tiles.`;
    for (let i = 0; i < 4; i++) {
      if (i !== claim.seat && isInteractive(G.seats[i])) coachFor(i, warning, "🙀");
    }
  }
}

function performOwnKong(seat, kind, mode) {
  const s = G.seats[seat];
  if (s.drawn !== null && s.drawn !== undefined) { s.hand.push(s.drawn); s.drawn = null; }
  if (mode === "concealed") {
    removeN(s.hand, kind, 4);
    s.melds.push({ type: "kong", kind, concealed: true });
  } else {
    removeN(s.hand, kind, 1);
    const m = s.melds.find(m => m.type === "pung" && m.kind === kind);
    if (m) m.type = "kong";
  }
  sortHand(s.hand);
}

/* ---------- Coach (local player) ---------- */

function coachTurnUpdate(canWin, threeGold, mode) {
  if (canWin) {
    coachSay(threeGold
      ? "🥇🥇🥇 <b>THREE GOLDS — you win instantly (三金倒)!</b> Hit the win button!"
      : "🙀 <b>STOP! You can win right now!</b> Click the <b>Hú!</b> button!", "🙀");
    return;
  }
  const you = G.seats[0];
  const wild = wildOf();
  const tiles = you.hand.concat(you.drawn !== null ? [you.drawn] : []);
  const golds = goldsIn(tiles);

  if (golds === 2 && !G.gold2Hinted) {
    G.gold2Hinted = true;
    coachSay(`🥇🥇 <b>TWO golds!</b> One more ${tileShort(wild)} and you win instantly (三金倒, +30). Guard them with your life — and remember golds can finish any set, so keep flexible shapes.`, "🤩");
    return;
  }
  if (golds === 1 && !G.goldHinted) {
    G.goldHinted = true;
    coachSay(`🥇 You hold a <b>gold</b> (${tileShort(wild)})! It substitutes for <b>any suit tile</b> in a run or triplet — just remember it can't be your pair. Never discard it.`, "🤩");
    return;
  }
  if (you.flowers.length >= 4 && !G.flowerHinted) {
    G.flowerHinted = true;
    coachSay(`🌸 <b>${you.flowers.length} flowers!</b> Your win pays <b>${you.flowers.length}× the base</b> — this hand is worth pushing hard for. Prioritize speed to ready!`, "🤑");
    return;
  }
  let minSh = 9;
  const seen = new Set();
  for (let i = 0; i < tiles.length; i++) {
    const k = tiles[i];
    if (seen.has(k) || k === wild) continue;
    seen.add(k);
    const rest = tiles.slice();
    rest.splice(i, 1);
    minSh = Math.min(minSh, roughShanten(rest, you.melds, wild));
    if (minSh === 0) break;
  }
  if (minSh === 0) coachSay("😻 A good discard makes you <b>ready to win (tenpai)</b> this turn! Not sure which? Hit <b>Hint</b>!", "😻");
  else if (minSh === 1) coachSay("Getting close — you're about <b>1 step from ready</b>. Keep your connected tiles! (Hint button if stuck)");
  else coachSay(`You're roughly <b>${minSh} steps from ready</b>. Collect pairs and neighboring numbers, shed loners. I'm here if you want a <b>Hint</b>!`);
}

function giveHint() {
  if (!G.awaitingDiscard) {
    coachSay("I can suggest a discard when it's <b>your turn</b>. For now — watch the discards and plan!");
    return;
  }
  const you = G.seats[0];
  const tiles = you.hand.concat(you.drawn !== null ? [you.drawn] : []);
  const hint = coachHint(tiles, you.melds);
  if (hint.win || hint.kind === null) {
    G.suggestKind = null;
    coachSay(hint.message, "🙀");
    renderHand();
    return;
  }
  G.suggestKind = hint.kind;
  coachSay(`I'd discard <b>${tileShort(hint.kind)}</b> (it's glowing in your hand).<br><br>${hint.message}`, "🎓");
  renderHand();
}

/* ---------- Hand end ---------- */

async function doWin(seat, winTile, selfDraw, discarder, special = {}) {
  const s = G.seats[seat];
  const wild = wildOf();
  const handKinds = s.hand.slice();
  if (s.drawn !== null && s.drawn !== undefined) handKinds.push(s.drawn);
  if (!selfDraw && winTile !== null) handKinds.push(winTile);
  sortHand(handKinds);
  const setsNeeded = 4 - s.melds.length;
  const golds = goldsIn(handKinds);
  const shapeWin = isWinningCounts(countsOf(handKinds), setsNeeded, wild);
  const threeGold = golds >= 3;
  const score = fjScore(s, {
    selfDraw,
    threeGold,
    qiangJin: !!special.qiangJin,
  });
  const everyonePays = selfDraw || !!special.qiangJin || discarder === null;
  const pay = fjPayout(score.total, everyonePays);

  if (everyonePays) {
    for (let i = 0; i < 4; i++) if (i !== seat) G.seats[i].score -= pay.each;
    s.score += pay.winner;
  } else {
    for (let i = 0; i < 4; i++) {
      if (i === seat) continue;
      G.seats[i].score -= (i === discarder) ? pay.discarder : pay.each;
    }
    s.score += pay.winner;
    G.river.pop();
  }

  G.activeSeat = null;
  G.lastDiscard = null;
  G.awaitingDiscard = false;
  clearActions();
  setPrompt("");
  renderAll();
  if (typeof fxWin === "function") fxWin(seat === 0);

  const howType = special.qiangJin ? "qiangjin" : (threeGold && !shapeWin) ? "threegold" : selfDraw ? "selfdraw" : "discard";
  // Structured, safe payload — shared by the host modal, the guest modal, and the log.
  const common = {
    kind: "win", wild,
    winnerName: s.name, winnerEmoji: s.emoji,
    howType, winTile: winTile == null ? -1 : winTile,
    discarderName: discarder != null ? G.seats[discarder].name : "",
    handKinds,
    melds: s.melds.map(m => ({ type: m.type, kind: m.kind, concealed: !!m.concealed })),
    flowers: s.flowers.slice(),
    scoreLines: score.lines, total: score.total, winnerPayout: pay.winner, everyonePays,
  };
  log(`<b>${s.emoji} ${s.name} wins ${endHowText(common)}</b>`, "log-important");

  showModal(endModalHtml(Object.assign({ youWin: s.control === "local" }, common)), [
    { label: "Next hand", cls: "primary", cb: () => { hideModal(); nextHand(seat); } },
    { label: "New match", cls: "secondary", cb: () => { hideModal(); newMatch(); } },
  ]);
  if (typeof netBroadcastEndModal === "function") {
    netBroadcastEndModal(guestSeat => Object.assign({ youWin: guestSeat === seat }, common));
  }
}

function drawGame() {
  G.activeSeat = null;
  G.awaitingDiscard = false;
  clearActions();
  setPrompt("");
  renderAll();
  log("<b>The wall is empty — this hand is a draw.</b>", "log-important");
  showModal(endModalHtml({ kind: "draw" }), [{ label: "Next hand", cls: "primary", cb: () => { hideModal(); nextHand(null); } }]);
  if (typeof netBroadcastEndModal === "function") {
    netBroadcastEndModal(() => ({ kind: "draw" }));
  }
}

/* ---------- Loading screen & main menu ---------- */

function showMenu() {
  $("#screen-menu").classList.remove("hidden");
  renderMenuTiles();
  // Surface a "Resume" button (as the primary action) only when a valid solo save exists.
  const save = loadMatch();
  const rb = $("#menu-resume");
  const solo = $("#menu-solo");
  if (!rb) return;
  if (save) {
    rb.classList.remove("hidden");
    rb.classList.add("primary");
    if (solo) solo.classList.remove("primary");
    const sub = $("#menu-resume-sub");
    if (sub) sub.textContent = `Hand ${save.handNumber} of ${save.matchTarget || MATCH_HANDS} · You: ${save.scores[0]} pts`;
  } else {
    rb.classList.add("hidden");
    if (solo) solo.classList.add("primary");
  }
}
function hideMenu() { $("#screen-menu").classList.add("hidden"); }

function renderMenuTiles() {
  const row = $("#menu-tiles");
  row.innerHTML = "";
  for (const k of [0, 13, 22, 4, 17, 26, 27]) row.appendChild(tileEl(k, { small: true }));
}

/* Return to the main menu, abandoning any hand in progress */
function gotoMenu() {
  G.gen++;                 // stop the running hand loop
  cancelPendingChoices();  // resolve abandoned turn/claim promises so they don't leak
  G.selectedIdx = null;
  clearActions();
  setPrompt("");
  hideModal();
  showMenu();
}

function startSolo() {
  hideMenu();
  coachSay("Good luck! Remember: <b>4 sets + 1 pair</b>, golds are wild, winds are flowers. Hit <b>Hint</b> whenever you're stuck. 🐱", "🎓");
  newMatch();
}

function finishLoading() {
  const load = $("#screen-loading");
  // Mount the menu UNDERNEATH the splash first (splash has the higher z-index),
  // then fade the splash away — a clean crossfade that never exposes the game scene.
  showMenu();
  load.classList.add("fade-out");
  setTimeout(() => {
    load.classList.add("hidden");
    if (!storeGet("meowjong-tutorial-seen")) {
      storeSet("meowjong-tutorial-seen", "1");
      openTutorial(0);
    }
  }, 450);
}

/* ---------- Boot ---------- */

window.addEventListener("DOMContentLoaded", () => {
  const bootT0 = Date.now();
  // Global safety net: never let an uncaught error leave the game frozen & silent.
  window.addEventListener("error", e => reportFatal(e.error || e.message));
  window.addEventListener("unhandledrejection", e => reportFatal(e.reason));
  applyIcons();
  if (typeof fxInit === "function") fxInit();
  if (typeof analystInit === "function") analystInit();

  $("#btn-menu").addEventListener("click", () => {
    if (!$("#screen-menu").classList.contains("hidden")) return;
    showModal("<h2>Back to the menu?</h2><p>The current hand will be abandoned.</p>", [
      { label: "To the menu", cls: "primary", cb: () => { hideModal(); gotoMenu(); } },
      { label: "Keep playing", cls: "secondary", cb: hideModal },
    ]);
  });
  $("#btn-tutorial").addEventListener("click", () => openTutorial(0, "basics"));
  $("#btn-strategy").addEventListener("click", () => openTutorial(0, "strategy"));
  $("#btn-party").addEventListener("click", () => netOpenPartyModal());
  $("#hint-btn").addEventListener("click", giveHint);
  $("#btn-newhand").addEventListener("click", () => {
    showModal("<h2>Start over?</h2><p>Abandon the current hand and re-deal?</p>", [
      { label: "Re-deal", cls: "primary", cb: () => { hideModal(); startHand(); } },
      { label: "Cancel", cls: "secondary", cb: hideModal },
    ]);
  });
  // M7.1: the ⚙ Options popover closes when you click anywhere else
  const hudSettings = $("#hud-settings");
  if (hudSettings) document.addEventListener("click", e => {
    if (hudSettings.open && !hudSettings.contains(e.target)) hudSettings.open = false;
  });
  $("#toggle-peek").addEventListener("change", e => { G.peek = e.target.checked; renderAll(); });
  $("#toggle-labels").addEventListener("change", e => {
    document.body.classList.toggle("hide-corners", !e.target.checked);
  });
  $("#toggle-coach").addEventListener("change", e => {
    G.autoCoach = e.target.checked;
    coachSay(G.autoCoach ? "I'm back! I'll comment as you play. 🐾" : "Going quiet — the Hint button still works if you need me. 🤫");
  });
  // M6/M7.5: Professor Paws floats bottom-right and collapses to a chat-bubble
  // tab. On phones the expanded card covers the hand + action dock, so it
  // starts collapsed on narrow screens (unless the player set a preference),
  // and the collapse state persists across sessions.
  const coachCollapse = $("#coach-collapse");
  if (coachCollapse) {
    const pref = (typeof storeGet === "function") ? storeGet("meowjong-paws-collapsed") : null;
    const startCollapsed = pref === "1" || (pref === null && window.innerWidth <= 900);
    setCoachCollapsed(startCollapsed);
    coachCollapse.addEventListener("click", () => {
      setCoachCollapsed(!$("#coach").classList.contains("collapsed"), true);
    });
    // shrinking to a narrow width auto-collapses (once) so Paws never buries
    // the hand; it never auto-expands, so it won't fight a deliberate open
    let wasNarrow = window.innerWidth <= 900;
    window.addEventListener("resize", () => {
      const narrow = window.innerWidth <= 900;
      if (narrow && !wasNarrow && !$("#coach").classList.contains("collapsed")) setCoachCollapsed(true);
      wasNarrow = narrow;
    });
  }
  $("#modal-overlay").addEventListener("click", e => { if (e.target.id === "modal-overlay") hideModal(); });

  // main menu buttons
  const mr = $("#menu-resume");
  if (mr) mr.addEventListener("click", resumeMatch);
  $("#menu-solo").addEventListener("click", () => {
    if (loadMatch()) {
      showModal("<h2>Start a new game?</h2><p>You have a match in progress. Starting a new game will overwrite it.</p>", [
        { label: "New game", cls: "primary", cb: () => { hideModal(); startSolo(); } },
        { label: "Cancel", cls: "secondary", cb: hideModal },
      ]);
    } else startSolo();
  });
  $("#menu-party").addEventListener("click", () => netOpenPartyModal());   // opens over the menu
  $("#menu-tutorial").addEventListener("click", () => openTutorial(0, "basics"));
  $("#menu-strategy").addEventListener("click", () => openTutorial(0, "strategy"));
  const rules = $("#menu-rules");
  if (rules) rules.addEventListener("click", showHouseRules);

  coachSay("Welcome to <b>FJ mahjong</b>! Winds are lucky flowers, and a flipped <b>gold tile</b> is wild. New here? Click <b>🎓 Tutorial</b>. 🐱");
  buildLegend();

  // Loading screen: keep the splash up ≥1.4s, then reveal the menu. The splash is
  // NOT gated on any external resource (PeerJS is vendored & lazy-loaded), so a slow
  // or offline network can never leave the player stuck on "Shuffling the tiles…".
  setTimeout(finishLoading, Math.max(0, 1400 - (Date.now() - bootT0)));
});
