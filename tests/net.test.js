"use strict";
const { loadGame, test, eq, ok, notOk } = require("./harness");
const { T } = loadGame();

/* ---------- escapeHtml ---------- */

test("escapeHtml neutralizes all HTML metacharacters", () => {
  eq(T.escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  eq(T.escapeHtml("plain"), "plain");
});

/* ---------- sanitizeName (party name injection guard) ---------- */

test("sanitizeName strips HTML/script characters", () => {
  const s = T.sanitizeName("<img src=x onerror=alert(1)>");
  notOk(/[<>=()]/.test(s), "no angle brackets, equals, or parens survive");
  ok(s.length <= 14);
});

test("sanitizeName caps length and keeps friendly punctuation", () => {
  eq(T.sanitizeName("O'Brien-2.0xy"), "O'Brien-2.0xy");
  eq(T.sanitizeName("a".repeat(50)).length, 14);
});

test("sanitizeName falls back to 'Player' for empty/whitespace/garbage", () => {
  eq(T.sanitizeName(""), "Player");
  eq(T.sanitizeName("   "), "Player");
  eq(T.sanitizeName("<<<>>>"), "Player");
  eq(T.sanitizeName(null), "Player");
});

/* ---------- sanitizeMarkup (guest log/coach allowlist) ---------- */

test("sanitizeMarkup preserves the allowed formatting tags", () => {
  eq(T.sanitizeMarkup("draw <b>5●</b>"), "draw <b>5●</b>");
  eq(T.sanitizeMarkup("a<br>b"), "a<br>b");
  eq(T.sanitizeMarkup('<span class="log-dim">x</span>'), '<span class="log-dim">x</span>');
});

test("sanitizeMarkup neutralizes injected markup and attributes", () => {
  const out = T.sanitizeMarkup('<img src=x onerror=alert(1)><b onclick=evil>hi</b>');
  notOk(/<img/.test(out), "no live img tag");
  notOk(/<b onclick/.test(out), "no attribute-bearing tag restored");
  ok(/&lt;img/.test(out), "the img was escaped to inert text");
  ok(out.includes("hi"), "inner text is preserved");
});

test("sanitizeMarkup handles nullish input", () => {
  eq(T.sanitizeMarkup(null), "");
  eq(T.sanitizeMarkup(undefined), "");
});

/* ---------- party code / PeerJS connection config ---------- */

test("normalizePartyCode accepts pasted or lowercase room codes", () => {
  eq(T.normalizePartyCode(" ab-c "), "ABC");
  eq(T.normalizePartyCode("n m q v\n"), "NMQV");
  eq(T.normalizePartyCode(null), "");
});

test("peerId always uses the normalized room code", () => {
  eq(T.peerId(" nm-qv "), "meowjong-room-NMQV");
});

test("partyPeerOptions pins shared signaling and live ICE servers", () => {
  const opts = T.partyPeerOptions();
  eq(opts.host, "0.peerjs.com");
  eq(opts.port, 443);
  eq(opts.secure, true);
  const urls = opts.config.iceServers.flatMap(s => Array.isArray(s.urls) ? s.urls : [s.urls]);
  ok(urls.some(u => u.startsWith("stun:")), "has STUN candidates");
  // Regression guard: the PeerJS public TURN was shut down (eu-0/us-0.turn.
  // peerjs.com are NXDOMAIN, verified 2026-07-12), and the classic free
  // relays (openrelay.metered.ca) are dead too. Dead relay entries slow every
  // ICE gathering and mask real failures — they must never come back.
  notOk(urls.some(u => u.includes("turn.peerjs.com")), "no dead peerjs TURN hosts");
  notOk(urls.some(u => u.includes("openrelay.metered.ca")), "no dead openrelay hosts");
  ok(Array.isArray(T.PARTY_TURN_SERVERS), "pluggable TURN slot exists for a real provider");
});

/* ---------- projectFor: guest snapshot (regression: must not crash pre-deal) ---------- */

test("projectFor is null-safe when seats aren't dealt yet (H9 regression)", () => {
  // simulate the instant between match start and the first deal: hands undefined
  T.G.seats.forEach((s, i) => { s.control = i === 0 ? "local" : "ai"; s.hand = undefined; s.melds = undefined; s.flowers = undefined; s.drawn = undefined; });
  T.G.river = undefined; T.G.wall = undefined; T.G.dealer = 0; T.G.activeSeat = null;
  T.G.lastDiscard = null; T.G.handNumber = 1; T.G.wildKind = null;
  let snap;
  // must not throw
  snap = T.projectFor(1);
  ok(snap && snap.seats.length === 4, "produces a 4-seat snapshot");
  eq(snap.wallLen, 0, "undefined wall → 0");
  ok(Array.isArray(snap.river), "undefined river → []");
});

test("projectFor hides other players' hands, shows the viewer's own", () => {
  T.G.seats.forEach((s, i) => { s.control = i === 0 ? "local" : "ai"; s.hand = [0, 1, 2]; s.melds = []; s.flowers = []; s.drawn = null; });
  T.G.river = []; T.G.wall = new Array(50); T.G.dealer = 0; T.G.activeSeat = 0;
  T.G.lastDiscard = null; T.G.handNumber = 1; T.G.wildKind = 4;
  const snap = T.projectFor(2);                 // seat 2 is the viewer
  eq(snap.seats[0].hand, [0, 1, 2], "viewer sees own tiles");
  eq(snap.seats[1].hand, [null, null, null], "others hidden as face-down count");
  eq(snap.wallLen, 50);
});
