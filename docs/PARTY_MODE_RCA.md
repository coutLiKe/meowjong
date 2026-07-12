# Party Mode — Root Cause Analysis & Recovery Options

**Status: ANALYSIS FOR REVIEW — no code changes proposed yet, 2026-07-12.**
Scope: why Party Mode stopped connecting for some players, what actually changed,
and how to restore the original zero-setup experience without asking players to
create a TURN account. Recommendation at the end; nothing is implemented.

---

## 0 · TL;DR

- Party Mode's connection stack is **unchanged**. No code, architecture, or
  dependency *we* wrote introduced a TURN requirement.
- The original "it just works" experience was quietly powered by **PeerJS's free,
  bundled public TURN relay** (`eu-0/us-0.turn.peerjs.com`, shipped as the PeerJS
  library's default ICE config). Nobody had to set it up — it came for free.
- **PeerJS decommissioned that relay.** The whole `turn.peerjs.com` subdomain is now
  `NXDOMAIN` (doesn't resolve at all), while their *signaling* server stays up. So
  finding rooms still works, but players who need a relay can no longer get one.
- This is **infrastructure/economic rot**, not a regression in our code: STUN is
  ~free to give away forever, TURN relays real bandwidth and costs money, so free
  public TURN periodically dies. Ours died.
- **Restoring zero-setup is feasible** without a per-user account: a no-account
  public TURN (Metered's static endpoint) is still offered today, on top of a
  rock-solid STUN floor. It re-inherits the same fragility, so the recommendation
  pairs it with a stable floor + the in-game 🧪 tester + a trivial swap path.
- The only *permanently* reliable, zero-user-setup answer is a relay **we** run
  (self-hosted TURN) — which costs a few $/mo and breaks the "zero server" ethos.
  Offered as an optional future upgrade, not a requirement.

---

## 1 · How Party Mode actually connects (three independent layers)

Party Mode is serverless peer-to-peer over WebRTC, brokered by PeerJS. A join
succeeds only if **all three** layers below succeed:

| Layer | What it does | Provider | Setup | Can it fail? |
|---|---|---|---|---|
| **Signaling** | Find the host by room code; swap connection offers | PeerJS cloud (`0.peerjs.com`) | none | Rarely — still healthy |
| **STUN** | Discover each player's public IP:port so they can try a **direct** link | Google / Twilio / Cloudflare | none | Only on unusual networks |
| **TURN** | **Relay** traffic when a direct link is impossible (symmetric NAT, strict firewall) | *was* PeerJS free TURN | none | **This is what broke** |

The critical fact: **STUN and TURN solve different problems.** STUN lets two peers
find each other and connect *directly*. But when a player is behind a **symmetric
NAT** (most cellular/CGNAT networks, many corporate/hotel networks, some home
routers), STUN is not enough — the only way through is to **relay** the traffic
through a TURN server. That is a property of how NAT and WebRTC work; no cleverness
in our code can defeat a symmetric NAT without a relay.

So Party Mode has *always* needed TURN for the "hard NAT" subset of players. It was
invisible because the relay came free with PeerJS.

## 2 · Root cause (verified)

**PeerJS shut down its free public TURN relay.** Evidence gathered 2026-07-12:

- `dig eu-0.turn.peerjs.com` → **NXDOMAIN**. Same for `us-0.turn.peerjs.com` and the
  parent `turn.peerjs.com`. The hostnames are gone entirely — a deliberate
  decommission, not an outage.
- `dig peerjs.com` and `0.peerjs.com` → **still resolve.** The *signaling* service is
  alive. This is exactly why hosting/finding a room still works but relaying fails.
- The vendored PeerJS library (`js/vendor/peerjs.min.js`) ships those dead TURN
  hosts as its **default** ICE config:
  `iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:["turn:eu-0.turn.peerjs.com:3478","turn:us-0.turn.peerjs.com:3478"]…]`
- The **latest** upstream PeerJS (1.5.5) *still ships the same dead hosts* — so
  upgrading the library does not help; upstream hasn't replaced them.
- Symptom match: a player who needs a relay gets no relay candidate, ICE fails, and
  after the 12 s connect timeout they see **"Couldn't connect to the host"** — the
  exact report.

**Why it "worked perfectly fine before":** before, the PeerJS default TURN was
**alive**, so hard-NAT players relayed through it transparently. When PeerJS turned
it off, those same players stopped connecting — with **no change on our side**.

## 3 · What did *not* cause it (ruled out)

- **The networking architecture** — unchanged. PeerJS signaling + WebRTC P2P +
  STUN + TURN-fallback is the same design it always was. It did not "introduce" a
  TURN dependency; TURN was always the symmetric-NAT fallback.
- **The emote work (PR #6)** — added message handlers (`{t:"emote"}`), never touched
  the connection/ICE path.
- **PR #7 "Fix party room join reliability"** — made the *already-default* PeerJS
  TURN hosts explicit and added reconnect/normalize/timeout handling. It copied the
  same hosts the library already used, so it changed nothing about relay
  availability. (It did make the 12 s timeout *destructive* — it now tears the
  attempt down — but a relay-less symmetric-NAT pair would never have connected
  anyway.)
- **The stale-cache issue** (fixed earlier, p21→p22) was a *separate*, real problem
  that delayed PR #7's code from reaching returning players. It's resolved and is not
  this root cause.

## 4 · The deeper "why" — the economics of STUN vs TURN

This matters for choosing a durable fix:

- **STUN** just tells a peer "here's how the internet sees you." It carries no user
  traffic — negligible cost — so Google/Cloudflare give it away permanently. Free
  STUN is stable and will not vanish.
- **TURN** *relays every byte* of the game session through the provider's server.
  That is real, ongoing bandwidth cost. So free public TURN is economically
  unsustainable and is periodically shut down or moved behind accounts (numb,
  freeturn, and now PeerJS have all gone dark; Metered kept its infra but nudges
  users toward API keys).

**The original seamlessness was a subsidy** — PeerJS paying for relay bandwidth on
everyone's behalf. The subsidy ended. Any "free, zero-setup, permanent" relay is
fighting this economic gravity, which is why the durable answer eventually points at
a relay *we* control.

## 5 · Does our architecture *require* TURN? (direct answer)

**No — not for most players; yes — for the hard-NAT minority, unavoidably.**

- Non-symmetric NAT (typical home Wi-Fi): connects **directly via STUN**, no relay.
- Symmetric NAT / CGNAT / strict firewall (much cellular, many corporate/hotel/school
  networks): **cannot** be traversed without a relay. This is inherent to browser
  WebRTC, not to our code. No STUN configuration, ICE tuning, or protocol trick
  changes it.

So "avoid TURN entirely" is only possible if we accept that the hard-NAT subset
can't play. The question is not *whether* to have a relay, but *who provides it* and
*whether players must set anything up*.

## 6 · Solution options

Every option below keeps **players' setup at zero** (the user's hard constraint).
They differ in who provides the relay and how durable it is.

### A · STUN-only (current shipped state)
Rely on STUN alone; no TURN at all.
- **Pros:** zero setup, zero cost, permanently stable (Google/Cloudflare STUN never
  rot), no fragile dependency. Connects the majority of home-network pairs.
- **Cons:** hard-fails symmetric NAT / CGNAT / strict networks — the exact players
  who broke stay broken. A partial restoration.
- **Complexity:** none (already done).
- **UX:** seamless when it works; a clear "couldn't connect" + 🧪 tester when it
  doesn't.

### B · Re-add a no-account public TURN (Metered static endpoint) on top of STUN  ⟵ closest to the original
Point at a currently-offered free TURN that needs **no account** (Metered's
`staticauth.openrelay.metered.ca`, static creds `openrelayproject` /
`openrelayprojectsecret`), with STUN as the floor.
- **Pros:** **restores the original zero-setup experience** — players set up nothing,
  hard-NAT pairs get relayed again. Tiny change (swap hostnames into the existing
  `PARTY_TURN_SERVERS` slot).
- **Cons:** re-inherits the fragility that just bit us — a free shared relay can be
  rate-limited, congested, or shut down / gated at any time (Metered already lists
  the static endpoint as "secondary"). **Not yet verified to grant allocations**
  from a real network (my sandbox blocks UDP; needs a real-device test).
- **Complexity:** trivial config; plus real-network verification.
- **UX:** seamless for most, best-effort for hard NAT — until/unless the free relay
  rots again, at which point the 🧪 tester makes it diagnosable in seconds and the
  fix is a one-line swap.

### C · Self-hosted TURN (coturn) that *you* run — players still zero-setup
Stand up a small coturn on a cheap VPS; bake its address + credentials into the app.
- **Pros:** players set up nothing **and** it's reliable and permanent because *we*
  control it. The only option that is both zero-user-setup and rot-proof.
- **Cons:** ~$3–5/mo VPS + operational work (coturn config, a TLS cert for
  `turns:` on 443 to punch through firewalls, credential rotation). Breaks the
  project's celebrated "zero build, zero server" identity and adds a bill.
- **Complexity:** moderate one-time setup; small ongoing ops.
- **UX:** seamless and durable for everyone.

### D · Relay through our own backend
Add a server that proxies game traffic.
- **Pros:** full control.
- **Cons:** there is **no backend today** (static GitHub Pages). This is a large
  re-architecture, ongoing cost, and abandons the serverless design. Strictly worse
  than C for this goal.
- **Complexity:** high. **Rejected.**

### E · Squeeze more out of STUN / ICE (no relay)
More STUN servers, TCP/TLS candidates, longer gathering, `iceCandidatePoolSize`.
- **Pros:** free, zero setup; marginally improves success on borderline networks.
- **Cons:** **cannot** beat symmetric NAT — a physics/protocol limit. Closes none of
  the real gap on its own.
- **Complexity:** low. Useful as a *complement*, never a solution.

### Options at a glance

| Option | Player setup | Covers hard NAT | Durable | Cost | Complexity | Fidelity to original |
|---|---|---|---|---|---|---|
| A · STUN-only | none | ❌ | ✅ | $0 | none | partial |
| **B · no-account public TURN** | **none** | **✅\*** | **⚠️ fragile** | **$0** | **trivial** | **high** |
| C · self-hosted TURN | none | ✅ | ✅ | ~$5/mo | moderate | high + durable |
| D · backend relay | none | ✅ | ✅ | $$ | high | (over-built) |
| E · better STUN/ICE | none | ❌ | ✅ | $0 | low | complement only |

\* *contingent on the free relay being up and honoring anonymous credentials.*

## 7 · Recommendation

**Layer B on top of A, keep E as polish, and hold C as the documented "make it
bulletproof" upgrade.** Concretely, the recommended design (for approval before any
code):

1. **Stable floor — STUN-only always works (Option A + E).** Keep the solid STUN set
   (Google + Cloudflare) so the common case never depends on anything that can rot.
2. **Recover the hard-NAT coverage with a no-account public TURN (Option B).**
   Re-add Metered's static endpoint (no account, matching the original's zero-setup
   spirit) as the relay fallback — **after** verifying from a real network that it
   still grants allocations. Optionally list 2–3 no-account relays so one dying
   doesn't kill relaying.
3. **Make the next rot a 10-second diagnosis, not a mystery.** Ship the 🧪 "Test my
   connection" panel (already built) so any player sees which layer works; when a
   free relay dies again, it's visible immediately and the fix is a one-line swap.
4. **Document Option C as the optional durability upgrade.** If you ever want Party
   Mode to be bulletproof for *everyone* regardless of free-relay availability, a
   self-hosted coturn is the answer — players still set up nothing; you run one small
   box. Not required now.

**Why this best fits the original vision:** it keeps **player setup at zero** (no
accounts — the hard constraint), restores the **seamless, everyone-can-connect**
experience to the extent free relay is available, and — unlike the original — fails
*gracefully and legibly* instead of with a dead-end error, because the STUN floor +
tester mean a future relay shutdown degrades to "most people still connect, and we
can see why the rest can't" rather than a silent break. It also tells the honest
truth in the code and README: free public TURN is borrowed, not owned, and the only
way to never depend on someone else's charity is Option C.

## 8 · Honest open items before implementing

- **Verify Option B from a real network.** Metered's docs say the static anonymous
  endpoint still exists, but my environment can't confirm it actually relays (UDP
  blocked). Needs a real-device test (the 🧪 tester on a phone/laptop, or a WebRTC
  trickle-ICE check) before we rely on it.
- **Decide on the durability question.** Are we content with best-effort free relay
  (B, may recur), or do we want to invest in the self-hosted path (C) for a
  permanent guarantee? This is the one real decision for you.
- **Confirm the constraint reading.** "No TURN account" is taken as *players* create
  no accounts. Option B honors that with anonymous creds; Option C honors it by you
  running the relay. If the intent is also "*we* set up nothing, ever," then only
  A/E qualify and we accept the hard-NAT gap — worth confirming.
