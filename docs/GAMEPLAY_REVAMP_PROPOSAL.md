# Meowjong — Gameplay Revamp Proposal

**Status: APPROVED & IMPLEMENTED (core slice M0–M5 + win celebration), 2026-07-07.**
Shipped: M0 motion foundation (Full/Subtle/Off + reduced-motion), **M1 persistent keyed
tile renderer with FLIP** (`renderHand`/`renderRiver` reconcile instead of rebuilding;
SVG faces cached; click delegation), M2 living hand (hover lift + cursor tilt, idle
breathing, select/suggest states), M3 choreography (your discards FLY hand→river via
ghost flights from real exit positions; opponents' discards travel from their panels;
claimed tiles gather river→meld; landing squash), M4 pseudo-3D felt table (wood bevel,
lamp light, depth-by-role), M5 camera pulses, and the win shake/glow/confetti.
Verified: 64/64 tests, 13/13 hand nodes persist across a discard, guest/host render
parity, all three effect levels + reduced-motion, zero console errors.
**M6 HUD overhaul shipped 2026-07-07** (approved variant): top HUD bar with round/hand
+ depleting wall bar + Tutorial/Strategy/Peek/Labels tabs; three-sided seat chips
(seat 3 left, 2 across, 1 right) carrying melds/flowers; square felt table centered;
your hand + action dock docked at the bottom; narrated log as a bottom strip; Professor
Paws as a floating, collapsible advisor card bottom-right. All element IDs preserved —
engine/netcode/coach logic untouched. Verified: 64/64 tests, headless boot with zero
runtime errors.
**M7 true-3D table shipped 2026-07-08** (chosen from three interactive concept drafts in
`drafts/3d-drafts.html`: A lean-in table / B full diorama / C parallax depth — approved
direction was **A + B's wall**). "Full 3D" is now a real tilted-table scene: perspective
camera on `#table` (12° rotateX), warm room backdrop behind the floating felt, physical
tile thickness on every tile size/state (extrusion shadows composed with the gold/selected/
suggest/last-discard glows), standing opponent racks, depth-by-role seat `translateZ` with
the active seat stepping forward, and a depleting face-down wall row on the felt
(`renderWallRow` in ui.js, ~22 minis scaled to the real `G.wall.length`, host & guest).
**Per user feedback, cursor-follow parallax was explicitly rejected — the board never
moves with the mouse.** Subtle/Off levels, reduced-motion, and ≤900px screens keep the
flat board (scene + wall flatten via CSS only). Verified: 64/64 tests, live solo hand
with discards/claims/flights under the tilt, zero console errors, no mobile overflow.
**M7.1 HUD declutter + proportions shipped 2026-07-08** (user feedback: top bar too busy,
layout didn't match the approved draft). The four learning/visual controls (Peek, Labels,
Coach, FX level) moved off the bar into an ⚙ **Options** popover (`#hud-settings`, a
`<details>` dropdown; closes on outside click; all control IDs unchanged so net.js's
party-mode Peek hiding still works). Bar is now: brand · Hand · Wall · Tutorial · Strategy
· Options · Party · Re-deal · Menu. Proportions matched to the draft: felt widened to
1.25:1 (was square), side seat columns slimmed to 130–175px, seat cards tightened with the
static "sits across the table"-style sub-lines moved to tooltips, gold marker shrunk to a
compact chip, layout max-width 1240px. On ≤900px the popover anchors left to stay
on-screen. Verified: 64/64 tests, live hand at 1360×850 + mobile 375px, popover
open/toggle/outside-close, zero console errors.
**M7.2 seat & hand-area unification shipped 2026-07-08** (user feedback: seat "boards"
had inconsistent proportions and the overall UI felt disjointed). The white card boxes
are gone. Every seat now shares ONE visual language: a compact name·wind·score pill +
a centered rack + flowers/melds, transparent against the scene, symmetric left/right and
vertically centered on the felt. The across seat lays its pill/rack/flowers/melds out
horizontally so the top strip keeps a stable shallow height as their hand evolves. Your
area matches: a "You" pill on the table's center axis (active-turn ring moves to the
pills), the hand fanned beneath, prompt + action buttons centered under it; the inline
turn-order line became a tooltip on the You pill. Felt sized (60vh cap) so HUD → board →
hand → actions all fit one ~850px viewport with zero scrolling mid-claim. Verified:
64/64 tests, live hand with discards/claims, dock on-screen in populated late-game
states, mobile 375px clean, zero console errors.
**M7.3 four-sided table seating shipped 2026-07-08** (user feedback: seats' proportions
still inconsistent — only your hand and the across player lined up with the board). The
side players now sit AT the table like the draft: their racks run **vertically along the
felt's left/right edges** (sideways tile backs, overlapped like a real rack; in Peek mode
their face-up tiles cascade down the same edge), mirrored left/right, with pills anchored
at the top of each rack. The grid's middle column now shrink-wraps the felt
(`1fr auto 1fr`), so side seats are justified flush against the table's wood edge and the
two side columns stay exactly equal — every seat's tiles line up with the board itself.
The ≤900px strip layout got equal thirds (was 1fr/1.15fr/1fr) and reverts side racks to
horizontal. Verified: 64/64 tests, live hand with claims/melds on both sides rendering
mirrored, Peek on/off, dock on-screen, no overflow desktop or mobile, zero console errors.
**M7.4 seat-clearance fix shipped 2026-07-08** (user feedback: the long left-seat name
pill "Captain Whiskers" touched the board while the short "Mochi" pill didn't, and the
"You" pill touched the felt's bottom edge). Root cause: side pills were centered over
their racks, so half of any extra name width pushed straight into the felt — a
name-length bug. Fix: side seats now anchor to the FELT side (`align-items:flex-end`/
`flex-start`, with `.seat.seat-left/right` specificity beating the later `.opp
{align-items:center}`), so tile racks rest at the table edge (~12px) while name pills
inset a further 16px to clear the wooden box-shadow ring (~26px total); long names wrap
and grow outward toward the screen edge instead of into the board. The "You" pill got
`margin-top` clearance (22px under fx-depth) so it clears the felt's downward-projecting
tilted edge. Verified: 64/64 tests, all four side gaps symmetric (pill 26px / rack 12px
both sides), You pill 29px below, Peek-mode face-up racks clear the felt too, mobile strip
reverts racks to horizontal with no overflow, zero console errors.
**M8 sound shipped 2026-07-08** (synthesized, per user decision — no audio files, no
licensing, stays file://-friendly). New `js/sound.js`: a Web Audio layer in the same
pure-presentation style as fx.js, with short oscillator tones and filtered-noise-burst
"clacks" for draw / discard / chi-peng-gang (clack count scales with meld size) / a
warm win chord (brighter + a shimmer layer for instant wins: 三金倒 / 抢金) / a rising
tenpai ping (fires once per newly-reached-ready, via a per-seat `tenpaiSounded` flag
reset each hand, mirroring the existing `threatWarned` flag) / a quiet UI click tick on
chrome buttons. Hooked into fx.js's existing event functions (`fxAfterDraw`,
`fxAfterDiscard`, `fxAfterClaim`, `fxWin`) which were restructured so sound fires
independently of the visual-effects level — previously these all early-returned under
`!fxMotion()`, which would have wrongly silenced sound at Subtle/Off. **Off by default**;
a new Sound toggle + volume slider live in the Options popover, and the AudioContext is
only ever constructed inside that toggle's own click handler (the real user gesture),
satisfying browser autoplay policy — verified no context exists before opt-in.
Also fixed in passing: the Options popover clipped off-screen at in-between viewport
widths (~900-1250px) because it anchored to `#hud-settings`'s own box, which drifts
away from the screen edge once the header wraps; it now anchors to the stable
`.hud-tools` button-group edge instead. Verified: 64/64 tests, real gameplay (discard,
an actual AI chi claim, tenpai, fx-off independence) with zero console errors, mobile +
mid-width popover clean.
Remaining (future): M9 full polish pass.

*Original proposal below, retained for reference.*
**Scope: presentation, immersion, responsiveness, and feel only. FJ rules, the engine, party-mode netcode, and the Paws/Analyst logic are NOT changed.**

Author's framing: this is written against the real codebase (plain HTML/CSS/JS, one CDN dependency for party mode). Every recommendation is anchored to a specific file or function so the plan is executable, not aspirational. The headline finding is simple: the game already *looks* charming and the rules are solid — what makes it feel flat is not the art, it's the **render model**. Fixing that unlocks almost every animation idea below at once.

---

## Phase 1 — Analysis of the current build

### 1.1 Current gameplay flow

The single-player loop (in `js/main.js`) reads:

```
Menu ─▶ startSolo() ─▶ startHand()
                         │  deal 13×4, flip the GOLD, expose winds as flowers
                         ▼
                 ┌─ turn cycle (per seat) ───────────────────────────┐
                 │  draw a tile (or claim)                            │
                 │  seat 0 (you): interactiveTurnLoop()               │
                 │     beginTurnPrompt() sets G.turnCtx               │
                 │     Professor Paws comments (coachTurnUpdate)      │
                 │     you click a tile → select → click again/Discard│
                 │  seats 1–3 (cats): AI picks a discard              │
                 │  after each discard: claim window (Chi/Pon/Kan/Hu) │
                 └───────────────────────────────────────────────────┘
                         │  win / wall exhausted
                         ▼
                 scoring → hand result modal → next hand
```

Party mode (`js/net.js`) runs the same loop with a PeerJS host authoritative over guests; each client renders **its own seat's** projected view. The tutorial (`js/tutorial.js`) and Strategy School reuse the same tile widgets.

The flow is **correct, legible, and complete** — draw/discard/claim/win, golds as wilds, winds as flowers, instant wins (三金倒 / robbing the gold), all implemented and narrated in the game log. This is a genuinely finished game, which is the right foundation for a presentation-only revamp.

### 1.2 UI strengths (keep these)

- **A real visual identity.** The "cat café" palette (`:root` in `style.css`: warm ivory `--bg`, felt green `--felt`, orange `--accent`) is cohesive and distinctive. It should be *preserved and deepened*, not replaced.
- **Handmade tile faces.** Tiles are drawn with SVG artwork (`js/faces.js`) on an ivory body with a green "back" edge peeking out (`border-bottom: 5px solid` on `.tile`) — a smart, cheap pseudo-bevel that already hints at physicality.
- **Excellent learning scaffolding.** Auto-coach, the Hint button, live-tile counts, the tutorial, Strategy School, Peek mode, Labels toggle, and the narrated log make the game unusually approachable. This is a competitive advantage.
- **Zero-build, zero-install.** Opens from `file://`, no bundler, one lazy-loaded dependency. Party mode needs no server. This constraint is a feature and should survive the revamp.
- **Clear turn signalling already exists.** `.active-turn` puts an accent ring on the current seat; `.last-discard` highlights the freshly discarded tile; `.suggest` glows the coach's pick.

### 1.3 UI weaknesses (the flatness)

- **Everything is co-planar.** The table, hands, river, and side panels are 2D boxes in a CSS grid. There is no depth cue beyond a 1px shadow (`.tile` `box-shadow: 0 1px 2px`) and the border-bottom bevel. Nothing reads as "on a table."
- **Static discard river.** `#river` is a flex/grid of cells; tiles appear instantly with no travel from wall or hand.
- **The layout is a webpage, not a game board.** Header nav bar, a sticky right sidebar (Paws), and a full-width log beneath. It's a good *dashboard*; it doesn't frame a playfield.
- **Opponents are thin.** Cats are name + a row of `.tile.back.mini` backs + melds/flowers. They have little presence or "thinking" life.
- **Feedback is state-instant, not animated.** Selecting, discarding, claiming, and winning all snap between states. The win moment — the emotional payoff — is a modal, not a spectacle.
- **Typography/controls are utilitarian.** Pill buttons and checkboxes in a dark header read as "tool," not "game."

### 1.4 Animation opportunities (ranked by payoff)

| Opportunity | Where | Payoff | Cost |
|---|---|---|---|
| Tile **travel** on draw/discard (wall→hand, hand→river) | `renderHand`/`renderRiver` | Very high | Medium (needs persistent tiles) |
| **Win celebration** (glow, burst, slow-mo, confetti) | `doWin` / result modal | Very high | Low–Medium |
| Hover **lift + tilt toward cursor** on your hand | `.tile.clickable` | High | Low |
| **Claim gather** (Chi/Pon/Kan tiles fly together into a meld) | `applyClaim` | High | Medium |
| **Turn-start** camera nudge + seat focus | `beginTurnPrompt` | Medium | Low |
| **Idle "breathing"** on your hand tiles | hand render | Medium | Low |
| AI **"thinking"** shimmer on the active cat | opponent render | Medium | Low |
| Discard **settle/bounce** landing | `renderRiver` | Medium | Low |
| Legal-action **pulse** on claimable tiles | claim prompt | Medium | Low |

### 1.5 Performance bottlenecks

The critical one, and the linchpin of this whole proposal:

> **`renderAll()` rebuilds the entire board from scratch every update.** Every tile is a freshly `document.createElement`'d node (`tileEl()` in `js/ui.js`), and `renderHand`/`renderRiver`/`renderOpponents` clear their containers and regenerate children on each state change.

Consequences:
- **No tile has a stable identity across frames**, so you cannot tween a tile from A to B — the "same" tile is a different DOM node before and after. This is *why* the game feels static: the architecture actively prevents motion.
- Full teardown/rebuild causes **layout thrash** and drops any in-flight CSS transition.
- On mobile, rebuilding ~40–70 nodes plus inline SVG faces per update is wasteful (though currently survivable because updates are turn-paced, not per-frame).

Secondary items: SVG faces are re-parsed on every rebuild (should be cached/cloned); no `will-change`/GPU-layer hints; no `prefers-reduced-motion` handling yet; no asset preloading strategy for sounds.

**None of these are hard blockers today** — the game is turn-based and light — but the rebuild model must be addressed *first* or every animation will fight the renderer.

### 1.6 What feels outdated

- Flat, co-planar board with hairline shadows.
- Instant state snaps (no easing anywhere in gameplay; easing exists only on the splash `logo-bob` and button hovers).
- Dashboard chrome (top nav + sidebar + log) around the play area.
- Win = a text modal.
- Static, silent table (no sound, no ambient motion).

### 1.7 Keep untouched (hard constraints)

- **All FJ rules and scoring** (`js/engine.js`) — gold wilds, flowers, instant wins, claim precedence.
- **The turn/claim state machine and party netcode** (`js/main.js`, `js/net.js`) — animations must be *presentation-layer only* and must not change timing that the host/guest protocol depends on, or introduce nondeterminism into simulated states.
- **The unified Professor Paws + Analyst engine** (just shipped) — its logic stays; only its panel's *skin* may modernize.
- **Learning features' behavior** — tutorial, Strategy School, Peek, Labels, Hint, narrated log. Reskin yes; rewire no.
- **The no-build, `file://`-friendly, single-dependency deployment.**

### 1.8 Redesign (presentation only)

- The **render model** → persistent, keyed tile elements (enabling animation). *Highest priority.*
- The **board framing** → a pseudo-3D felt table with perspective and depth.
- **Tile interactions** → hover lift/tilt, select bounce, draw/discard travel, claim gather.
- **The win moment** → an on-table celebration sequence.
- **HUD/controls** → a game-styled scoreboard, turn indicator, wall/wind counters, and buttons.
- **Ambient life** → lighting, soft shadows, optional particles, sound.

---

## Phase 2 — Gameplay vision

Design north star: **"a physical set of cat-café tiles on a warm felt table, filmed by a calm camera."** Every effect below serves *legibility first, delight second*. Motion clarifies whose turn it is, where a tile went, and what just happened — and only then flourishes. All of it is toggleable and respects `prefers-reduced-motion`.

### 2.1 The table — lightweight pseudo-3D (not realistic 3D)

A single perspective container tilts the whole playfield back ~18–22°, so it reads as a table you're seated at rather than a page you're scrolling.

```
        opponents (upstage, smaller, dim)
   ╔══════════════════════════════════════════╗   ← felt table, tilted back
   ║   🐈 Mochi      🐈‍⬛ Biscuit      🐅 Whiskers ║      via perspective()
   ║                                          ║
   ║            ┌──────────────┐              ║
   ║            │  DISCARD RIVER │  ← gold 🥇  ║   rows fan slightly toward you
   ║            └──────────────┘              ║
   ║                                          ║
   ║  ▁▂▃  YOUR HAND (downstage, large) ▃▂▁   ║   ← closest to camera, brightest
   ╚══════════════════════════════════════════╝
              wooden edge / drop shadow
```

Implementation intent (CSS, no engine):
- One `#board` with `perspective: 1400px;` and an inner `#felt` at `transform: rotateX(20deg)`. Children position in that 3D space.
- **Depth by role:** your hand sits at `translateZ(+40px)` (closer, larger, sharpest shadow); the river mid-plane; opponents at negative Z (smaller, slightly desaturated, softer). Depth now encodes *game meaning*.
- **Felt + wood:** a subtle felt texture (CSS gradient noise or a tiny tiled PNG) with an inset shadow for the well, ringed by a wooden bevel (layered box-shadows / border-image).
- **Floating table + ambient light:** a large soft drop shadow under `#felt` makes it hover; a faint radial highlight (a `radial-gradient` "lamp") centered over the river gives directional light. Tiles cast short shadows consistent with that lamp.
- **Layered tiles:** melds and stacked/added kongs get real `translateZ` offsets so a kong visibly stacks.

Why pseudo-3D and not Three.js: see Phase 3. Short version — the board is dozens of textured quads updated a few times per turn; CSS 3D transforms deliver the depth, shadow, and tilt we want at a fraction of the complexity, on the same DOM nodes the game already builds, with graceful mobile fallback.

### 2.2 Animated tiles — "each tile feels alive"

Every effect is on a **persistent, GPU-friendly** tile node (`transform`/`opacity` only):

- **Hover lift + tilt-toward-cursor.** On your hand, a tile rises (`translateY(-10px) translateZ(20px)`) and tilts a few degrees toward the pointer (`rotateX/rotateY` from cursor offset) — a "pick me up" feel. Today's `.tile.clickable:hover { translateY(-6px) }` becomes this.
- **Idle breathing.** Your hand tiles drift ±1px on a long, desynchronized sine (staggered `animation-delay`) so the hand looks held, not printed. Amplitude tiny; disabled under reduced-motion.
- **Select bounce.** Selecting overshoots then settles (elastic/`cubic-bezier` back-ease) instead of the current instant `translateY(-10px)`.
- **Discard snap + soft landing.** The tile lifts, rotates slightly, travels to its river slot, and **settles with a small squash-and-recover** and a shadow that grows-then-tightens on landing.
- **Draw slide.** A drawn tile emerges from the wall edge, rotates upright, and slots into the hand's "just drawn" position (which already exists as `.tile.drawn`).
- **Shadow movement.** Tile shadows shift with lift/tilt so light feels real.

### 2.3 Camera feel (subtle, always subtle)

A single transform on `#felt` (or a wrapping `#camera`) is nudged for events:

- **Turn start:** a tiny push-in (`scale(1.015)`) + a hair of downward tilt when it becomes your turn — the table "leans in." Reverts when you commit.
- **Discard focus:** the camera's look-point drifts a few px toward a just-discarded tile, then eases back — draws the eye to the new river entry.
- **Win shake:** a short, low-amplitude shake (3–5px, 250ms, decaying) on a winning hand — celebratory, not jarring.
- **Smooth transitions:** all camera moves are eased (200–350ms) and *cumulatively bounded* so they can never disorient.

### 2.4 Player interaction choreography

```
DRAW      wall ▸ tile peels off ▸ arcs + rotates upright ▸ lands in hand (drawn slot)   ~380ms
DISCARD   tap ▸ lift+tilt ▸ glide to river cell ▸ squash-land ▸ settle + shadow          ~420ms
CHI/PON   claimed tile + your 2 tiles converge ▸ snap into a meld ▸ tiny "clack" flourish ~500ms
KAN       four tiles stack with a visible layer (translateZ) ▸ bonus-draw slide           ~600ms
WIN       hand tiles glow ▸ ripple/burst from winning tile ▸ slow-mo 0.4s ▸ confetti opt.  ~1.6s
```

Each is a **presentation wrapper** around the existing state change — the rules fire exactly as now; the animation only delays the *visual* commit by its duration (and is skippable/instant under reduced-motion or a "fast" setting).

### 2.5 Table environment / immersion

- Soft contact shadows under tiles and the table.
- Ambient "lamp" lighting with a warm falloff toward the edges (vignette).
- A richer but calm background (deepened café tones, faint bokeh) behind the floating table.
- **Optional** drifting particles (dust motes / falling petals to match the flower theme) at very low density — off by default on mobile.
- Felt texture, wooden edge, and a faint glass/gloss sheen on tile faces.

### 2.6 Modern UI / HUD

Reframe the chrome as a game HUD around the board (not a webpage around a widget):

```
┌─ TOP BAR ────────────────────────────────────────────────────────────┐
│  🀄 Meowjong        Hand 3/8     Wall ▉▉▉▉▁ 42     ⚙  🔊  ?           │
└───────────────────────────────────────────────────────────────────────┘
   ┌ seat chips (wind + score + turn ring + "thinking…") ┐
                       [ BOARD / FELT TABLE ]
   ┌ YOUR HUD: wind ● East   score 520   🌸×2   🥇 gold: 4∥ ┐
   [ Hint ]  [ Full analysis ▾ ]        [ action buttons dock ]
```

- **Scoreboard & seat chips:** each player a compact chip — wind pip, score, flower/meld count, an animated ring when active, a subtle "thinking" shimmer for AI.
- **Wall counter:** a depleting bar + number (tension as tiles run out).
- **Wind indicators:** clear round/seat wind pips (E/S/W/N) with the prevailing wind emphasized.
- **Action dock:** primary actions (Discard, Hú, Chi/Pon/Kan) in a bottom-center dock with clear hierarchy, replacing scattered pill buttons; the winning action pulses (reuse the existing `pulse` keyframe, restyled).
- **Paws panel:** same content, restyled as a floating "advisor card" that can collapse to a chat-bubble tab so it never competes with the board on small screens.

### 2.7 Sound design (concept only — not implemented now)

| Event | Sound | Notes |
|---|---|---|
| Draw | soft tile *slide* / paper-shuffle | pitch varies slightly per draw |
| Discard | crisp *clack* on felt | positional (pan by river column) |
| Chi/Pon/Kan | double/triple *clack* + light chime | flourish scales with meld size |
| Win | warm chord + *shimmer*; bigger for instant wins | 三金倒 gets a special sting |
| Tenpai reached | subtle rising *ping* | reinforces the "ready" moment |
| UI click / hover | quiet tick / felt tap | very low volume |
| Ambient | faint café room tone + occasional purr | loopable, duck under events |

Delivery: tiny preloaded audio sprites (one file, offset playback) via the Web Audio API; a master mute + volume in the top bar; **silent by default until the user opts in** (autoplay-policy friendly). No assets committed until this phase is approved.

### 2.8 Visual feedback

- **Highlight legal actions:** claimable tiles and valid discards get a soft outline/pulse; illegal ones stay quiet.
- **Hover states everywhere:** tiles, buttons, seat chips.
- **Animated hints:** Paws' suggested tile does a gentle "look at me" wiggle + glow (upgrade of `.suggest`).
- **Combo / meld effects:** completing a meld emits a brief spark; flowers/gold get a themed shimmer.
- **Winning-path visualization:** on win (and optionally in the Analyst), draw connectors grouping the 4 sets + pair so players *see why* it's a win — a strong teaching moment.
- **AI thinking indicator:** the active cat's chip shimmers and shows animated "…" for a beat before it acts, so turns feel considered rather than instant.

### 2.9 Microinteractions (a deep bench)

Buttons: press-depress with a soft shadow dip; hover lift; disabled fades. Tiles: hover lift, cursor-tilt, select bounce, discard squash, land shadow, glow on suggest/last-discard, breathing idle. Panels: Paws card slides/fades in; analysis expander springs open (upgrade of the current `::before` rotate). Transitions: menu→game cross-dissolve with a camera settle; hand→result modal via a slow-mo pause. Cursor: tiles use a "grab/grabbing" cursor. Counters: wall number ticks and the bar eases as it depletes; score changes count up/down. Easing: standardize on a small set of tokens — `--ease-out-soft`, `--ease-back` (overshoot), `--ease-spring` — so motion feels like one family. Fades: log lines fade in; toasts (tenpai!, danger!) slide+fade at the board edge instead of only living in the side log.

---

## Phase 3 — Technical proposal

### 3.1 The real question

This game renders **~40–70 textured quads that change a few times per turn**, with rich existing SVG faces, a warm 2D art style, a `file://`/no-build constraint, and a party mode whose logic must stay deterministic. The choice is less "which 3D engine" and more "what's the lightest layer that gives depth + fluid motion without throwing away the existing DOM tiles, art, and learning UI."

### 3.2 Options compared

| Option | Pros | Cons | Perf | Mobile | Complexity | Verdict |
|---|---|---|---|---|---|---|
| **CSS 3D transforms + FLIP** (on persistent DOM tiles) | Reuses existing DOM tiles & SVG faces; real perspective/depth/shadows; GPU-composited `transform`/`opacity`; accessible & selectable text; trivial `file://` deploy; graceful reduced-motion & fallback | Not "true" 3D (no arbitrary camera orbit); complex particle systems are awkward; must manage transform layers carefully | Excellent for this scale | Excellent | **Low–Medium** | ✅ **Primary** |
| **Canvas 2D** | Full control of draw order/shadows; cheap for many sprites | Throws away DOM tiles/SVG/a11y; must re-implement hit-testing, layout, text, tutorial widgets; no CSS | Good | Good | Medium–High | ❌ Not worth the rewrite |
| **PixiJS** (WebGL 2D) | Fast sprite batching; great particles; nice for juice | New dependency & asset pipeline; re-implements the entire UI/interaction/tutorial layer; loses DOM a11y; overkill at this tile count | Very good | Good (GPU/memory cost) | High | ⚠️ Only if we ever go sprite-heavy |
| **Three.js** (WebGL 3D) | True 3D tiles, lighting, camera moves | Heavy dependency; full rebuild of rendering + input + text; real 3D asset/lighting work; battery/mobile cost; huge scope for a turn-based tile game | Overkill | Fair–Good | **High** | ❌ Mismatch to needs |
| **Babylon.js** (WebGL 3D) | Powerful, batteries-included 3D | Even heavier than Three.js; same rewrite/scope problems | Overkill | Fair | High | ❌ Mismatch |
| **Raw WebGL** | Maximum control | Enormous effort; reinvents everything | — | — | Very High | ❌ No |

### 3.3 Recommendation

**Primary stack: persistent DOM tiles + CSS 3D transforms + a FLIP animation helper**, with a **small optional canvas overlay** reserved *only* for the win celebration (confetti/particles), and **Web Audio** sprites for sound. Concretely:

1. **Refactor the renderer to keyed, persistent tiles** (the enabling step). Give every tile a stable key (kind + a per-tile id for hand slots) and have `renderAll` *reconcile* — move/add/remove nodes — instead of `innerHTML`-clearing and rebuilding. This is the one non-trivial change and everything else rides on it.
2. **Animate with FLIP** (First–Last–Invert–Play): measure a tile's old and new box, apply an inverse transform, then transition to identity. This makes wall→hand and hand→river travel *emerge naturally* from the existing layout with no hand-authored coordinates — the ideal fit for a reflowing flex hand.
3. **Add the 3D frame** via `perspective` + `rotateX` on the board and per-role `translateZ`.
4. **Particles only where they earn it** — a lazy, self-destroying `<canvas>` over the board for wins; no always-on WebGL context.
5. **Everything GPU-friendly:** animate only `transform`/`opacity`, add `will-change` on in-flight tiles, cap concurrent animations, and gate all of it behind a motion setting + `prefers-reduced-motion`.

This keeps the single-dependency, no-build, `file://`-friendly deployment intact (FLIP is ~40 lines; no framework needed), preserves the SVG art, tutorial, and accessibility, and delivers ~90% of the "modern digital board game" feel at a fraction of a WebGL rewrite's cost and risk. We can revisit PixiJS later *only if* we deliberately move to a sprite-heavy, effects-heavy direction.

---

## Phase 4 — Mockup (draft, pre-production)

### 4.1 Full-screen layout (desktop)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🀄 Meowjong          Round: East · Hand 3/8      Wall ▉▉▉▉▁ 42   ⚙ 🔊 ? │  top bar (HUD)
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│            ╭─🐈 Mochi──╮   ╭─🐈‍⬛ Biscuit─╮   ╭─🐅 Whiskers╮                │  seat chips
│            │ S · 480   │   │ W · 500 ⋯  │   │ N · 460    │                │  (⋯ = thinking)
│            ╰───────────╯   ╰────────────╯   ╰────────────╯                │
│               ┌──────────────────────────────────────┐                     │
│               │░░░░░  tilted felt table (perspective) ░│   ← lamp light      │
│               │░░   🥇 GOLD: 4∥      DISCARD RIVER   ░░│                     │
│               │░░   [tiles fanned, newest lifted]    ░░│                     │
│               │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│                     │
│               └──────────────────────────────────────┘                     │
│                        (wooden edge + floating shadow)                      │
│                                                                            │
│   ● East · You   Score 520   🌸×2         ┌───────────── Professor Paws ──┐ │
│   ┌───────── YOUR HAND (large, lifted) ─────────┐   │ 🐱 "Throw 9萬 — keeps  │ │
│   │  ▟ ▟ ▟  ▟ ▟  ▟ ▟ ▟  ▟ ▟ ▟  ▟ ▟   [drawn ▟] │   │  your 3∥/6∥ wait."     │ │
│   └──────────────────────────────────────────────┘   │ [Hint] [Full analysis▾]│ │
│         [ Discard 9萬 ]   [ Hú! 胡 ]  ← action dock   └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Camera angle concept (side view of the perspective)

```
   camera (you)
       \
        \   18–22° tilt
         \______________________
         |   your hand (Z+, big) |   brightest, sharp shadow
         |   river (Z 0)         |   mid
         |   opponents (Z−, small)|  dim, soft shadow
         '------------------------'
              felt plane, floating over a soft shadow
```

### 4.3 Discard — animation storyboard

```
 f0  hand tile selected (lifted, tilted)          ▟↑
 f1  detaches, rotates ~8°, shadow grows           ▟↘  (   )
 f2  glides along an eased arc toward river cell      ╲__ ▟
 f3  arrives; squash (scaleY .9) + shadow spreads         ▟_  ⌣
 f4  recover (scaleY 1.0), shadow tightens, settle        ▟   ·
 f5  camera look-point eases back; Paws/log update        ▟
     total ≈ 420ms · skippable (reduced-motion → f0→f5 instant)
```

### 4.4 Win — animation storyboard

```
 0.0s  winning tile lands / claimed
 0.1s  the 4 sets + pair underline as connected groups (teaching)
 0.3s  hand tiles glow warm; brief slow-mo (global 0.6× for 0.4s)
 0.6s  radial light burst from the winning tile
 0.8s  optional confetti (canvas overlay, cat/paw/petal confetti)
 1.4s  settle → result card slides up with score breakdown
        instant-win variants (三金倒 / robbing the gold) get a bigger sting
```

### 4.5 Tile states (visual spec)

```
 rest        hover         selected       suggest        last-discard    dealt-back
 ┌────┐      ┌────┐↑10px    ┌────┐↑bounce  ┌────┐✧glow    ┌────┐▒ring     ┌────┐
 │ 9萬│      │ 9萬│ tilt    │ 9萬│ accent  │ 9萬│ wiggle  │ 9萬│ soft     │▒▒▒▒│ green
 └────┘      └────┘ →cursor └────┘ border  └────┘ +halo   └────┘          └────┘
 short       taller         highest        pulsing        highlighted     no face
 shadow      shadow+tilt    shadow         gold halo       ring
```

### 4.6 Mobile / narrow layout

Portrait collapses depth (perspective softens to keep tiles legible) and restacks: top bar → opponents as a single compact strip → felt/river → your hand pinned to the bottom → Paws demoted to a tap-to-open bubble. Particles and idle-breathing default **off**; travel animations keep but shorten. The action dock spans the bottom for thumb reach.

```
┌───────────────┐
│ HUD  Wall 42 ⚙│
│ 🐈 🐈‍⬛ 🐅 (mini)│
│ ┌───────────┐ │
│ │  river 🥇 │ │
│ └───────────┘ │
│  YOUR HAND    │
│ ▟▟▟▟▟▟▟▟▟▟▟▟▟ │
│ [Discard][Hú] │
│ 🐱 Paws (tab) │
└───────────────┘
```

---

## Phase 5 — Implementation plan (milestones)

Ordered by dependency. **M1 is the keystone** — nothing else animates well until tiles persist. Difficulty is engineering effort × risk.

| # | Milestone | What ships | Difficulty | Notes / dependency |
|---|---|---|---|---|
| **M0** | **Motion foundation** | Easing tokens, a global motion setting + `prefers-reduced-motion`, a reusable FLIP helper, sound/particle feature flags (off) | ★★☆☆☆ Low–Med | Pure scaffolding; no visible change yet |
| **M1** | **Persistent tile renderer** | Refactor `renderHand`/`renderRiver`/`renderOpponents`/`tileEl` to keyed reconciliation; cache/clone SVG faces | ★★★★☆ High | **Keystone.** Must keep party-mode render parity; heavy testing |
| **M2** | **Tile interactions** | Hover lift+tilt, select bounce, idle breathing, suggest wiggle, `.last-discard` glow upgrade | ★★☆☆☆ Low | Rides on M1; instantly makes the hand feel alive |
| **M3** | **Motion choreography** | Draw slide, discard travel+squash, claim gather, kong stack — via FLIP | ★★★☆☆ Med | Rides on M1; wrap existing state changes, keep timing skippable |
| **M4** | **Pseudo-3D table + lighting** | `perspective`/`rotateX` board, per-role `translateZ`, felt/wood, lamp light, contact shadows, floating shadow | ★★★☆☆ Med | Mostly CSS; iterate on readability & mobile fallback |
| **M5** | **Camera feel** | Turn-start push-in, discard focus drift, win shake, eased transitions (bounded) | ★★☆☆☆ Low | Single transform on a camera wrapper |
| **M6** | **HUD / UI overhaul** | Top bar, seat chips + thinking indicator, wall bar, wind pips, action dock, restyled Paws card | ★★★☆☆ Med | Reskin only; no rule/logic changes |
| **M7** | **Win celebration** | Group underline, glow, slow-mo, light burst, optional confetti (lazy canvas), instant-win stings | ★★★☆☆ Med | Canvas overlay is self-contained |
| **M8** | **Sound** | Web Audio sprite, event hooks, mute/volume, opt-in default, ambient bed | ★★★☆☆ Med | Needs asset creation/licensing; separate approval |
| **M9** | **Polish** | Toasts, combo sparks, winning-path viz, count-up scores, menu↔game transitions, cursor states | ★★★☆☆ Med | Broad but individually small |
| **M10** | **Optimization & QA** | Profiling, `will-change` discipline, animation caps, mobile/battery tuning, cross-browser + reduced-motion + party regression pass | ★★★☆☆ Med | Continuous; gates release |

Suggested first shippable slice: **M0 → M1 → M2** (persistent tiles + living hand) is a self-contained, high-impact release that de-risks everything after it. **M4 (table) + M5 (camera)** is a strong second release; celebration/sound/polish follow.

---

## Phase 6 — Risks & mitigations

### Gameplay impact
- **Animations slowing play / hiding info.** Turn-based players are sensitive to input latency. → All effects **skippable and interruptible**; a "fast/instant" motion setting; never block input on an animation — the state commits logically at once, the visual just catches up; clicking again fast-forwards.
- **Depth harming readability.** Perspective can shrink/obscure opponent tiles or the river. → Depth is subtle, tiles keep minimum legible size, and a "flat" mode disables 3D entirely.
- **Party-mode desync or nondeterminism.** Presentation timing must not leak into the host/guest protocol or simulated states. → Animations live **strictly in the render layer**, driven by state *after* it's resolved; the Analyst/AI simulations never animate; add regression tests that a host and guest reach identical states regardless of animation settings.

### Accessibility
- **Motion sensitivity / vestibular triggers.** → Honor `prefers-reduced-motion` (auto-minimize), plus an in-game motion toggle; camera shake/slow-mo are the first things disabled.
- **Contrast & focus.** → Keep WCAG-AA contrast on the new felt/HUD; preserve keyboard/tab order and visible focus; **keep tiles as real DOM** (a major reason we reject a canvas rewrite) so screen readers and the Labels/Peek learning aids keep working.
- **Color reliance.** → Turn/legality cues use shape+motion+text, not color alone.

### Mobile performance
- **Many shadows/filters/particles = jank & battery drain.** → Particles and idle-breathing off by default on mobile; prefer `transform`/`opacity` over `filter`/`box-shadow` animation; cap concurrent tweens; soften perspective; test on mid-tier Android.
- **Layout cost of the 3D container.** → Promote only animating layers; avoid animating layout properties; measure with devtools paint-flashing.

### Browser compatibility
- **CSS 3D / backdrop / Web Audio quirks (esp. older Safari/iOS).** → Feature-detect; provide a flat, no-audio fallback that's fully playable; audio unlocked on first user gesture (autoplay policy); avoid bleeding-edge CSS without fallbacks. Preserve the `file://` path (no ES-module/CORS traps).

### Animation overuse
- **"Juice" fatigue / clown-car motion.** → A strict motion budget: at most one hero animation at a time; effects earn their place by aiding legibility; a single easing family; user dials from Full → Subtle → Off.

### Input latency
- **Perceived lag if input waits on tweens.** → Immediate visual acknowledgement on press (tile lifts on `pointerdown`, not after logic); logic runs instantly; tap-again / rapid input skips to the resolved state; target ≤100ms to first visual response.

---

## Summary & recommendation

The art and rules are already good; the flatness is an **architecture** problem, not a taste problem. The plan:

1. **Refactor to persistent, keyed tiles** (M1) — the one change that unlocks all motion.
2. **Stay in DOM + CSS 3D + FLIP**, add a lazy canvas only for win particles and Web Audio for sound — preserving the no-build, `file://`, accessible, single-dependency deployment and all the learning UI.
3. **Layer in feel** — living tiles → choreography → pseudo-3D table → camera → HUD → celebration → sound → polish — each milestone independently shippable and fully gated behind motion/accessibility settings.
4. **Touch no rules, no engine, no netcode** — presentation only.

Recommended approval target: greenlight **M0–M2** first (persistent tiles + a living hand) as a low-risk, high-impact proof, then review before committing to the table/camera work.

**Awaiting approval — no production code will be written until this proposal is signed off.**


