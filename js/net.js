"use strict";
/* ============================================================
   Meowjong — party mode (peer-to-peer via PeerJS)

   The HOST runs the real game engine. Guests are thin clients:
   they receive personalized state snapshots (rotated so they sit
   at the bottom, other hands hidden) and send back their choices.
   Empty seats are filled with AI cats; if a guest disconnects,
   a cat takes over their seat.

   Messages  host → guest: state, prompt, log, coach, modal, modalClose, start, kicked,
                           emote {seat, id}   (seat pre-rotated for the recipient)
             guest → host: hello {name}, action {choice}, emote {id}
   ============================================================ */

const NET = {
  role: null,          // null | 'host' | 'guest'
  started: false,      // host: game running with guests
  peer: null,
  code: null,
  guests: [],          // host: [{conn, name, seat|null}]
  conn: null,          // guest: connection to host
  pending: {},         // host: seat → resolve fn for outstanding prompt
  myName: "",
  hb: null,            // heartbeat interval id
  lastHostSeen: 0,     // guest: timestamp of last message from host
};

const HB_INTERVAL_MS = 7000;    // ping cadence
const HB_TIMEOUT_MS = 22000;    // no traffic for this long ⇒ peer is gone
const PROMPT_TIMEOUT_MS = 60000; // a live-but-AFK guest yields to the cat after this
const PARTY_CONNECT_TIMEOUT_MS = 12000;

/* TURN relay servers — a relay is what bridges the "hard" networks (strict
   NAT, VPN, cellular/CGNAT, hotel/corporate Wi-Fi) that STUN alone can't
   traverse. Most home networks connect directly via STUN and never touch a
   relay; the players who see "Couldn't connect to the host" are the ones who
   need one.

   History: party mode used to rely on PeerJS's bundled free relay
   (eu-0/us-0.turn.peerjs.com). PeerJS decommissioned it — the hostnames are
   now NXDOMAIN — which is what broke strict-network joins. The old no-account
   public relays (openrelay.metered.ca, etc.) are dead too, so there is no
   longer a "free, zero-signup" relay to point at.

   The fix: a Metered (metered.ca) free account. One-time signup for the *host
   maintainer only* (players still set up nothing); the free tier is ~20 GB/mo
   of relay traffic, which is enormous for text-sized mahjong moves. Paste the
   two credential strings from the Metered dashboard into METERED_TURN below.
   We list several transports so at least one gets through: UDP/TCP 80, TCP
   443, and TLS 443 (443/TCP+TLS is what punches through locked-down
   corporate/hotel firewalls that only allow "web" traffic).

   If you'd rather never depend on someone else's free tier, run your own TURN
   (coturn on a ~$5/mo VPS) and replace PARTY_TURN_SERVERS with its address +
   credentials in the same {urls, username, credential} shape. */
const METERED_TURN = {
  // ↓↓↓ Paste from the Metered dashboard (dashboard.metered.ca → TURN Server).
  // Leave blank to ship STUN-only (no relay); the 🧪 test will say so.
  username: "",
  credential: "",
};

const PARTY_TURN_SERVERS = (METERED_TURN.username && METERED_TURN.credential)
  ? [
      { urls: "turn:global.relay.metered.ca:80",
        username: METERED_TURN.username, credential: METERED_TURN.credential },
      { urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: METERED_TURN.username, credential: METERED_TURN.credential },
      { urls: "turn:global.relay.metered.ca:443",
        username: METERED_TURN.username, credential: METERED_TURN.credential },
      { urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: METERED_TURN.username, credential: METERED_TURN.credential },
    ]
  : [];

const PARTY_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const PARTY_PEER_OPTIONS = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  key: "peerjs",
  secure: true,
  config: {
    iceServers: PARTY_STUN_SERVERS.concat(PARTY_TURN_SERVERS),
    sdpSemantics: "unified-plan",
    iceCandidatePoolSize: 4,
  },
};

function partyPeerOptions() {
  return JSON.parse(JSON.stringify(PARTY_PEER_OPTIONS));
}

function stopHeartbeat() { if (NET.hb) { clearInterval(NET.hb); NET.hb = null; } }
function destroyPeerQuietly() { try { if (NET.peer) NET.peer.destroy(); } catch (e) {} NET.peer = null; NET.conn = null; }

function startHostHeartbeat() {
  stopHeartbeat();
  NET.hb = setInterval(() => {
    const now = Date.now();
    for (const g of NET.guests.slice()) {
      if (g.lastSeen && now - g.lastSeen > HB_TIMEOUT_MS) { hostOnGuestGone(g.conn); continue; }
      try { g.conn.send({ t: "ping" }); } catch (e) {}
    }
  }, HB_INTERVAL_MS);
}

function startGuestHeartbeat() {
  stopHeartbeat();
  NET.lastHostSeen = Date.now();
  NET.hb = setInterval(() => {
    if (Date.now() - NET.lastHostSeen > HB_TIMEOUT_MS) netShutdown("Lost the connection to the host (timed out).");
  }, HB_INTERVAL_MS);
}

/* Guest-side allowlist: escape everything, then restore only the exact
   formatting tags that log/coach legitimately use. Kills any injected markup. */
function sanitizeMarkup(html) {
  return escapeHtml(String(html == null ? "" : html))
    .replace(/&lt;(\/?)(b|i|br)&gt;/g, "<$1$2>")
    .replace(/&lt;span class=&quot;log-dim&quot;&gt;/g, '<span class="log-dim">')
    .replace(/&lt;\/span&gt;/g, "</span>");
}

const GUEST_EMOJIS = ["🧑", "👤", "🧑‍🦰", "🧑‍🦱"];
const AI_CATS = [
  { name: "Mochi", emoji: "🐈" },
  { name: "Biscuit", emoji: "🐈‍⬛" },
  { name: "Captain Whiskers", emoji: "🐯" },
];

function isPartyMode() { return (NET.role === "host" && NET.started) || NET.role === "guest"; }

function randomCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function normalizePartyCode(raw) {
  return String(raw == null ? "" : raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function peerId(code) { return "meowjong-room-" + normalizePartyCode(code); }

/* ---------- Party modal (host or join) ---------- */

function netOpenPartyModal() {
  if (NET.role === "guest") {
    showModal(`<h2>🎉 Party</h2><p>You're connected to room <b>${NET.code}</b> as <b>${NET.myName}</b>.</p>
               <p>To leave, just close or reload this page.</p>`, [{ label: "OK", cls: "primary", cb: hideModal }]);
    return;
  }
  if (NET.role === "host") { renderLobby(); return; }
  showModal(`
    <h2>🎉 Party mode</h2>
    <p>Play real mahjong with up to 3 friends over the internet. One of you <b>hosts</b> and
    shares the 4-letter room code; the others <b>join</b> with it. Any empty seats are filled
    by the café cats. <span class="log-dim">(Uses a free peer-to-peer connection service —
    needs internet.)</span></p>
    <p class="party-trust">🔒 <b>Play with people you trust:</b> the host's device runs the
    game, so it technically holds everyone's tiles. This is a friendly game for friends — there's
    no cheat protection against a determined host.</p>
    <p><label>Your name: <input id="party-name" maxlength="14" placeholder="e.g. Kevin" class="party-input"></label></p>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
      <button class="action-btn primary" id="party-host-btn">🏠 Host a party</button>
      <span style="align-self:center">or</span>
      <input id="party-code" maxlength="4" placeholder="CODE" class="party-input code">
      <button class="action-btn" id="party-join-btn">🚪 Join with code</button>
    </div>
    <p id="party-status" class="log-dim"></p>
    <p style="margin-top:10px"><button class="action-btn secondary" id="party-test-btn">🧪 Test my connection</button>
    <span class="log-dim">— checks what your network supports before you invite anyone</span></p>
    <div id="party-test-out" class="log-dim"></div>`,
    [{ label: "Cancel", cls: "secondary", cb: hideModal }]);
  $("#party-host-btn").addEventListener("click", () => startHosting());
  $("#party-test-btn").addEventListener("click", () => netConnectionTest());
  $("#party-join-btn").addEventListener("click", () => {
    const code = normalizePartyCode($("#party-code").value);
    if (code.length !== 4) { $("#party-status").textContent = "Enter the 4-letter room code."; return; }
    startJoining(code);
  });
}

function partyStatus(msg) {
  const el = $("#party-status");
  if (el) el.textContent = msg;
}

/* ---------- Connection self-test (🧪) ----------
   Answers "why can't we connect?" from the player's OWN network, layer by
   layer: the signaling service (finding rooms), STUN (public-address
   discovery, enough for most home networks), and the TURN relay (needed for
   strict NATs/VPNs — see PARTY_TURN_SERVERS). Pure diagnostics; changes
   nothing about how parties actually connect. */
async function netConnectionTest() {
  const out = $("#party-test-out");
  if (!out) return;
  const rows = { sig: "⏳ connection service…", stun: "⏳ public address (STUN)…", turn: "⏳ relay (TURN)…", verdict: "" };
  const paint = () => {
    out.innerHTML = "<div>" + [rows.sig, rows.stun, rows.turn].join("</div><div>") + "</div>" +
      (rows.verdict ? `<div style="margin-top:6px"><b>${rows.verdict}</b></div>` : "");
  };
  paint();

  if (!(await ensurePeerLib())) {
    rows.sig = "❌ couldn't load the multiplayer library";
    rows.verdict = "Party mode can't start from here — check your internet.";
    paint();
    return;
  }

  // 1 · signaling: open (and immediately discard) a real PeerJS session
  const sigOk = await new Promise(res => {
    let p = null;
    const t = setTimeout(() => { try { if (p) p.destroy(); } catch (e) {} res(false); }, 6000);
    try {
      p = new Peer(partyPeerOptions());
      p.on("open", () => { clearTimeout(t); try { p.destroy(); } catch (e) {} res(true); });
      p.on("error", () => { clearTimeout(t); try { p.destroy(); } catch (e) {} res(false); });
    } catch (e) { clearTimeout(t); res(false); }
  });
  rows.sig = sigOk ? "✅ connection service reachable"
                   : "❌ connection service unreachable — firewall or no internet";
  paint();

  // 2+3 · ICE: gather candidates of one type from a throwaway data channel
  const gather = (servers, wantRelay) => new Promise(res => {
    let n = 0, pc = null;
    try {
      pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: wantRelay ? "relay" : "all" });
    } catch (e) { res(0); return; }
    pc.createDataChannel("probe");
    pc.onicecandidate = e => {
      if (e.candidate && e.candidate.candidate.indexOf("typ " + (wantRelay ? "relay" : "srflx")) >= 0) n++;
    };
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
    setTimeout(() => { try { pc.close(); } catch (e) {} res(n); }, 5000);
  });

  rows.stun = (await gather(PARTY_STUN_SERVERS, false)) > 0
    ? "✅ public address found (STUN)"
    : "⚠️ no public address — this network hides you from other players";
  paint();

  if (!PARTY_TURN_SERVERS.length) {
    rows.turn = "⚠️ no relay configured — strict networks can't be bridged";
  } else {
    rows.turn = (await gather(PARTY_TURN_SERVERS, true)) > 0
      ? "✅ relay working"
      : "❌ relay configured but not answering";
  }
  paint();

  const stunOk = rows.stun.startsWith("✅"), turnOk = rows.turn.startsWith("✅");
  rows.verdict = !sigOk ? "Party mode won't work from this network."
    : turnOk ? "All good — even strict networks should connect."
    : stunOk ? "Most home networks will connect. VPN, hotel, or corporate Wi‑Fi may still fail — if it does, a phone hotspot on one side usually works."
    : "This network likely can't do peer-to-peer at all — try a phone hotspot.";
  paint();
}

/* Strip a player-supplied name to a safe set — prevents HTML/script injection
   when the name is later rendered into innerHTML sinks on host and guests. */
function sanitizeName(raw) {
  const cleaned = String(raw == null ? "" : raw).replace(/[^\w \-'.]/g, "").trim().slice(0, 14);
  return cleaned || "Player";
}

function getPartyName() {
  const el = $("#party-name");
  return sanitizeName(el && el.value);
}

/* ---------- Lazy PeerJS loader (vendored locally; off the boot critical path) ---------- */

let _peerLibPromise = null;
function ensurePeerLib() {
  if (typeof Peer !== "undefined") return Promise.resolve(true);
  if (_peerLibPromise) return _peerLibPromise;
  _peerLibPromise = new Promise(resolve => {
    const s = document.createElement("script");
    s.src = "js/vendor/peerjs.min.js";
    s.onload = () => resolve(typeof Peer !== "undefined");
    s.onerror = () => { _peerLibPromise = null; resolve(false); };
    document.head.appendChild(s);
  });
  return _peerLibPromise;
}

/* ---------- Hosting ---------- */

async function startHosting() {
  if (!(await ensurePeerLib())) { partyStatus("Couldn't load the multiplayer library — check your connection and try again."); return; }
  destroyPeerQuietly();
  NET.myName = getPartyName();
  NET.code = randomCode();
  partyStatus("Setting up the room…");
  NET.peer = new Peer(peerId(NET.code), partyPeerOptions());
  NET.peer.on("open", () => {
    NET.role = "host";
    startHostHeartbeat();
    renderLobby();
  });
  NET.peer.on("error", err => {
    if (err.type === "unavailable-id") { NET.code = randomCode(); NET.peer.destroy(); startHosting(); return; }
    partyStatus("Connection problem: " + err.type + ". Check your internet and try again.");
  });
  // The signaling socket can drop silently (laptop sleep, a wifi blip). Without
  // it the room code stops being joinable even though the lobby looks fine — so
  // reconnect automatically; PeerJS restores the same room id.
  NET.peer.on("disconnected", () => {
    if (NET.peer && !NET.peer.destroyed) { try { NET.peer.reconnect(); } catch (e) {} }
  });
  NET.peer.on("connection", conn => {
    conn.on("data", d => hostOnData(conn, d));
    conn.on("close", () => hostOnGuestGone(conn));
    conn.on("error", () => hostOnGuestGone(conn));
  });
}

function renderLobby() {
  const list = NET.guests.map((g, i) =>
    `<li>${GUEST_EMOJIS[i + 1]} <b>${escapeHtml(g.name)}</b> — connected</li>`).join("");
  const fills = 3 - NET.guests.length;
  showModal(`
    <h2>🏠 Hosting room <span class="room-code">${NET.code}</span></h2>
    <p>Share the code <b>${NET.code}</b> with your friends. They click <b>🎉 Party → Join with code</b>.</p>
    <ul class="lobby-list">
      <li>🧑 <b>${escapeHtml(NET.myName)}</b> — host (you)</li>
      ${list}
      ${fills > 0 ? `<li class="log-dim">${AI_CATS.slice(NET.guests.length).map(c => c.emoji + " " + c.name).join(", ")} will fill the empty seat${fills === 1 ? "" : "s"}</li>` : ""}
    </ul>
    <p class="log-dim">${NET.started ? "Game in progress — new joiners wait for the next match." : "Start whenever you're ready; friends can't join mid-match."}</p>`,
    [
      { label: NET.started ? "Resume game" : `Start match 🀄`, cls: "primary", cb: () => { hideModal(); if (!NET.started) hostStartGame(); } },
      { label: "Close party", cls: "secondary", cb: () => netShutdown("The host closed the party.") },
    ]);
}

function hostOnData(conn, d) {
  if (!d || typeof d !== "object") return;
  const known = NET.guests.find(g => g.conn === conn);
  if (known) known.lastSeen = Date.now();   // any message keeps a guest alive
  if (d.t === "pong" || d.t === "ping") return;
  if (d.t === "hello") {
    if (NET.started || NET.guests.length >= 3) { conn.send({ t: "kicked", why: NET.started ? "Game already in progress." : "Room is full." }); conn.close(); return; }
    NET.guests.push({ conn, name: sanitizeName(d.name), seat: null, lastSeen: Date.now() });
    renderLobby();
    conn.send({ t: "lobby", code: NET.code, names: [NET.myName].concat(NET.guests.map(g => g.name)) });
    return;
  }
  if (d.t === "action") {
    const g = NET.guests.find(g => g.conn === conn);
    if (!g || g.seat === null) return;
    const resolve = NET.pending[g.seat];
    if (resolve) { delete NET.pending[g.seat]; resolve(d.choice || { type: "pass" }); }
    return;
  }
  if (d.t === "emote") {
    // host-authoritative: unknown ids and over-limit senders are dropped silently
    const g = NET.guests.find(g => g.conn === conn);
    if (!g || g.seat === null) return;
    if (typeof d.id !== "string" || typeof EMOTES === "undefined" || !EMOTES[d.id]) return;
    if (typeof emoteRateOk !== "function" || !emoteRateOk("seat" + g.seat)) return;
    if (typeof emoteReact === "function") emoteReact(g.seat, d.id);   // logs, shows, re-broadcasts
  }
}

function hostOnGuestGone(conn) {
  const i = NET.guests.findIndex(g => g.conn === conn);
  if (i < 0) return;
  const g = NET.guests.splice(i, 1)[0];
  if (g.seat !== null && NET.started) {
    const cat = AI_CATS[(g.seat - 1) % 3];
    G.seats[g.seat].control = "ai";
    G.seats[g.seat].name = cat.name;
    G.seats[g.seat].emoji = cat.emoji;
    log(`⚠️ <b>${escapeHtml(g.name)} disconnected</b> — ${cat.emoji} ${cat.name} takes over their seat.`, "log-important");
    const resolve = NET.pending[g.seat];
    if (resolve) { delete NET.pending[g.seat]; resolve({ type: "auto" }); }
    renderAll();
  } else if (!NET.started) {
    renderLobby();
  }
}

function hostStartGame() {
  NET.started = true;
  // Assign seats: host = 0, guests 1..n, cats fill the rest
  G.seats[0].name = NET.myName;
  G.seats[0].emoji = "🧑";
  G.seats[0].control = "local";
  for (let i = 1; i <= 3; i++) {
    const g = NET.guests[i - 1];
    const base = { score: 500, hand: [], melds: [], drawn: null, wind: i, threatWarned: false };
    if (g) {
      g.seat = i;
      G.seats[i] = Object.assign(base, { name: g.name, emoji: GUEST_EMOJIS[i], control: "remote" });
      g.conn.send({ t: "start", seat: i });
    } else {
      const cat = AI_CATS[i - 1];
      G.seats[i] = Object.assign(base, { name: cat.name, emoji: cat.emoji, control: "ai" });
    }
  }
  applyPartyChrome();
  if (typeof hideMenu === "function") hideMenu();
  netResetStateCache();   // fresh dedup baseline for the new match/seat assignment
  log(`<b>🎉 Party match started — room ${NET.code}.</b>`, "log-important");
  newMatch();
}

/* Ask the human at a remote seat to make a choice; resolves {type:'auto'} if they vanish */
function netHostPrompt(seatIdx, prompt) {
  return new Promise(resolve => {
    const g = NET.guests.find(g => g.seat === seatIdx);
    if (!g || G.seats[seatIdx].control !== "remote") { resolve({ type: "auto" }); return; }
    let settled = false;
    const finish = val => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (NET.pending[seatIdx] === finish) delete NET.pending[seatIdx];
      resolve(val);
    };
    // A live-but-idle guest yields the decision to their cat after a timeout, so
    // one AFK player can never freeze the whole table.
    const timer = setTimeout(() => {
      try { g.conn.send({ t: "promptCancel" }); } catch (e) {}
      finish({ type: "auto" });
    }, PROMPT_TIMEOUT_MS);
    NET.pending[seatIdx] = finish;
    netFlushState();   // guarantee the guest has current state before we ask them to act
    try { g.conn.send(Object.assign({}, prompt, { t: "prompt" })); }
    catch (e) { finish({ type: "auto" }); }
  });
}

/* ---------- Host → guest broadcasting ---------- */

/* Personalized snapshot: rotated so the recipient sits at index 0, hidden hands stripped */
function projectFor(viewSeat) {
  const rot = i => (i - viewSeat + 4) % 4;
  const seats = [];
  for (let v = 0; v < 4; v++) {
    const s = G.seats[(viewSeat + v) % 4];
    const hand = s.hand || [];   // may be undefined between match start and the first deal
    seats.push({
      name: s.name, emoji: s.emoji, score: s.score, wind: s.wind,
      melds: s.melds || [], flowers: s.flowers || [], control: v === 0 ? "local" : "ai",
      hand: v === 0 ? hand : new Array(hand.length).fill(null),
      drawn: v === 0 ? (s.drawn == null ? null : s.drawn) : null,
    });
  }
  return {
    seats,
    river: (G.river || []).map(d => ({ kind: d.kind, seat: rot(d.seat) })),
    dealer: rot(G.dealer),
    activeSeat: G.activeSeat === null ? null : rot(G.activeSeat),
    wallLen: (G.wall && G.wall.length) || 0,
    handNumber: G.handNumber,
    lastDiscard: G.lastDiscard ? { kind: G.lastDiscard.kind, seat: rot(G.lastDiscard.seat) } : null,
    wildKind: G.wildKind,
    wildFlip: G.wildFlip,
    deadFlips: G.deadFlips,
  };
}

/* ---------- Coalesced, deduplicated state broadcast (H9) ----------
   renderAll() fires 4–8× per turn; instead of sending a full snapshot each
   time, we coalesce a synchronous burst into a single microtask flush and skip
   guests whose snapshot is byte-identical to the last one they received.
   Any host→guest EVENT (prompt/log/modal) flushes first, so a guest never
   sees an event before the state it refers to. */
let _netFlushQueued = false;
const _netLastSnap = {};   // seat → last JSON sent (dedup)

function netAfterRender() {
  if (NET.role !== "host" || !NET.started) return;
  if (_netFlushQueued) return;
  _netFlushQueued = true;
  Promise.resolve().then(netFlushState);
}

function netFlushState() {
  _netFlushQueued = false;
  if (NET.role !== "host" || !NET.started) return;
  for (const g of NET.guests) {
    if (g.seat === null) continue;
    const proj = projectFor(g.seat);
    const key = JSON.stringify(proj);
    if (_netLastSnap[g.seat] === key) continue;   // unchanged — don't resend
    _netLastSnap[g.seat] = key;
    try { g.conn.send({ t: "state", g: proj }); } catch (e) { /* dropped */ }
  }
}

function netResetStateCache() { for (const k in _netLastSnap) delete _netLastSnap[k]; }

function netBroadcastLog(msg, cls) {
  if (NET.role !== "host" || !NET.started) return;
  netFlushState();   // state before the event that describes it
  for (const g of NET.guests) {
    if (g.seat !== null) { try { g.conn.send({ t: "log", msg, cls }); } catch (e) {} }
  }
}

function netSendTo(seatIdx, payload) {
  if (NET.role !== "host") return;
  netFlushState();
  const g = NET.guests.find(g => g.seat === seatIdx);
  if (g) { try { g.conn.send(payload); } catch (e) {} }
}

/* Send structured end-of-hand data (never raw HTML) so guests render it with
   their own trusted code — closes the host→guest injection channel. */
function netBroadcastEndModal(dataForSeat) {
  if (NET.role !== "host" || !NET.started) return;
  netFlushState();
  for (const g of NET.guests) {
    if (g.seat !== null) { try { g.conn.send({ t: "modal", data: dataForSeat(g.seat) }); } catch (e) {} }
  }
}

/* Emote visual to every guest, seat pre-rotated into their view (their own
   seat is index 0, matching how projectFor rotates snapshots). */
function netBroadcastEmote(seat, id) {
  if (NET.role !== "host" || !NET.started) return;
  for (const g of NET.guests) {
    if (g.seat === null) continue;
    try { g.conn.send({ t: "emote", seat: (seat - g.seat + 4) % 4, id }); } catch (e) {}
  }
}

function netBroadcastPromptCancel() {
  if (NET.role !== "host" || !NET.started) return;
  for (const g of NET.guests) {
    if (g.seat !== null) { try { g.conn.send({ t: "promptCancel" }); } catch (e) {} }
  }
}

function netCloseModals() {
  if (NET.role !== "host" || !NET.started) return;
  for (const g of NET.guests) {
    if (g.seat !== null) { try { g.conn.send({ t: "modalClose" }); } catch (e) {} }
  }
}

/* ---------- Joining (guest side) ---------- */

async function startJoining(code) {
  if (!(await ensurePeerLib())) { partyStatus("Couldn't load the multiplayer library — check your connection and try again."); return; }
  destroyPeerQuietly();
  NET.myName = getPartyName();
  code = normalizePartyCode(code);
  if (code.length !== 4) { partyStatus("Enter the 4-letter room code."); return; }
  partyStatus("Connecting to room " + code + "…");
  NET.peer = new Peer(partyPeerOptions());
  // Typed failure messages, so "can't connect" tells you WHICH link is broken:
  // the room lookup (code/host problem) vs. the network path (NAT/firewall).
  NET.peer.on("error", err => {
    const t = (err && err.type) || "unknown";
    if (t === "peer-unavailable") {
      partyStatus("Room " + code + " wasn't found — double-check the 4-letter code, and make sure the host still has the lobby open (if their laptop slept, ask them to re-host).");
    } else if (t === "network") {
      partyStatus("Couldn't reach the connection service — check your internet and try again.");
    } else {
      partyStatus("Couldn't reach the room (" + t + "). Check the code and your internet.");
    }
  });
  NET.peer.on("disconnected", () => {
    if (NET.peer && !NET.peer.destroyed) { try { NET.peer.reconnect(); } catch (e) {} }
  });
  NET.peer.on("open", () => {
    const conn = NET.peer.connect(peerId(code), { reliable: true });
    NET.conn = conn;
    let opened = false;
    let timedOut = false;
    conn.on("open", () => {
      if (timedOut) return;
      opened = true;
      conn.send({ t: "hello", name: NET.myName });
      partyStatus("Connected! Waiting in the lobby — the host starts the match.");
      NET.role = "guest";
      NET.code = code;
      startGuestHeartbeat();
    });
    conn.on("data", d => guestOnData(d));
    conn.on("close", () => {
      if (timedOut) return;
      if (opened && NET.role === "guest") netShutdown("Lost the connection to the host.");
      else partyStatus("The room closed the connection.");
    });
    setTimeout(() => {
      if (opened) return;
      timedOut = true;
      try { conn.close(); } catch (e) {}
      if (NET.role !== "guest") destroyPeerQuietly();
      partyStatus("Couldn't connect to the host. The room exists, but no network route could be built between you two — run 🧪 Test my connection (both of you) to see why, and try switching one player off VPN/corporate Wi‑Fi or onto a phone hotspot.");
    }, PARTY_CONNECT_TIMEOUT_MS);
  });
}

function guestOnData(d) {
  if (!d || typeof d !== "object") return;
  NET.lastHostSeen = Date.now();   // any message proves the host is alive
  switch (d.t) {
    case "ping":
      try { NET.conn.send({ t: "pong" }); } catch (e) {}
      break;
    case "promptCancel":
      if (typeof clearLocalPrompt === "function") clearLocalPrompt();
      break;
    case "lobby":
      showModal(`<h2>🚪 In the lobby — room ${escapeHtml(d.code)}</h2>
        <p>Players so far: ${d.names.map(escapeHtml).join(", ")}</p>
        <p><i>Waiting for the host to start the match…</i></p>`,
        [{ label: "Leave", cls: "secondary", cb: () => netShutdown("You left the room.") }]);
      break;
    case "kicked":
      netShutdown("Couldn't join: " + d.why);
      break;
    case "start":
      guestEnterGame();
      break;
    case "state":
      guestApplySnapshot(d.g);
      break;
    case "prompt":
      guestHandlePrompt(d);
      break;
    case "log":
      log(sanitizeMarkup(d.msg), typeof d.cls === "string" ? d.cls.replace(/[^\w -]/g, "") : "", true);
      break;
    case "coach":
      if (G.autoCoach) coachSay(sanitizeMarkup(d.msg), typeof d.mood === "string" ? d.mood.slice(0, 4) : "🐱");
      break;
    case "modal":
      // structured end-of-hand data only — never raw host HTML
      // (showEndModal = showModal + the staged win ceremony)
      showEndModal(endModalHtml(d.data) + "<p><i>Waiting for the host to start the next hand…</i></p>", []);
      break;
    case "modalClose":
      hideModal();
      break;
    case "emote":
      // visual + sound only — the narration arrives on the log channel
      if (typeof d.id === "string" && typeof EMOTES !== "undefined" && EMOTES[d.id] &&
          Number.isInteger(d.seat) && d.seat >= 0 && d.seat <= 3 &&
          typeof emoteShow === "function") {
        emoteShow(d.seat, d.id);
      }
      break;
  }
}

function guestEnterGame() {
  G.gen++;                  // kill any local single-player loop
  G.awaitingDiscard = false;
  G.turnCtx = null;
  G.choiceSink = null;
  G.selectedIdx = null;
  G.suggestKind = null;
  NET.started = true;
  hideModal();
  applyPartyChrome();
  if (typeof hideMenu === "function") hideMenu();
  clearActions();
  setPrompt("");
  log(`<b>🎉 Party match started! You're playing in room ${NET.code}.</b>`, "log-important", true);
  coachSay("Good luck! I'm still here — hit <b>Hint</b> on your turn any time. 🐱", "🎓");
}

function guestApplySnapshot(snap) {
  G.seats = snap.seats;
  G.river = snap.river;
  G.dealer = snap.dealer;
  G.activeSeat = snap.activeSeat;
  G.wall = { length: snap.wallLen };
  G.handNumber = snap.handNumber;
  G.lastDiscard = snap.lastDiscard;
  G.wildKind = snap.wildKind;
  G.wildFlip = snap.wildFlip;
  G.deadFlips = snap.deadFlips || [];
  G.peek = false;
  renderOpponents();
  renderRiver();
  renderStatus();
  renderHand();
}

function guestHandlePrompt(p) {
  const send = choice => { try { NET.conn.send({ t: "action", choice }); } catch (e) {} };
  if (p.kind === "turn") {
    beginTurnPrompt(p.ctx, send);
  } else if (p.kind === "claim") {
    claimPromptUI(p.opts, p.tile, p.discarderLabel, send);
  }
}

/* ---------- Shared chrome / teardown ---------- */

function applyPartyChrome() {
  $("#btn-party").innerHTML = `<span class="ico">${icon("users")}</span>Room ${NET.code}`;
  $("#toggle-peek").checked = false;
  G.peek = false;
  $("#toggle-peek").closest("label").style.display = "none"; // fairness: no peeking at humans
  $("#btn-menu").style.display = "none"; // leaving mid-party = closing the page
  if (NET.role === "guest") $("#btn-newhand").style.display = "none";
}

function netShutdown(reason) {
  // Resolve any outstanding host prompts so no coroutine is left awaiting a
  // guest that's now gone, then tear down. A reload gives everyone a clean
  // single-player state; it's user-triggered (no surprise auto-reload while
  // the player is still reading the message).
  stopHeartbeat();
  try { for (const k in NET.pending) { const r = NET.pending[k]; delete NET.pending[k]; r({ type: "auto" }); } } catch (e) {}
  destroyPeerQuietly();
  NET.role = null; NET.started = false;
  NET.guests = []; NET.pending = {}; NET.code = null;
  showModal(`<h2>🎉 Party over</h2><p>${escapeHtml(reason)}</p><p>Reload to return to single-player vs the café cats.</p>`,
    [{ label: "Back to single-player", cls: "primary", cb: () => location.reload() }]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
