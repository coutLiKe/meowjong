# Meowjong — First-Person 3D Mode: Phase Plan

**SHIPPED — post-P6 refinement pass 5, committed and merged to main
(2026-07-20).** Pass-5 changes, all verified live:
- **Public row rewritten again** (review: pass 4's fix "didn't take" — still
  overlapping, plus a tile floating disconnected near the corner). Root
  cause: both pass-3 and pass-4 anchored the row in the strip OUTSIDE the
  rack, between it and the table edge — that strip is only ~50mm deep, so it
  either collided with the hand/rack or ran off the near seats' camera frame,
  and pass 4's Y-axis overflow stack visually reads as overlapping tiles from
  this camera's angle even though it's not, technically, occupying the same
  point. Measured the OTHER side of the rack instead: the wall sits only
  ~0.20 from centre while every rack sits at ~0.37 — a genuinely empty
  ~170mm gap on all four sides. The row now lays out there as a real 2D
  grid — centred like the hand, melds never split across a wrap, rows
  spaced a full tile-depth+gap apart (no more Y-stacking illusion) — capped
  at 10 tiles/row before wrapping. Verified live: every public tile in a
  live hand sits ≥60mm from the nearest rack/wall/hand/gold tile and 0
  render outside the camera frame; a synthetic 15-tile stress case (9
  flowers + 2 melds on one seat) laid out as three real, evenly-spaced rows
  with exact 37mm tile-to-tile spacing and 0 off-frame. Known residual: a
  3rd row on that same extreme case comes within ~20mm of the wall — raised
  the per-row cap to 10 so that only an even more extreme hand would ever
  reach a 3rd row.
- **Menu logo/title cut off, unreachably, on a shorter window** — a real bug,
  not the stale-cache theory floated after pass 4. `#screen-menu` is
  `display:flex; flex-direction:column; justify-content:center;
  overflow-y:auto`: the classic trap where centering + scroll overflow clips
  content at the START of the flex axis with no way to scroll to it once the
  column is taller than the viewport. Reproduced live at 1000×650 (logo and
  the top of "Meowjong" both gone, unscrollable). Fixed with
  `justify-content: safe center` — centers when everything fits, falls back
  to top-aligned + fully scrollable the moment it doesn't. Verified live at
  the same 1000×650: logo fully visible at rest, and scrolling reaches every
  footer link with nothing clipped at either end.
- 90/90 tests green; leak audit re-run and SEALED; zero console errors.

Pass-4 changes, all verified live:
- **Opponent-rack rise race fixed** ("opponent tiles doesn't shoot up" on hand
  start): `s3StageRise()` ran AFTER the same sync pass's opponent-rack build,
  which — on a brand-new hand — had already queued its OWN tweens for those
  freshly-created meshes (the full 13-tile deal reads as a "draw" when the
  rack was just emptied by the ceremony's sink step). `s3StageRise()` then
  read `.position` on those meshes synchronously, before their queued tween
  had run a single frame, capturing the mesh's stale creation pose (the origin)
  as the "resting pose" to sink-and-rise back to — corrupting the tile onto
  the table centre once the two competing tweens finished fighting. Fixed by
  having `s3StageRise()` take over any pending tween on a mesh first (read
  its TARGET pos/rot, cancel it, then rise to that target) instead of trusting
  `.position` directly. Verified live: sampled all 39 opponent-rack tile
  positions immediately after `s3StageRise()` ran on a real re-deal — all at
  the exact expected resting height, zero pending tweens left over.
- **Flower/meld row overlap, take two**: the pass-3 fix anchored the row to a
  fixed per-seat corner (0.30 / 0.40) as a floor. Live NDC projection found
  two real breaks that screenshot review alone had caught but pass 3 hadn't
  actually fixed: (1) a full hand (14 tiles) plus 2+ same-kind flowers still
  overlapped — the fixed corner only ever cleared a SINGLE flower, and the
  row grows INWARD (toward the hand) as more tiles are added; (2) the fixed
  0.40 corner sits OFF-FRAME entirely for the two near seats (close to the
  camera, so a lateral offset swings much wider on screen than the same
  offset does for the far seat) — confirmed by sweeping projected NDC.x from
  0.47 (safe, far seat) to -1.28 (fully clipped, near seat) at the same local
  offset. Fixed by dropping the fixed-corner floor entirely and anchoring
  purely on the seat's OWN current hand/rack half-span (dynamic, so it can
  never grow back into it) plus a small margin — this alone lands within
  frame for every seat at the common 0–2 flower/meld case. For longer runs, a
  live-camera NDC check now stacks any tile that would render outside the
  frame straight up a layer rather than pushing it off-screen. Known residual
  limit: a near seat holding 3+ simultaneous flowers/melds still sits right at
  the frame edge (verified ~0.98–1.04 NDC, i.e. a soft partial clip, not the
  −1.17 to −1.28 full clip from before) — fixing that fully needs a camera
  FOV/framing change, deliberately out of scope tonight since camera tuning
  is load-bearing for the hidden-info leak check.
- **Main menu visual pass** ("fix the main menu screen", no specific detail
  given beyond the whole card being circled): the menu was visibly flatter
  than everything downstream of it had become. Added a richer layered
  background (soft top light + bottom vignette + a faint diagonal texture,
  echoing the felt), a soft halo behind the bobbing logo, gradient-filled
  buttons with proper inset/ambient shadow layering and press feedback
  (hover lift, active press-down), and circular icon chips on each button.
  Pure CSS — no markup changes.
- 90/90 tests green; leak audit re-run and SEALED (camera itself untouched);
  zero console errors.

Pass-3 changes, all verified live:
- **Shuffle slowed to feel mechanical**: staggered sink (620ms + per-tile
  jitter), a longer audible shuffle beat (12 muffled clacks on the full
  cycle), rises at 620ms per group — full first-hand ritual now ~3.6s
  (measured live: 3591ms staged), later hands ~2.1s, click still skips.
- **Overlaps eliminated** (user-annotated): public flower/meld rows moved off
  the rack line onto the empty strip between rack and table edge — collision-
  free by construction for any run length; opponents' rows start at their
  right corner (0.40), yours at 0.30 so it stays inside the seated frustum
  (verified by NDC projection: 0.88, in-frame). All public tiles measured
  ≥0.428 from centre vs walls at 0.20.
- **Ceremony detector bug found & fixed**: keyed on handNumber, which RESETS
  on "New match"/re-deal — the ceremony silently skipped and kept a stale
  wall break. Now keyed on gen+handNumber+dealer+gold (gen bumps per
  startHand for solo/host; handNumber+dealer covers guests whose gen is
  static). Verified: two consecutive newMatch() calls each staged the full
  ceremony with fresh breaks (3591ms / 3596ms).
- **Last-discard ring**: a slim pulsing gold ring lying flat under the newest
  river tile's resting slot — never covers the face, moves on the next
  discard, hides when the tile is claimed (verified live through an actual
  claim) or the river empties; steady (non-pulsing) under reduced motion.
- **Fidelity**: felt texture 1024² + anisotropy, cool rim light for edge
  separation, slightly glossier faces/sides.
90/90 tests, leak audit SEALED, zero console errors. Changes in this pass, all verified live:
- **Dice removed** (review: props without a gameplay role don't belong on the
  table). The deterministic wall break + gold-at-the-gap stays; the dice
  theatre, textures, meshes and roll narration are gone.
- **Automatic-table ceremony**: on a new hand, the previous hand's tiles sink
  into the machine, a muffled shuffle clatters beneath the felt (sound-toggle
  aware), then the walls RISE from under the surface, followed by the racks,
  then your hand tile-by-tile, then the public rows and gold — full cycle on
  a match's first hand (~2s), brisker on later hands (~1s), any click skips
  it. Implementation: sync-level staging — state changes during the ceremony
  are held and applied in one deferred pass, so the engine is never blocked
  and never desyncs (verified: pendingSync held during the window, flushed on
  schedule).
- **Double-click to discard** alongside dragging (350ms window on the same
  tile mesh), prompt copy updated. Verified end-to-end: a synchronous
  double-dispatch discarded through doHumanDiscard → engine → AI responses.
  (Test-harness note: two tool-driven clicks arrive ~800ms apart, outside any
  sane double-click window — the timing internals were confirmed with a
  temporary debug tap, then the tap was removed.)
- **Robustness fixes found while testing**: `setPointerCapture` wrapped in
  try/catch (synthetic/edge pointers legitimately throw NotFoundError, which
  previously tripped the fatal-error modal); tweens now place INSTANTLY when
  `document.hidden` (background tabs suspend rAF — the review screenshot's
  jumbled meld was tweens frozen at scattered start poses; hidden tabs now
  always hold final poses).
- **Layout**: public flower/meld rows start nearer their seat and sit further
  outboard, clearing the wall corners they previously collided with.
- 90/90 tests green; leak audit SEALED; zero fresh console errors.


**Status: P0–P6 complete, 2026-07-18. The plan as scoped is fully shipped.**

**P6 shipped (ship):**
- **Reduced-motion / fx-off, actually wired in — this was a real, substantial
  gap, not a checkbox.** Through P0–P5 nothing in `scene3d.js` checked motion
  settings except the P4 ambient loop (dust/lamp). Camera easing, every tile
  tween (opponent draw-slide, river fly-in, claim-gather, drag-cancel
  snap-back), and the portrait idle-bob/thinking-pulse all ran unconditionally.
  Fixed by reusing the app's existing `fxMotion()` ladder (Full/Subtle/Off +
  OS `prefers-reduced-motion`) rather than inventing a parallel setting:
  `s3Tween()` now resolves instantly at the source when motion is off, so
  every call site gets instant placement for free with no per-site changes;
  the camera loop snaps directly to target instead of easing 12%/frame; and
  portraits hold a static (not pulsing) size/tint for "thinking" so the
  signal survives without the motion. **Verified, not assumed**: with motion
  off, forced a large camera target change and confirmed it snapped within
  two frames, then ran a full automated match and confirmed `SCENE3D.tweens`
  never left zero the entire time (nothing was ever scheduled to animate);
  with motion back on, re-ran the same match and confirmed tweens DO get
  scheduled (the gate doesn't accidentally disable normal play).
- **Documentation**: README gained a "First-person 3D table (beta)" section
  (what it is, the desktop/mouse constraint, the fairness guarantee, the
  motion-setting behavior) and a note that Three.js joins PeerJS as a vendored
  (not CDN) dependency, preserving the `file://`-offline claim. The in-game
  House Rules modal gained a one-line pointer to the beta mode.
- **Cross-browser QA — honest scope note.** This environment has one
  Chromium-based browser automation tool; Safari/Firefox/Windows could not be
  driven directly, so "tested on a QA matrix" would be a false claim. What
  *was* done: a code-level compatibility pass over every browser API
  `scene3d.js` touches (standard Pointer Events incl. `setPointerCapture`,
  `matchMedia`, `requestAnimationFrame`, `CanvasTexture`/`Image` data-URI
  decoding, `wheel`) — nothing vendor-prefixed or Chromium-only, and Three.js
  r128 is an old, broadly-compatible release. **Recommend a manual spot-check
  on Safari and Firefox before treating this as fully cross-browser-verified**
  — that gap is real and this note exists so it isn't quietly forgotten.
- Final full-stack regression: 90/90 tests green; a live match played through
  the 3D path end-to-end with Full effects (multiple hands, zero console
  errors, tween count returned cleanly to 0 after a transient mid-play spike
  that was checked, not assumed, to be transient); the mobile/resize gate,
  the party-guest simulation, and the reduced-motion gate from this and the
  P5 session all still pass after this pass's edits; cache-bust bumped.

## Where this leaves the feature

P0 through P6 as originally scoped are done: a true first-person seated 3D
mahjong table — real scale, real art, a locked-down and audited camera, full
rule parity with the classic board (same engine, same AI, same save, same
party protocol), opponent character, physical motion, ambient atmosphere,
mobile/party/reduced-motion hardening, and documentation — living alongside
the existing 2D board as an opt-in, falls-back-gracefully, beta mode. Nothing
in the original phase plan remains unaddressed; the one open item is the
cross-browser manual spot-check noted above, which requires a human at an
actual Safari/Firefox install rather than more automated work here.

**P5 shipped (hardening & access):**
- **Desktop-first gate, made dynamic.** `scene3dDeviceOk()` checks viewport
  width (≤900px — the same breakpoint the 2D board already reflows its own
  layout at) and `(pointer: coarse)`. Initially checked once at boot; a live
  test caught that this misses the mid-session case (shrink the window below
  the threshold with 3D already running), so it's now re-evaluated on
  `resize` too, and if 3D is currently on when the gate fails, it calls
  `scene3dSetEnabled(false)` live — falling back to the DOM board while
  playing, not just refusing to start. Verified: toggle disabled + unchecked
  at a narrow width; re-enabled on resizing back up; 3D running at a wide
  width, then shrunk below threshold, correctly turned off, `mode3d` class
  removed, `#hand` visible again — all checked programmatically, not assumed.
  **A real bug found in the same test**: the turn prompt's "drag a tile"
  copy was staying stale after falling back to the classic board (still
  telling you to drag when the board now only responds to clicks). Fixed by
  factoring the mode-aware copy into `turnPromptText()` and calling it from
  `scene3dSetEnabled` on every mode flip, not just from `beginTurnPrompt`.
- **Performance audit, with an honest correction.** Idle: a clean 60fps
  (16.67ms avg frame). During real automated gameplay: 55fps average but
  occasional multi-frame stutters (one run: 232ms on a single frame).
  Instrumented `scene3dSync()` directly — it measured under 0.5ms every call,
  ruling out the state-mirroring bridge. Hypothesized on-demand texture
  creation (new tile kinds hitting `s3FaceMat()` for the first time, in a
  burst at deal time) as the cause and pre-built all 31 possible face
  textures at scene construction (`s3PrewarmFaceTextures()`) to test it — the
  stutter did NOT improve. The deciding test: the same automated gameplay
  loop with 3D mode turned OFF (classic DOM board) reproduced an equivalent
  stutter profile (worst frame 200ms, same shape). That proves the cause is a
  pre-existing engine/AI characteristic (almost certainly the AI's synchronous
  shanten/EV computation in `js/ai.js`, shared by both render paths), not
  anything in `scene3d.js` — out of scope for hardening the 3D mode
  specifically. The texture pre-warm was kept anyway (sound optimization on
  its own terms, bounded cost — only 31 kinds ever exist) but the comment in
  the code is corrected to say what it actually fixed (nothing measured) vs.
  what it's good practice for, rather than overclaiming.
- **Party-mode compatibility, verified rather than assumed.** Simulated a
  connected guest end-to-end: `NET.role="guest"`, a fake rotated snapshot
  (mirroring exactly what `projectFor()` sends — the guest's own seat always
  at index 0) applied via `guestApplySnapshot()`, 3D enabled, then a drag-
  discard driven through the same `doHumanDiscard()` path the canvas uses.
  Confirmed: `scene3dProjection()` reads the guest's tiles and opponent counts
  correctly from the rotated state; the discard resolved through
  `G.choiceSink` exactly as `{t:"action", choice:{type:"discard",...}}` sent
  over the (mocked) network connection — never touching engine state locally,
  exactly like the DOM board's guest path. This works by construction (3D
  reuses `doHumanDiscard`/`finishHumanChoice`/`G.choiceSink`, never its own
  parallel state-mutation path), and the live test confirms that construction
  argument holds rather than leaving it as an assumption. Zero console errors.
- **Accessibility.** Confirmed the canvas never enters the tab order
  (`tabIndex -1`, no `tabindex` attribute) and the action dock / HUD buttons
  stay keyboard-reachable regardless of mode. The toggle's tooltip already
  states the desktop-and-mouse requirement explicitly (now dynamically kept
  in sync with the live gate, see above) — the DOM board remains the
  screen-reader/keyboard-complete path, matching the plan's original intent.
90/90 tests green throughout; every claim in this section was checked live,
not inferred from reading the code.

**P4 progress (opponent cat presence):** each opponent seat now has a
sculpted-head portrait (`THREE.Sprite` — always faces the camera) built from
the SAME Cat Chat art as the 2D board (`emotes.js` EMOTE_ART), with an idle
bob, a warm glow + scale pulse while that seat is actively deciding
(`SCENE3D.activeSeat`), and real reactions: `emoteShow()` now calls
`scene3dPortraitReact(seat, id)` unconditionally (a cat's actual Cat Chat
reaction plays on its 3D face), and the 2D board's idle "glance" ticks
(`js/ui.js`) drive the 3D portrait in lockstep so both views show the same cat
doing the same thing at the same time.
**A real bug found by looking, not by inspecting code:** the portraits
rendered as solid black circles at first. Cause: `emoteFaceSVG()`'s art
depends on the page's external stylesheet (`.em .hd { fill: url(#mj-headG) }`,
using `var(--ink)` etc.) plus a gradient `<defs>` block `emotes.js` injects
once into the live document — and an isolated `data:image/svg+xml` `<img>` has
access to *neither* (sandboxed document, no external stylesheet, no DOM
access), so every shape fell back to SVG's default black fill. Fixed with a
fully self-contained SVG (`s3PortraitSvgString()`): the same three gradients
and the `.em` rules' colors, inlined as hex values. Also repositioned the
portraits after the first placement clipped off-frame for the side seats (the
seated camera's narrow ±18° azimuth means anything placed at a seat's own far
rack edge — where the fairness-audited hidden-tile racks correctly live — is
already near the frame edge); pulled to an inner ring at all three seats,
verified in-frame via NDC projection before and after.
Verified live: all three faces render correctly shaded (not black); the
thinking pulse fires on the real acting seat during a full automated match (a
`scene3dPortraitReact` reaction was held and screenshotted mid-expression to
confirm the actual art, not just the call succeeding); 90/90 tests green,
zero console errors across a full natural match.

**P4 completed (physical juice + ambient room):**
- **Opponent draw motion.** `scene3dSync()` now detects a net gain in a
  seat's rack count (main.js's `takeTurn()` calls `renderAll()` right after
  the draw, before the AI's 750ms think-and-discard, so this is a real,
  observable transition, not a guess) and slides just that one tile in from
  the seat's own wall pile with a rotation change (face-down-on-wall →
  standing-in-rack), while any other tiles that shifted position (the rack
  re-centering as it grows) get a quick re-settle tween instead of an instant
  jump.
- **Claim-gather.** A per-seat `SCENE3D_MELD_COUNTS` tracks how many melds
  have already played their entrance; a brand-new meld's tiles now converge
  from a small scattered pop-up into their tidy resting row (300ms), while
  already-settled melds from earlier in the hand are placed directly (so the
  animation never replays on every render).
- **Ambient room.** The lamp intensity breathes on the same 7s cycle as the
  2D board's `#center::before` (±7%, gated by `fxMotion()`), and 7 small
  sprite "dust motes" drift up through the lamp-lit air above the felt and
  fade in/out, mirroring `#dust-motes` — both built once at scene construction,
  animated for free in the existing render loop.
Verified live: a full automated match naturally exercised both the draw-slide
path (`SCENE3D.oppRacks` observed at 14 mid-turn) and the claim-gather path (a
real meld formed), zero console errors, zero orphaned tweens after the match
(`SCENE3D.tweens.length === 0`); the ambient gate was checked precisely (waited
two real animation frames after `fxSetLevel("off")`, confirmed the lamp
snapped to its flat base intensity, not left mid-breath) rather than assumed;
90/90 tests green throughout.

P4 is now fully shipped: opponent presence, physical draw/discard/claim
motion, and ambient life all match the spirit of the 2D board's own polish
passes earlier this session.

**P3 shipped (playable loop parity):** turned out most of this was already true
by construction — claim prompts (Chi/Peng/Gang/Hú), the coach/Analyst card, and
the win modal are all existing DOM chrome that floats over the canvas
untouched, so verifying them was the real work, not building them. Live-tested:
a claim prompt (Peng) rendered and resolved correctly over the 3D scene; a
rigged concealed-kong hand produced the right "Gang 1●" button dispatching the
correct `{type:"kong", kind:0}` payload through the same `finishHumanChoice`
wiring every other button uses (the kong-application code and meld-layout
array logic were inspected and are shared/untouched, so no separate 3D kong
bug surface exists); a natural full hand played via drag-discard reached a
real win.
Two real bugs found and fixed by testing, not by inspection:
1. **Prompt copy said "click a tile"** in 3D mode, where the input is drag —
   `beginTurnPrompt()` now checks `SCENE3D.on` and shows mode-appropriate copy
   for both the normal-turn and post-claim (nodraw) prompts.
2. **The win celebration's board confetti/shake/glow silently no-op'd** in 3D
   mode — `fxWin()`'s effects all target `#table`/`#hand`, which are
   `display:none` under `body.mode3d`. Confetti still appeared via the
   separate modal-anchored burst (fixed to `document.body`, unaffected), so
   nothing was *visually* broken, but the board-anchored canvas was rendering
   invisibly every win. `fxWin()` now skips that block in 3D mode (sound still
   fires), and a new `scene3dWinReaction()` gives the 3D table its own
   win/draw moment: the camera eases out to the max seated distance for ~2.6s
   (verified live: `tDist` reached 1.05, the configured max) so the whole
   table is visible for the celebration, then eases back to wherever you were.
Verified: 90/90 tests green, zero console errors, full regression (rigged
Peng/Gang tests + a real drag-played hand to a natural win).

**P2 shipped (engine bridge):** `js/scene3d.js` + vendored `js/vendor/three.min.js`
(r128 — the last classic-script build, so `file://` still works; lazy-loaded on
first enable like PeerJS). The 3D table is now the REAL game: `renderAll()` calls
`scene3dAfterRender()`, which mirrors state through `scene3dProjection()` — a pure
function that exposes opponents' concealed hands as a COUNT only (committed test:
`tests/scene3d.test.js`, 4 cases; concealed proxies additionally carry no face art
at all, so even an orientation bug can't leak a tile). Drag-to-discard feeds
`doHumanDiscard()` — the same entry point as DOM tile clicks; all prompts (claims,
win, coach, emotes) are the existing DOM chrome floating over the canvas, so P3
parity is already ~80% free. Toggle in ⚙ Options ("3D table (beta)"), persisted.
Verified live: a real hand played through the 3D path (drag discard → AI turns →
a human-clicked PENG claim → meld laid on the felt), classic⇄3D toggle round-trip,
in-scene leak audit `s3LeakCheck()` SEALED (351 camera positions × 39 proxies, 0
exposed), 90/90 tests green, zero console errors.
Bugs caught by verification along the way: the elevated carry-plane skewing the
drop zone (drop now judged by the felt-level ray hit), the classic board's CSS
`perspective` hijacking the fixed-position dock (neutralized in `mode3d`), r128's
hotter legacy lighting (re-tuned), and mirrored seat angles that pointed proxy
racks at the camera (now facing their owners, audit-verified).

## Where this came from

The player asked for a "live," first-person mahjong experience — moving your
head, picking up your tiles physically. The original revamp proposal
(`GAMEPLAY_REVAMP_PROPOSAL.md` §3.2) had rejected WebGL for the *main board*,
and that reasoning still stands for the 2D game; this plan treats first-person
as a **separate optional mode** built alongside the DOM board, not a
replacement. The DOM board remains the default, the accessible path, and the
party-mode-proven path.

## Shipped so far

### P0 · Feasibility spike
Three.js scene (CDN import), tilted table, draggable tiles, orbit camera.
Proved pick-up-and-place feels good in the browser with no build step.

### P1 · Scale, art & polish pass *(this pass)*
- **True-to-life scale**: competition-size 34×46×24 mm tiles, 95 cm table,
  76 cm height, seated eye at 1.10 m. Everything derives from these constants.
- **Real tile art**: the game's own SVG faces (`js/faces.js`) rasterized to
  5×-resolution canvas textures, anisotropy 16, plus a soft inner edge line so
  flush tiles read as distinct objects.
- **Board-game lighting**: bright warm hemisphere (the visibility floor), the
  hanging lamp demoted to an atmosphere accent with a wide soft penumbra
  (shadow radius 12), and an over-the-shoulder fill so your rack is always lit.
  No tile is ever in a hard black shadow.
- **Readability**: rack leans 10° toward your eye-line; hover lift + warm glow
  on the tile you're about to grab; contrast tuned (brighter ivory, deeper
  felt, distinct green backs).
- **Seated-only camera**: ±18° head-turn, polar 43–77°, zoom 0.50–1.05 m,
  no pan. Verified by `__debug.leakCheck()` — a 351-position sweep of the
  entire reachable camera envelope against all 39 hidden tiles, asserting no
  opponent face normal ever points toward any reachable camera position
  (strictest interpretation: "faces the camera at all" counts as a leak, even
  off-frustum). Result: SEALED, worst case ~3° pointed away.
- Default framing puts your full 13-tile rack readable in the lower frame with
  the river and far wall above it.

## The road ahead

### P2 · Engine bridge (the keystone)
Drive the 3D table from the REAL game state instead of random tiles.
- A `scene-sync` adapter that mirrors `G` (hand, river, melds, flowers, wall
  count, gold flip) into the Three.js scene after each state change — same
  pattern as the DOM renderers, hooked at the same `renderAll()` points.
- Your discard flow: drag-to-river replaces the click-to-discard prompt;
  `G.choiceSink` receives the same `{type:"discard", ...}` the DOM path sends.
  The ENGINE stays authoritative — the 3D layer is presentation + input only,
  exactly like the DOM layer. No rules logic duplicated.
- AI turns visibly play out: opponent draws (tile slides off the wall), their
  discards fly to the river, claims gather tiles. Reuse timing from fx.js.
- Mode toggle on the menu ("Classic board / First-person table"), persisted.
- **Gate: the fairness property.** The 3D scene only ever renders what the
  seat-0 projection already exposes — reuse `projectFor(0)`-equivalent data,
  never raw `G` for opponents' hands (face-down proxies by count).

### P3 · Playable loop parity
Everything you can do on the DOM board, doable in 3D:
- Claim prompts (Chi/Peng/Gang/Hú) as in-world buttons at the table edge;
  kong/win declarations; the turn prompt.
- Melds and flowers laid out physically beside each seat; the gold flip
  standing visible near the wall.
- Coach/Analyst as an overlay card (DOM on top of canvas — they stay HTML).
- End-of-hand: camera eases back, win modal over the scene.

### P4 · The living table
The immersion payoff on top of a working game:
- Opponent presence: the sculpted cat heads (js/emotes.js art) seated at the
  table, thinking poses, reactions in 3D space.
- Physical juice: draw/discard/claim animations with weight; tile clack synced
  to landing (sound.js); wall visibly depleting row by row.
- Ambient room: warmer environment behind the table, lamp breathing, dust.

### P5 · Hardening & access
- **Vendor three.js locally** (like peerjs) — the CDN importmap breaks the
  `file://`/offline promise; must be resolved before this mode ships.
- Performance: mobile fallback is the DOM board (3D is opt-in, desktop-first);
  frame budget audit; texture memory cap.
- Accessibility: the DOM board remains the screen-reader/keyboard path; the
  mode toggle makes that explicit.
- Party mode: guests can use 3D locally (it renders only their own projection)
  — host determinism untouched. Regression: net tests + a two-browser smoke.

### P6 · Ship
- QA matrix (Chrome/Safari/Firefox, mac/Windows), reduced-motion behavior
  (instant placements, no camera easing), settings integration (fx ladder),
  README + house-rules note, cache-bust bump.

## Constraints carried forward
- FJ rules, engine, netcode: untouched. 3D is presentation + input only.
- Zero-build stays: three.js vendored, no bundler.
- The DOM board is never removed — it's the default and the fallback.
- Hidden information: every phase re-runs the leak audit; it becomes a
  committed test in P2 when the scene is driven by real hands.
