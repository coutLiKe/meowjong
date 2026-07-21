"use strict";
/* ============================================================
   Meowjong — first-person 3D table (P2: engine bridge)

   An OPTIONAL presentation+input layer over the same engine as
   the DOM board. The engine stays authoritative: this file only
   (a) mirrors game state into a Three.js scene after renderAll()
   and (b) feeds your discard back through doHumanDiscard(), the
   exact entry point the DOM tiles use. No rules logic lives here.

   FAIRNESS GATE: everything rendered comes from scene3dProjection()
   below — a pure function that, like net.js's projectFor(), exposes
   opponents' concealed hands as a COUNT ONLY. The scene never touches
   G.seats[i>0].hand contents, so no camera angle, debugger, or bug in
   the mesh code can leak a hidden tile it never received. Committed
   test: tests/scene3d.test.js.

   three.js is vendored (js/vendor/three.min.js, r128 — the last
   classic-script build, so file:// keeps working) and lazy-loaded
   on first enable, exactly like PeerJS.
   ============================================================ */

/* ---------- the projection (pure, unit-tested) ---------- */

function scene3dProjection(g) {
  const me = (g.seats && g.seats[0]) || {};
  return {
    myTiles: (me.hand || []).slice(),
    myDrawn: me.drawn == null ? null : me.drawn,
    myMelds: (me.melds || []).map(m => ({ type: m.type, kind: m.kind })),
    myFlowers: (me.flowers || []).slice(),
    opp: [1, 2, 3].map(i => {
      const s = (g.seats && g.seats[i]) || {};
      return {
        count: (s.hand || []).length,          // count ONLY — never the kinds
        melds: (s.melds || []).map(m => ({ type: m.type, kind: m.kind })),
        flowers: (s.flowers || []).slice(),
      };
    }),
    river: (g.river || []).map(d => ({ kind: d.kind, seat: d.seat })),
    wallLen: (g.wall && g.wall.length) || 0,
    wildFlip: g.wildFlip == null ? null : g.wildFlip,
    activeSeat: g.activeSeat == null ? null : g.activeSeat,
    suggestKind: g.suggestKind == null ? null : g.suggestKind,
    hasLastDiscard: !!g.lastDiscard,   // public: is the newest river tile claimable right now?
  };
}

/* ---------- real-world scale (metres), from the approved prototype ---------- */
const S3_TILE_W = 0.034, S3_TILE_H = 0.046, S3_TILE_T = 0.024;
const S3_TABLE = 0.95, S3_TOP = 0.76, S3_LIP = 0.008;
const S3_FELT_Y = S3_TOP + S3_LIP;
const S3_HAND_Z = S3_TABLE / 2 - 0.105;
/* Polish pass: real racks have visible seams between tiles — the old 2.2mm
   gaps read as one continuous slab from the seated camera (user-flagged with
   annotated screenshots). 4.5mm between standing tiles / 3.5mm in the wall
   keeps rows compact but lets each tile read as its own object. */
const S3_GAP_RACK = 0.0045, S3_GAP_WALL = 0.0035;

const SCENE3D = {
  on: false, ready: false, failed: false,
  renderer: null, scene: null, camera: null, canvas: null,
  hand: [], oppRacks: [[], [], []], river: [], wall: [], publicTiles: [], dust: [],
  goldMesh: null, goldRing: null, turnDisc: null, lamp: null,
  faceMats: new Map(), tweens: [],
  hintTiles: [],   // this sync's hand meshes matching the coach's suggested discard kind
  dragging: null, hovered: null, lastDrop: null,
  cam: { az: 0, pol: Math.PI * 0.33, dist: 0.72, tAz: 0, tPol: Math.PI * 0.33, tDist: 0.72 },
  maxWall: 1,
  raf: 0,
  // polish pass: the automatic-table ceremony + authentic wall break
  handNo: -1, wallBreak: null,
  stagingUntil: 0, pendingSync: false, stageRise: null, _stagingTimer: 0,
  panelEl: null, panelBottomPx: -1,
};

/* ---------- P5: desktop-first gate ----------
   The 3D table is opt-in and desktop-first by design (plan §P5) — a WebGL
   scene plus drag-based tile interaction is a rough fit for a small touch
   screen, and the DOM board is the tested, accessible, always-available
   fallback. Narrow viewport OR a coarse (touch-primary) pointer disqualifies
   the device; checked both when the toggle is wired up and defensively
   inside scene3dSetEnabled itself, so a stale "on" flag from localStorage
   (e.g. desktop session synced/copied to a phone) can never force a heavy
   scene onto a device it wasn't verified on. */
function scene3dDeviceOk() {
  try {
    const narrow = window.innerWidth <= 900;
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    return !narrow && !coarse;
  } catch (e) { return true; }   // matchMedia/innerWidth unsupported: don't block on a guess
}

/* ---------- lazy three.js loader (mirrors ensurePeerLib) ---------- */
let _threePromise = null;
function ensureThreeLib() {
  if (typeof THREE !== "undefined") return Promise.resolve(true);
  if (_threePromise) return _threePromise;
  _threePromise = new Promise(resolve => {
    const s = document.createElement("script");
    s.src = "js/vendor/three.min.js";
    s.onload = () => resolve(typeof THREE !== "undefined");
    s.onerror = () => { _threePromise = null; resolve(false); };
    document.head.appendChild(s);
  });
  return _threePromise;
}

/* ---------- materials ---------- */
function s3FaceMat(kind) {
  if (SCENE3D.faceMats.has(kind)) return SCENE3D.faceMats.get(kind);
  const c = document.createElement("canvas");
  c.width = 300; c.height = 420;
  const ctx = c.getContext("2d");
  const ivory = ctx.createLinearGradient(0, 0, 50, 420);
  ivory.addColorStop(0, "#fffffb"); ivory.addColorStop(1, "#f6f1e4");
  ctx.fillStyle = ivory; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(120,100,70,0.35)"; ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 16;
  const img = new Image();
  img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height); tex.needsUpdate = true; };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(tileFaceSVG(kind));
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, metalness: 0.03 });
  SCENE3D.faceMats.set(kind, mat);
  return mat;
}

/* P5 perf: a minor, low-risk front-load — only 31 tile kinds ever exist
   (0..30), so build every face texture once at scene construction instead of
   scattering first-use canvas-draw + SVG-decode calls through gameplay
   whenever a hand happens to contain a kind not seen yet.
   NOTE: this was investigated as a candidate fix for occasional multi-frame
   stutters (one measured run: 232ms on a single frame) observed during
   automated play. It did NOT fix them — a follow-up A/B measurement with 3D
   mode OFF (the classic DOM board) reproduced an equivalent stutter profile
   (worst frame 200ms, same frame count), proving the cause is a pre-existing
   engine/AI characteristic (almost certainly the AI's synchronous shanten/EV
   computation in js/ai.js), not anything in this file, and out of scope for
   hardening the 3D mode specifically. Kept anyway as a sound optimization on
   its own merits — see docs/FIRSTPERSON_3D_PLAN.md's P5 section. */
function s3PrewarmFaceTextures() {
  for (let k = 0; k <= 30; k++) s3FaceMat(k);
}
let _s3Side, _s3Back, _s3Geo, _s3EdgeGeo, _s3EdgeMat;
function s3MakeTile(kind) {   // kind === null → back-only proxy (a hidden tile)
  const face = kind == null ? _s3Back : s3FaceMat(kind);
  const m = new THREE.Mesh(_s3Geo, [_s3Side, _s3Side, _s3Side, _s3Side, face, _s3Back]);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.kind = kind;
  if (_s3EdgeGeo) m.add(new THREE.LineSegments(_s3EdgeGeo, _s3EdgeMat));   // the seam outline
  return m;
}

/* ---------- table-surface textures (canvas — zero assets, built once) ---------- */
let _s3FeltTex = null, _s3WoodTex = null;
function s3FeltTexture() {
  if (_s3FeltTex) return _s3FeltTex;
  // fidelity pass: 1024² (was 512²) — the felt fills most of the frame, so
  // texel density is the single biggest sharpness win; still built once, at
  // scene construction, from zero assets
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d");
  x.fillStyle = "#79a26b"; x.fillRect(0, 0, S, S);
  // fibre noise — thousands of faint flecks read as brushed cloth
  for (let i = 0; i < 16000; i++) {
    x.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.045)" : "rgba(255,255,255,0.035)";
    x.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
  }
  // soft vignette so the table centre glows and edges settle
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.23, S / 2, S / 2, S * 0.74);
  g.addColorStop(0, "rgba(255,246,214,0.10)");
  g.addColorStop(0.65, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.16)");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // an inner stitched border ring, like a real mahjong mat
  x.strokeStyle = "rgba(38,66,40,0.30)"; x.lineWidth = 10;
  x.strokeRect(52, 52, S - 104, S - 104);
  _s3FeltTex = new THREE.CanvasTexture(c);
  _s3FeltTex.encoding = THREE.sRGBEncoding;
  _s3FeltTex.anisotropy = 8;   // stays sharp at the camera's grazing angle
  return _s3FeltTex;
}
function s3WoodTexture() {
  if (_s3WoodTex) return _s3WoodTex;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d");
  const base = x.createLinearGradient(0, 0, 512, 0);
  base.addColorStop(0, "#6b4f34"); base.addColorStop(0.5, "#75563a"); base.addColorStop(1, "#644a30");
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  // long-grain streaks with slight waver
  for (let i = 0; i < 46; i++) {
    const y0 = Math.random() * 512, amp = 2 + Math.random() * 5;
    x.strokeStyle = Math.random() < 0.5 ? "rgba(46,31,18,0.16)" : "rgba(150,112,74,0.13)";
    x.lineWidth = 0.8 + Math.random() * 1.8;
    x.beginPath();
    for (let px = 0; px <= 512; px += 16) x.lineTo(px, y0 + Math.sin(px / 90 + i) * amp);
    x.stroke();
  }
  _s3WoodTex = new THREE.CanvasTexture(c);
  _s3WoodTex.encoding = THREE.sRGBEncoding;
  return _s3WoodTex;
}

/* seat frames: rotating local coords by the seat's angle puts +z toward that
   seat's owner. seat0=you (south) · seat1=your RIGHT (plays after you, matching
   the classic board) · seat2=across · seat3=your left */
const S3_SEAT_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
function s3SeatXZ(seat, lx, lz) {
  const a = S3_SEAT_ANGLE[seat];
  return [lx * Math.cos(a) + lz * Math.sin(a), -lx * Math.sin(a) + lz * Math.cos(a)];
}

/* ---------- scene construction ---------- */
function s3Build() {
  const T = THREE;
  SCENE3D.canvas = document.createElement("canvas");
  SCENE3D.canvas.id = "scene3d-canvas";
  document.body.appendChild(SCENE3D.canvas);
  const renderer = new T.WebGLRenderer({ canvas: SCENE3D.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding;
  SCENE3D.renderer = renderer;

  const scene = new T.Scene();
  scene.background = new T.Color(0x2b1e15);
  scene.fog = new T.Fog(0x2b1e15, 3.2, 9.0);
  SCENE3D.scene = scene;

  const camera = new T.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.02, 30);
  SCENE3D.camera = camera;

  // r128 legacy (non-physical) lighting runs hotter than modern three.js —
  // these values are tuned by eye against the approved prototype's look
  scene.add(new T.HemisphereLight(0xfff1d8, 0x40301f, 0.58));
  const lamp = new T.PointLight(0xffdca0, 0.85, 5, 2);
  lamp.position.set(0, 1.75, -0.05);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.radius = 12;
  lamp.shadow.bias = -0.0004;
  scene.add(lamp);
  SCENE3D.lamp = lamp;
  SCENE3D.lampBase = lamp.intensity;
  const fill = new T.DirectionalLight(0xfff6e6, 0.30);
  fill.position.set(0.25, 1.5, 1.2);
  scene.add(fill);
  // fidelity pass: a faint cool rim light from behind-above separates tile
  // tops from the felt and gives standing racks a crisp lit edge — the same
  // trick premium board-game renderers use to keep pieces from flattening
  const rim = new T.DirectionalLight(0xd8e4ff, 0.16);
  rim.position.set(-0.3, 1.2, -1.4);
  scene.add(rim);

  const wood = new T.Mesh(new T.BoxGeometry(S3_TABLE + 0.12, 0.05, S3_TABLE + 0.12),
    new T.MeshStandardMaterial({ map: s3WoodTexture(), roughness: 0.5, metalness: 0.04 }));
  wood.position.set(0, S3_TOP - 0.02, 0); wood.receiveShadow = wood.castShadow = true;
  scene.add(wood);
  const felt = new T.Mesh(new T.BoxGeometry(S3_TABLE, S3_LIP * 2, S3_TABLE),
    new T.MeshStandardMaterial({ map: s3FeltTexture(), roughness: 0.97 }));
  felt.position.set(0, S3_TOP, 0); felt.receiveShadow = true;
  scene.add(felt);
  const floor = new T.Mesh(new T.PlaneGeometry(20, 20),
    new T.MeshStandardMaterial({ color: 0x1c130d, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);

  // tile bodies: a hint of gloss (real melamine tiles are slightly shiny),
  // sides a shade deeper than the faces so every tile edge reads as an edge
  _s3Side = new T.MeshStandardMaterial({ color: 0xefe8d6, roughness: 0.34, metalness: 0.03 });
  _s3Back = new T.MeshStandardMaterial({ color: 0x53855c, roughness: 0.42, metalness: 0.03 });
  _s3Geo = new T.BoxGeometry(S3_TILE_W, S3_TILE_H, S3_TILE_T);
  // shared subtle edge outline — the cheapest honest "bevel": a dark seam
  // along every tile arris so flush tiles never fuse into one slab
  _s3EdgeGeo = new T.EdgesGeometry(_s3Geo);
  _s3EdgeMat = new T.LineBasicMaterial({ color: 0x6b5c46, transparent: true, opacity: 0.28 });

  // active-turn marker: a soft glowing disc that moves to the acting seat's edge
  const disc = new T.Mesh(new T.CircleGeometry(0.025, 24),
    new T.MeshBasicMaterial({ color: 0xffb85c, transparent: true, opacity: 0.85 }));
  disc.rotation.x = -Math.PI / 2;
  disc.visible = false;
  scene.add(disc);
  SCENE3D.turnDisc = disc;

  // last-discard marker: a slim gold ring lying flat under the newest river
  // tile, pulsing gently — identifies the claimable tile at a glance without
  // covering any part of its face (it peeks out around the tile's footprint)
  const ring = new T.Mesh(new T.RingGeometry(0.0295, 0.0365, 32),
    new T.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.5,
      side: T.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  SCENE3D.discardRing = ring;

  // gold marker: same idea, under the flipped wild tile — a ring, not a tint
  // on the face itself, so the printed pips/characters stay fully legible
  // (an emissive tint on the face previously washed out the ink)
  const goldRing = new T.Mesh(new T.RingGeometry(0.0295, 0.0365, 32),
    new T.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.5,
      side: T.DoubleSide, depthWrite: false }));
  goldRing.rotation.x = -Math.PI / 2;
  goldRing.visible = false;
  scene.add(goldRing);
  SCENE3D.goldRing = goldRing;

  s3PrewarmFaceTextures();
  s3BuildPortraits();
  s3BuildDustMotes();
  s3InitCamera();
  s3InitInput();
}

/* ---------- ambient: dust motes drifting through the lamp light ----------
   Mirrors the 2D board's #dust-motes (css/style.css) — a real light source
   isn't perfectly still, and a room under one has motes in the air. Sprites
   (not a particle BufferGeometry) because there are only ~7 of them and a
   plain per-sprite sine drift is simpler to reason about at this count. */
let _s3DustTex = null;
function s3DustTexture() {
  if (_s3DustTex) return _s3DustTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,248,224,0.95)");
  g.addColorStop(1, "rgba(255,248,224,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  _s3DustTex = new THREE.CanvasTexture(c);
  return _s3DustTex;
}
function s3BuildDustMotes() {
  const tex = s3DustTexture();
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const size = 0.004 + Math.random() * 0.003;
    s.scale.set(size, size, 1);
    const ang = Math.random() * Math.PI * 2, rad = Math.random() * 0.22;
    s.userData.baseX = Math.cos(ang) * rad;
    s.userData.baseZ = Math.sin(ang) * rad * 0.6 - 0.08;
    s.userData.phase = Math.random() * Math.PI * 2;
    s.userData.speed = 0.10 + Math.random() * 0.10;
    s.userData.drift = (Math.random() - 0.5) * 0.03;
    SCENE3D.scene.add(s);
    SCENE3D.dust.push(s);
  }
}
function s3AnimateDust(t) {
  for (const s of SCENE3D.dust) {
    const cycle = ((t * s.userData.speed + s.userData.phase) % (Math.PI * 2)) / (Math.PI * 2);
    s.position.set(s.userData.baseX + s.userData.drift * cycle, S3_FELT_Y + 0.05 + cycle * 0.32, s.userData.baseZ);
    s.material.opacity = Math.sin(cycle * Math.PI) * 0.32;
  }
}

/* ---------- opponent cat presence: sculpted-head portrait sprites ----------
   Reuses the Cat Chat face art (js/emotes.js: emoteFaceSVG) exactly like the
   2D board's always-on .opp-portrait — but as a THREE.Sprite, which always
   faces the camera automatically, so the cat reads clearly from any seated
   angle. Idle: a gentle bob. Their turn: a warm glow + scale pulse. A real
   Cat Chat reaction (emoteShow) swaps the face for a few seconds, and the
   2D board's idle "glance" ticks (js/ui.js) drive this in lockstep so both
   views show the same cat doing the same thing at the same time. */
const SCENE3D_PORTRAITS = [null, null, null];   // indexed by seat-1

/* emoteFaceSVG()'s art depends on the page's external stylesheet (`.em .hd
   { fill: url(#mj-headG) }` etc., using var(--ink) and friends) PLUS a
   gradient <defs> block emotes.js injects once into the live document body.
   An isolated `data:image/svg+xml` <img> has access to NEITHER — it's a
   sandboxed document with no external stylesheet and no access to the host
   page's DOM — so every shape silently falls back to SVG's default fill
   (black), which is exactly the solid black circle this rendered as before
   this was diagnosed. Fix: a fully self-contained SVG with the same
   gradients and colors INLINED, built once and reused for every portrait. */
const S3_EMOTE_DEFS =
  '<defs>' +
  '<radialGradient id="mj-headG" cx="36%" cy="30%" r="82%">' +
  '<stop offset="0%" stop-color="#fffef9"/><stop offset="45%" stop-color="#f8ecd2"/>' +
  '<stop offset="85%" stop-color="#e5cfa6"/><stop offset="100%" stop-color="#d2b789"/></radialGradient>' +
  '<radialGradient id="mj-earG" cx="40%" cy="30%" r="80%">' +
  '<stop offset="0%" stop-color="#f5ab7e"/><stop offset="100%" stop-color="#d2703f"/></radialGradient>' +
  '<radialGradient id="mj-shadeG" cx="50%" cy="50%" r="50%">' +
  '<stop offset="0%" stop-color="rgba(74,52,38,.20)"/><stop offset="70%" stop-color="rgba(74,52,38,0)"/></radialGradient>' +
  '</defs>';
/* --ink #4a3426 · --accent #e8895a · --accent-dark #c96b3d · --yarn #4a7fb5 ·
   --d-red #c0392b — the same values as :root in css/style.css, hardcoded
   because CSS custom properties don't cross into an isolated SVG image
   either (no cascade from the host document). */
const S3_EMOTE_STYLE =
  '<style>' +
  '.hd{fill:url(#mj-headG);stroke:#4a3426;stroke-width:2.2}' +
  '.fl{fill:url(#mj-headG);stroke:#4a3426;stroke-width:2.2;stroke-linejoin:round}' +
  '.fi{fill:url(#mj-earG);opacity:.85}' +
  '.wh{stroke:#4a3426;stroke-width:2;stroke-linecap:round;fill:none}' +
  '.ln{stroke:#4a3426;stroke-width:2.8;stroke-linecap:round;fill:none}' +
  '.fill{fill:#4a3426}.ns{fill:#c96b3d}.bl{fill:#e8895a;opacity:.45}.tong{fill:#e8895a}' +
  '.eye{fill:#fff;stroke:#4a3426;stroke-width:2.5}' +
  '.tr{stroke:#4a7fb5;stroke-width:2.5;fill:none;stroke-linecap:round}.trf{fill:#4a7fb5}' +
  '.hx{fill:#c0392b}.hxln{stroke:#c0392b;stroke-width:2.4;stroke-linecap:round;fill:none}' +
  '.ztxt{fill:#4a3426}.qtxt{fill:#c96b3d}.flag{fill:#c96b3d}.flagtxt{fill:#fff;font-weight:800}' +
  '.cf1{fill:#7fa877}.cf2{fill:#e8895a}.cf3{fill:#ffd65a}.cf4{fill:#6b5ea8}' +
  '</style>';
function s3PortraitSvgString(faceId) {
  const art = (typeof EMOTE_ART !== "undefined" && EMOTE_ART[faceId]) || "";
  const sculpt = typeof EM_SCULPT !== "undefined" ? EM_SCULPT : "";
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
    S3_EMOTE_DEFS + S3_EMOTE_STYLE + art + sculpt + "</svg>";
}

function s3DrawPortrait(canvas, faceId) {
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas._tex.needsUpdate = true;
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s3PortraitSvgString(faceId));
}

function s3BuildPortraits() {
  if (typeof emoteFaceSVG !== "function") return;   // emotes.js not loaded (shouldn't happen; defensive)
  for (let o = 0; o < 3; o++) {
    const seat = o + 1;
    const canvas = document.createElement("canvas");
    canvas.width = 220; canvas.height = 220;
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    canvas._tex = tex;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.085, 0.085, 1);
    // Polish pass (user-annotated): at the old inner-ring position the heads
    // sat visually ON the walls and the gold flip. Now each cat hovers above
    // its OWN rack — outside the wall square, over its own green tile backs,
    // high enough to clear the rack tops — like a player behind their tiles.
    // Slightly smaller so they read as companions, not obstructions. In-frame
    // at the (now farther-back) default camera; verified via NDC projection.
    // the across seat sits deepest in the frame — at the shared height its head
    // clips behind the top HUD, so it rides a little lower than the side cats
    const [x, z] = s3SeatXZ(seat, 0, 0.335);
    sprite.position.set(x, S3_FELT_Y + (seat === 2 ? 0.125 : 0.185), z);
    SCENE3D.scene.add(sprite);
    SCENE3D_PORTRAITS[o] = { sprite, canvas, seat, baseY: sprite.position.y, baseScale: 0.085, glanceTimer: null };
    s3DrawPortrait(canvas, "happy");
  }
}

/* Called from emoteShow() (emotes.js) for every reaction, cat or human —
   it's a no-op for seat 0 (you have no 3D portrait) or while off/not built. */
function scene3dPortraitReact(seat, id) {
  if (!SCENE3D.ready || seat < 1 || seat > 3) return;
  const p = SCENE3D_PORTRAITS[seat - 1];
  if (!p || !EMOTES[id]) return;
  s3DrawPortrait(p.canvas, id);
  clearTimeout(p.glanceTimer);
  p.glanceTimer = setTimeout(() => s3DrawPortrait(p.canvas, "happy"), 2600);
}

/* ---------- seated camera (custom controller — same limits as the prototype,
   verified leak-free there; s3LeakCheck() re-verifies live in this scene) ---------- */
const S3_CAM = {
  target: null, minAz: -Math.PI * 0.10, maxAz: Math.PI * 0.10,
  minPol: Math.PI * 0.24, maxPol: Math.PI * 0.43, minD: 0.50, maxD: 1.05,
};
function s3InitCamera() {
  S3_CAM.target = new THREE.Vector3(0, S3_TOP + 0.02, 0.10);
  const c = SCENE3D.cam;
  c.az = c.tAz = 0;
  // Polish pass: default seat pulled back (0.55 → 0.70m) and fractionally
  // higher, so the whole table — walls, river, all three opponents — reads at
  // a glance while your rack still fills the lower frame. Zoom range and the
  // leak-audited angle limits are unchanged; this only moves the STARTING
  // point within them.
  c.pol = c.tPol = Math.min(S3_CAM.maxPol, Math.max(S3_CAM.minPol, Math.PI * 0.305));
  c.dist = c.tDist = Math.min(S3_CAM.maxD, Math.max(S3_CAM.minD, 0.70));
  s3ApplyCamera();
}
function s3ApplyCamera() {
  const c = SCENE3D.cam;
  const sinP = Math.sin(c.pol), cosP = Math.cos(c.pol);
  SCENE3D.camera.position.set(
    S3_CAM.target.x + c.dist * sinP * Math.sin(c.az),
    S3_CAM.target.y + c.dist * cosP,
    S3_CAM.target.z + c.dist * sinP * Math.cos(c.az));
  SCENE3D.camera.lookAt(S3_CAM.target);
}

/* ---------- input: head-turn drag, lean zoom, tile pick/drag/place ---------- */
function s3InitInput() {
  const el = SCENE3D.canvas;
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(S3_FELT_Y + 0.09));   // carry height
  const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -S3_FELT_Y);        // drop target
  const hit = new THREE.Vector3();
  const feltHit = new THREE.Vector3();
  let look = null;
  let lastFeltHit = null;   // where on the TABLE the cursor points mid-drag — the carry
                            // plane is elevated, so its own x/z skews toward the player

  const setPtr = e => {
    ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
    ptr.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };
  const canDiscard = () =>
    SCENE3D.on && typeof G !== "undefined" && G.awaitingDiscard && G.turnCtx &&
    G.seats[0] && G.seats[0].control === "local";

  let lastTap = { t: 0, mesh: null };   // double-click-to-discard tracking
  el.addEventListener("pointerdown", e => {
    if (typeof s3SkipStaging === "function" && s3SkipStaging()) return;   // click skips the ceremony
    setPtr(e);
    ray.setFromCamera(ptr, SCENE3D.camera);
    if (canDiscard()) {
      const hits = ray.intersectObjects(SCENE3D.hand, false);
      if (hits.length) {
        const mesh = hits[0].object;
        const now = performance.now();
        // double-click = instant discard — the fastest path, alongside dragging
        if (now - lastTap.t < 350 && lastTap.mesh === mesh && typeof doHumanDiscard === "function") {
          lastTap = { t: 0, mesh: null };
          s3SetHover(null);
          SCENE3D.lastDrop = mesh.position.clone();   // the river tile flies from the rack slot
          doHumanDiscard(mesh.userData.handIdx);
          return;
        }
        lastTap = { t: now, mesh };
        s3SetHover(null);
        SCENE3D.dragging = mesh;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}   // capture is a nicety — never fatal
        return;
      }
    }
    lastTap = { t: 0, mesh: null };
    look = { x: e.clientX, y: e.clientY };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
  el.addEventListener("pointermove", e => {
    setPtr(e);
    if (SCENE3D.dragging) {
      ray.setFromCamera(ptr, SCENE3D.camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        SCENE3D.dragging.position.set(hit.x, S3_FELT_Y + 0.09, hit.z);
        SCENE3D.dragging.rotation.set(-Math.PI / 2 + 0.35, 0, 0);
      }
      if (ray.ray.intersectPlane(feltPlane, feltHit)) lastFeltHit = feltHit.clone();
      return;
    }
    if (look) {
      const c = SCENE3D.cam;
      c.tAz = Math.min(S3_CAM.maxAz, Math.max(S3_CAM.minAz, c.tAz - (e.clientX - look.x) * 0.004));
      c.tPol = Math.min(S3_CAM.maxPol, Math.max(S3_CAM.minPol, c.tPol - (e.clientY - look.y) * 0.003));
      look = { x: e.clientX, y: e.clientY };
      return;
    }
    ray.setFromCamera(ptr, SCENE3D.camera);
    const hits = canDiscard() ? ray.intersectObjects(SCENE3D.hand, false) : [];
    s3SetHover(hits.length ? hits[0].object : null);
  });
  const endDrag = () => {
    const d = SCENE3D.dragging;
    if (!d) { look = null; return; }
    SCENE3D.dragging = null;
    // judge the drop by where the cursor points ON THE TABLE (felt-level ray
    // hit), not by the elevated carry position — anywhere inside the wall
    // square counts as "into the discard pile"
    const p = lastFeltHit;
    lastFeltHit = null;
    const overRiver = p && Math.abs(p.x) < 0.17 && Math.abs(p.z) < 0.17;
    if (overRiver && typeof doHumanDiscard === "function") {
      SCENE3D.lastDrop = d.position.clone();
      doHumanDiscard(d.userData.handIdx);   // engine authoritative; sync will redraw
    } else {
      s3Tween(d, d.userData.homePos, d.userData.homeRot, 200);
    }
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("wheel", e => {
    e.preventDefault();
    const c = SCENE3D.cam;
    c.tDist = Math.min(S3_CAM.maxD, Math.max(S3_CAM.minD, c.tDist + e.deltaY * 0.0012));
  }, { passive: false });
  window.addEventListener("resize", () => {
    if (!SCENE3D.ready) return;
    SCENE3D.camera.aspect = window.innerWidth / window.innerHeight;
    SCENE3D.camera.updateProjectionMatrix();
    SCENE3D.renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
function s3SetHover(mesh) {
  const h = SCENE3D.hovered;
  if (h === mesh) return;
  // A hint-highlighted tile owns its own material[4].emissive (see addHandTile
  // / s3Loop's pulse) — leave the color channel alone for it in both branches
  // below, or hovering it would stomp the hint gold with the pickup tint, and
  // un-hovering would zero it out for good (the pulse loop only ever touches
  // emissiveIntensity, never restores the color hover just overwrote).
  if (h && h.userData.homePos) {
    h.position.y = h.userData.homePos.y;
    if (h.material[4].emissive && !SCENE3D.hintTiles.includes(h)) h.material[4].emissive.setHex(0x000000);
  }
  SCENE3D.hovered = mesh;
  if (mesh) {
    mesh.position.y = mesh.userData.homePos.y + 0.008;
    if (!SCENE3D.hintTiles.includes(mesh)) mesh.material[4].emissive.setHex(0x2a1c00);
  }
  SCENE3D.canvas.style.cursor = mesh ? "grab" : "";
}

/* ---------- tiny tween ---------- */
/* P6: reuses the SAME fx-ladder the rest of the app already has (Full/Subtle/
   Off + OS prefers-reduced-motion, both folded into fxMotion()) rather than
   inventing a parallel reduced-motion switch just for this file — "settings
   integration" done by not creating a second setting. Gated centrally here
   so every call site (opponent draw slide, river fly-in, claim-gather,
   drag-cancel snap-back) gets instant placement for free with no per-site
   changes: when motion is off, the tween never gets scheduled — the mesh
   jumps straight to its final pose in the same synchronous call, before the
   next frame ever renders the in-between state. */
function s3Tween(mesh, pos, rot, dur, delay = 0) {
  // Instant placement when motion is off — AND when the tab is hidden: rAF is
  // suspended in background tabs, so a scheduled tween would freeze meshes at
  // their scattered start poses until the player returns (seen in review as a
  // jumbled meld screenshot). A hidden tab gets final poses immediately.
  if ((typeof fxMotion === "function" && !fxMotion()) ||
      (typeof document !== "undefined" && document.hidden)) {
    mesh.position.copy(pos);
    mesh.rotation.copy(rot);
    return;
  }
  SCENE3D.tweens.push({ mesh, from: mesh.position.clone(), fromR: mesh.rotation.clone(),
    pos, rot, t0: performance.now() + delay, dur });
}
function s3RunTweens(now) {
  const tw = SCENE3D.tweens;
  for (let i = tw.length - 1; i >= 0; i--) {
    const t = tw[i];
    if (now < t.t0) continue;   // still in its stagger delay
    const p = Math.min(1, (now - t.t0) / t.dur);
    const e = 1 - Math.pow(1 - p, 3);
    t.mesh.position.lerpVectors(t.from, t.pos, e);
    t.mesh.rotation.set(
      t.fromR.x + (t.rot.x - t.fromR.x) * e,
      t.fromR.y + (t.rot.y - t.fromR.y) * e,
      t.fromR.z + (t.rot.z - t.fromR.z) * e);
    if (p >= 1) tw.splice(i, 1);
  }
}

/* ---------- the hand-start ceremony: the automatic table ----------
   Modelled on a real automatic mahjong table: at the end of a hand the tiles
   are swept into the machine (they SINK below the felt), the machine shuffles
   beneath the table (a beat of muffled clacks), and freshly built walls RISE
   from under the surface — then the deal slides out to each seat.

   The wall still carries an authentic BREAK (derived deterministically from
   shared hand state so host and every party guest see the same break with no
   protocol message), with the flipped gold lying at the gap. The dice that
   used to dramatize the count were removed at review: props with no gameplay
   role don't belong on the table.

   PRESENTATION ONLY, deliberately: the engine's shuffle is already uniformly
   random (see docs/FAIRNESS_REVIEW.md — every break point of a uniformly
   shuffled wall is statistically identical), so none of this touches the
   engine's deal, Daily-Hand seeds, or host/guest determinism. */

/* where the gold lies: just inside the wall break (fallback: far-right corner) */
function s3GoldSpot() {
  const brk = SCENE3D.wallBreak;
  if (!brk) return [0.27, -0.14];
  const horiz = brk.side === 0 || brk.side === 2;
  const count = horiz ? 10 : 7;
  const step = S3_TILE_W + S3_GAP_WALL;
  // midpoint of the gap: between the last unshifted stack and the first shifted one
  const a = (brk.gapIndex - 1 - (count - 1) / 2) * step;
  const b = (brk.gapIndex - (count - 1) / 2) * step + 0.032;
  const mid = (a + b) / 2;
  const inset = 0.052;   // pulled toward the table centre, clear of the wall row
  if (brk.side === 0) return [mid, 0.185 - inset];
  if (brk.side === 2) return [mid, -0.185 + inset];
  if (brk.side === 1) return [0.20 - inset, mid];
  return [-0.20 + inset, mid];
}

function s3HandCeremony(P) {
  // deterministic break from shared state — identical on host and guests
  const seedI = (((G.handNumber | 0) * 31 + (P.wildFlip == null ? 0 : P.wildFlip) * 7 + (G.dealer | 0) * 13) >>> 0);
  const sum = 2 + (seedI % 11);   // the classic 2..12 two-dice range
  const breakSeat = ((G.dealer | 0) + (sum - 1)) % 4;
  const count = (breakSeat === 0 || breakSeat === 2) ? 10 : 7;
  const gapIndex = 1 + ((sum - 1) % (count - 1));   // ≥1 so the gap always has a left flank
  SCENE3D.wallBreak = { side: breakSeat, gapIndex };
  SCENE3D_MELD_COUNTS[0] = SCENE3D_MELD_COUNTS[1] = SCENE3D_MELD_COUNTS[2] = SCENE3D_MELD_COUNTS[3] = 0;

  // mid-hand joins/toggles (river already has tiles): set the break + gold
  // silently — no table theatre for a hand that's already underway
  const quiet = !!(G.river && G.river.length);
  if (quiet || (typeof fxMotion === "function" && !fxMotion())) {
    s3Clear(SCENE3D.wall);   // rebuild with the new break, no animation
    return;
  }

  // ---- the automatic table cycle ----
  // 1 · last hand's tiles — wall included — sink into the machine
  const sinking = [];
  const collect = list => { for (const m of list) sinking.push(m); list.length = 0; };
  collect(SCENE3D.hand);
  for (const rack of SCENE3D.oppRacks) collect(rack);
  collect(SCENE3D.river);
  collect(SCENE3D.publicTiles);
  collect(SCENE3D.wall);
  if (SCENE3D.goldMesh) { sinking.push(SCENE3D.goldMesh); SCENE3D.goldMesh = null; }
  // Review pass: the whole cycle slowed to feel MECHANICAL — a real machine
  // takes its time. Staggered sink (tiles don't all drop at once), a proper
  // shuffle beat you can hear working under the felt, then the deliberate
  // rise. First hand of a match gets the full ~3.6s ritual; later hands a
  // ~2s version; any click still skips instantly.
  const full = (G.handNumber | 0) <= 1;
  for (const m of sinking) {
    const down = m.position.clone(); down.y -= 0.085;
    s3Tween(m, down, m.rotation.clone(), 620, Math.random() * 180);
  }
  setTimeout(() => { for (const m of sinking) SCENE3D.scene.remove(m); }, 850);

  // 2 · the machine shuffles beneath the felt — a muffled clatter you hear
  // more than see (sound respects the master toggle like everything else)
  if (typeof sndClack === "function" && typeof sndReady === "function" && sndReady()) {
    const rattles = full ? 12 : 7;
    for (let i = 0; i < rattles; i++) {
      setTimeout(() => sndClack(0.04, 560 + Math.random() * 340, 0.09),
        250 + i * (full ? 110 : 90) + Math.random() * 60);
    }
  }

  // 3 · walls rise, then the deal slides out — staged by s3StageRise() at the
  // end of THIS sync pass, once the new meshes exist
  SCENE3D.stageRise = { wallDelay: full ? 1500 : 750, rackDelay: full ? 2250 : 1200,
    handDelay: full ? 2500 : 1400, handStagger: full ? 55 : 30, publicDelay: full ? 3050 : 1750 };
  const totalMs = full ? 3600 : 2100;
  SCENE3D.stagingUntil = performance.now() + totalMs;
  clearTimeout(SCENE3D._stagingTimer);
  SCENE3D._stagingTimer = setTimeout(() => {
    SCENE3D.stagingUntil = 0;
    if (SCENE3D.pendingSync) { SCENE3D.pendingSync = false; scene3dAfterRender(); }
  }, totalMs + 30);

  // camera: overview while the table works, settle home as the deal lands
  SCENE3D.cam.tDist = Math.min(S3_CAM.maxD, 1.0);
  setTimeout(() => { SCENE3D.cam.tDist = 0.70; }, totalMs - 350);
}

/* Called at the end of the sync pass that built a fresh hand: sink every new
   mesh below the felt and raise it on its group's schedule — walls first
   (the machine pushing them up), then the racks, then your hand tile-by-tile
   (the deal organizing itself), then the public rows and the gold. */
function s3StageRise() {
  const st = SCENE3D.stageRise;
  SCENE3D.stageRise = null;
  if (!st) return;
  // A mesh built earlier in THIS SAME sync pass (e.g. a freshly-dealt opponent
  // tile) may already have a pending tween queued toward its resting pose —
  // its .position hasn't gotten there yet (tweens resolve over frames, not
  // synchronously), so reading .position here would capture a stale/origin
  // pose. Take over any such tween: use ITS target as the true resting pose,
  // and drop it so it can't fight the rise tween we're about to schedule.
  const restingPose = (m) => {
    let pos = m.position.clone(), rot = m.rotation.clone();
    const tw = SCENE3D.tweens;
    for (let i = tw.length - 1; i >= 0; i--) {
      if (tw[i].mesh === m) { pos = tw[i].pos.clone(); rot = tw[i].rot.clone(); tw.splice(i, 1); }
    }
    return { pos, rot };
  };
  const rise = (m, delay) => {
    const { pos, rot } = restingPose(m);
    m.position.copy(pos);
    m.rotation.copy(rot);
    m.position.y -= 0.085;
    s3Tween(m, pos, rot, 620, delay);   // a deliberate mechanical push, not a pop
  };
  for (const m of SCENE3D.wall) rise(m, st.wallDelay + Math.random() * 90);
  for (const rack of SCENE3D.oppRacks) for (const m of rack) rise(m, st.rackDelay + Math.random() * 80);
  SCENE3D.hand.forEach((m, i) => rise(m, st.handDelay + i * st.handStagger));
  for (const m of SCENE3D.publicTiles) rise(m, st.publicDelay);
  if (SCENE3D.goldMesh) rise(SCENE3D.goldMesh, st.publicDelay + 140);
}

/* Any click during the ceremony fast-forwards it — the sequence is a treat,
   never a toll. */
function s3SkipStaging() {
  if (!SCENE3D.stagingUntil || performance.now() >= SCENE3D.stagingUntil) return false;
  SCENE3D.stagingUntil = 0;
  clearTimeout(SCENE3D._stagingTimer);
  for (const t of SCENE3D.tweens) t.t0 = -1e9;   // every pending tween completes next frame
  SCENE3D.cam.tDist = 0.70;
  if (SCENE3D.pendingSync) { SCENE3D.pendingSync = false; setTimeout(scene3dAfterRender, 0); }
  return true;
}

/* ---------- state → scene sync (the bridge) ---------- */
function s3Clear(list) { for (const m of list) SCENE3D.scene.remove(m); list.length = 0; }

function scene3dSync() {
  if (!SCENE3D.on || !SCENE3D.ready || typeof G === "undefined") return;
  // while the automatic-table ceremony plays, hold rebuilds — the state keeps
  // advancing (flower replacements, the dealer's first draw), and the single
  // deferred sync at the end of the window catches the scene up in one pass
  if (SCENE3D.stagingUntil && performance.now() < SCENE3D.stagingUntil) { SCENE3D.pendingSync = true; return; }
  if (SCENE3D.dragging) { s3Tween(SCENE3D.dragging, SCENE3D.dragging.userData.homePos, SCENE3D.dragging.userData.homeRot, 150); SCENE3D.dragging = null; }
  s3SetHover(null);
  const P = scene3dProjection(G);

  // NEW HAND — run the automatic-table ceremony once per hand. Detected
  // here (not via a main.js hook) so it works identically for solo, host,
  // AND party guests, whose state arrives as snapshots with no startHand().
  // Keyed on a COMPOUND of gen + handNumber + dealer + gold, because no
  // single field is a reliable per-hand identity everywhere: handNumber
  // repeats across matches/re-deals (the bug this fixes — the ceremony
  // silently skipped and kept a stale wall break on "New match"), gen bumps
  // per-startHand for solo/host but stays constant for party guests (their
  // hands arrive as snapshots), and dealer+gold disambiguate the rest.
  const handKey = "g" + G.gen + "h" + G.handNumber + "d" + G.dealer + "w" + P.wildFlip;
  if (P.wildFlip != null && handKey !== SCENE3D.handNo) {
    SCENE3D.handNo = handKey;
    s3HandCeremony(P);
  }

  // YOUR HAND — display order must match main.js's `tiles` (hand + drawn last)
  s3Clear(SCENE3D.hand);
  SCENE3D.hintTiles.length = 0;
  const n = P.myTiles.length + (P.myDrawn != null ? 1 : 0);
  const spread = i => (i - (n - 1) / 2) * (S3_TILE_W + S3_GAP_RACK);
  const addHandTile = (kind, i, isDrawn) => {
    const m = s3MakeTile(kind);
    const x = spread(i) + (isDrawn ? 0.014 : 0);
    m.position.set(x, S3_FELT_Y + S3_TILE_H / 2 - 0.001, S3_HAND_Z);
    m.rotation.set(-0.17, 0, 0);
    m.userData.homePos = m.position.clone();
    m.userData.homeRot = m.rotation.clone();
    m.userData.handIdx = i;
    // Coach's suggested discard: material[4] (the face) is a per-KIND material
    // cached and shared by every tile of that kind (s3FaceMat) — tinting it in
    // place would leak the glow onto every other tile sharing that cache entry
    // forever (nothing ever resets it). Clone it into a per-mesh instance
    // instead, so only this tile lights up and it's naturally gone the moment
    // this mesh is rebuilt (or not re-suggested) on the next sync.
    if (P.suggestKind != null && kind === P.suggestKind) {
      const hintMat = m.material[4].clone();
      hintMat.emissive.setHex(0xffd65a);
      hintMat.emissiveIntensity = 0.55;
      m.material[4] = hintMat;
      SCENE3D.hintTiles.push(m);
    }
    SCENE3D.scene.add(m);
    SCENE3D.hand.push(m);
  };
  P.myTiles.forEach((k, i) => addHandTile(k, i, false));
  if (P.myDrawn != null) addHandTile(P.myDrawn, P.myTiles.length, true);

  // OPPONENTS — count-only standing backs at their edges; public melds/flowers face-up
  s3Clear(SCENE3D.publicTiles);
  for (let o = 0; o < 3; o++) {
    const seat = o + 1;
    const rack = SCENE3D.oppRacks[o];
    const prevWant = rack.length;
    const want = P.opp[o].count;
    const drew = want > prevWant;   // a net gain this sync = a draw just happened (main.js
                                     // renders right after the draw, before the AI discards)
    while (rack.length > want) SCENE3D.scene.remove(rack.pop());
    while (rack.length < want) { const m = s3MakeTile(null); SCENE3D.scene.add(m); rack.push(m); }
    rack.forEach((m, i) => {
      const [x, z] = s3SeatXZ(seat, (i - (want - 1) / 2) * (S3_TILE_W + S3_GAP_RACK), S3_HAND_Z);
      const finalPos = new THREE.Vector3(x, S3_FELT_Y + S3_TILE_H / 2 - 0.001, z);
      m.rotation.order = "YXZ";
      // face the OWNER (S3_SEAT_ANGLE maps +z toward them), lean gently back —
      // so every concealed proxy shows the table only its green back
      const finalRot = new THREE.Euler(-0.10, S3_SEAT_ANGLE[seat], 0, "YXZ");
      if (drew && i === want - 1) {
        // the newly drawn tile: peel off that seat's own wall pile and slide in
        const [wx, wz] = s3SeatXZ(seat, 0, 0.20);
        m.position.set(wx, S3_FELT_Y + S3_TILE_T, wz);
        m.rotation.set(Math.PI / 2, S3_SEAT_ANGLE[seat], 0);
        s3Tween(m, finalPos, finalRot, 320);
      } else if (!m.position.equals(finalPos)) {
        s3Tween(m, finalPos, finalRot, 150);   // rack re-centering as it grows/shrinks
      } else {
        m.rotation.set(-0.10, S3_SEAT_ANGLE[seat], 0);
      }
    });
    s3LayPublicRow(seat, P.opp[o]);
  }
  s3LayPublicRow(0, { melds: P.myMelds, flowers: P.myFlowers });

  // RIVER — face-up grid, newest flies in from the discarder's edge
  while (SCENE3D.river.length > P.river.length) SCENE3D.scene.remove(SCENE3D.river.pop());
  for (let i = 0; i < SCENE3D.river.length; i++) {
    if (SCENE3D.river[i].userData.kind !== P.river[i].kind) {   // rare divergence: rebuild
      s3Clear(SCENE3D.river);
      break;
    }
  }
  for (let i = SCENE3D.river.length; i < P.river.length; i++) {
    const d = P.river[i];
    const col = i % 6, row = (i / 6) | 0;
    const x = (col - 2.5) * (S3_TILE_W + 0.004), z = -0.055 + row * (S3_TILE_H + 0.004);
    const m = s3MakeTile(d.kind);
    const rot = new THREE.Euler(-Math.PI / 2, 0, ((i * 7919) % 13 - 6) * 0.014);
    const isNewest = i === P.river.length - 1;
    if (isNewest && SCENE3D.lastDrop && d.seat === 0) {
      m.position.copy(SCENE3D.lastDrop);
      SCENE3D.lastDrop = null;
    } else if (isNewest) {
      const [sx, sz] = s3SeatXZ(d.seat, 0, S3_HAND_Z - 0.06);
      m.position.set(sx, S3_FELT_Y + 0.06, sz);
    } else {
      m.position.set(x, S3_FELT_Y + S3_TILE_T / 2, z);
    }
    m.rotation.copy(rot);
    SCENE3D.scene.add(m);
    SCENE3D.river.push(m);
    if (isNewest) s3Tween(m, new THREE.Vector3(x, S3_FELT_Y + S3_TILE_T / 2, z), rot, 340);
  }

  // LAST-DISCARD RING — parked at the newest river tile's resting slot (the
  // grid position, not the fly-in start, so it marks where the tile LANDS);
  // "fades" naturally on the next discard because it simply moves there
  if (SCENE3D.discardRing) {
    if (P.river.length && P.hasLastDiscard) {
      const li = P.river.length - 1;
      const lx = (li % 6 - 2.5) * (S3_TILE_W + 0.004), lz = -0.055 + ((li / 6) | 0) * (S3_TILE_H + 0.004);
      SCENE3D.discardRing.position.set(lx, S3_FELT_Y + 0.0035, lz);
      SCENE3D.discardRing.visible = true;
    } else {
      SCENE3D.discardRing.visible = false;   // river empty, or the tile was claimed/won
    }
  }

  // WALL — face-down two-high rows depleting with the real count. The side
  // the ceremony picked carries a visible BREAK: a gap in the row where
  // the wall was opened, with the flipped gold lying just inside it.
  SCENE3D.maxWall = Math.max(SCENE3D.maxWall, P.wallLen);
  const SLOTS = 68;
  const show = SCENE3D.maxWall ? Math.ceil(SLOTS * P.wallLen / SCENE3D.maxWall) : 0;
  if (SCENE3D.wall.length !== show) {
    s3Clear(SCENE3D.wall);
    const brk = SCENE3D.wallBreak;
    const GAPW = 0.032;
    let placed = 0;
    outer:
    for (let side = 0; side < 4; side++) {
      const horiz = side === 0 || side === 2;
      const count = horiz ? 10 : 7;
      for (let i = 0; i < count; i++) for (let lv = 0; lv < 2; lv++) {
        if (placed >= show) break outer;
        let off = (i - (count - 1) / 2) * (S3_TILE_W + S3_GAP_WALL);
        if (brk && brk.side === side && i >= brk.gapIndex) off += GAPW;   // the break
        const m = s3MakeTile(null);
        const cx = side === 1 ? 0.20 : side === 3 ? -0.20 : off;
        const cz = side === 0 ? 0.185 : side === 2 ? -0.185 : off;
        m.position.set(cx, S3_FELT_Y + S3_TILE_T / 2 + lv * S3_TILE_T, cz);
        m.rotation.set(Math.PI / 2, 0, horiz ? 0 : Math.PI / 2);
        SCENE3D.scene.add(m);
        SCENE3D.wall.push(m);
        placed++;
      }
    }
  }

  // GOLD — the flipped wild lies FACE-UP just inside the wall break the ceremony
  // chose (the authentic spot). A ring under it (not a tint on the face itself)
  // marks it so it never gets lost among the wall tiles — an emissive tint on
  // the face previously washed out the printed pips/characters, making the
  // one tile you most need to read at a glance the hardest one to read.
  if (SCENE3D.goldMesh) { SCENE3D.scene.remove(SCENE3D.goldMesh); SCENE3D.goldMesh = null; }
  if (P.wildFlip != null) {
    const m = s3MakeTile(P.wildFlip);
    const g = s3GoldSpot();
    m.position.set(g[0], S3_FELT_Y + S3_TILE_T / 2, g[1]);
    m.rotation.set(-Math.PI / 2, 0, 0.10);
    SCENE3D.scene.add(m);
    SCENE3D.goldMesh = m;
    if (SCENE3D.goldRing) {
      SCENE3D.goldRing.position.set(g[0], S3_FELT_Y + 0.0035, g[1]);
      SCENE3D.goldRing.visible = true;
    }
  } else if (SCENE3D.goldRing) {
    SCENE3D.goldRing.visible = false;
  }

  // keep the DOM action bar correctly pinned even if no animation frame has
  // fired yet (first paint, or a background tab where rAF is suspended — the
  // engine keeps playing on timers there, so state changes still land here)
  s3ApplyCamera();
  s3PinPanelAboveRack();

  // TURN MARKER
  SCENE3D.activeSeat = P.activeSeat;
  if (P.activeSeat != null) {
    const [tx, tz] = s3SeatXZ(P.activeSeat, 0, 0.245);
    SCENE3D.turnDisc.position.set(tx, S3_FELT_Y + 0.002, tz);
    SCENE3D.turnDisc.visible = true;
  } else SCENE3D.turnDisc.visible = false;

  // if this pass built a fresh hand, the automatic table now raises it
  s3StageRise();
}

/* public melds + flowers laid face-up along each seat's right side */
/* How many melds we've already played the gather-in animation for, per seat
   (0=you, 1-3=opponents) — a fresh hand naturally resets this to 0 once
   info.melds.length actually reaches 0 (see the bottom of this function). */
const SCENE3D_MELD_COUNTS = [0, 0, 0, 0];

function s3LayPublicRow(seat, info) {
  // Two rewrites in review both tried to squeeze this row into the strip
  // OUTSIDE the rack (between it and the table edge) — that strip turns out
  // to be only ~50mm deep, so it either collided with the hand/rack (a fixed
  // corner start) or ran the row off the camera's frame for the two near
  // seats (a dynamic-but-still-outward start), and a Y-axis "stack" for
  // overflow LOOKS like overlapping tiles from this camera's angle instead of
  // fixing anything. The actual free felt is on the OTHER side of the rack:
  // the wall sits at only ~0.20 from centre while the rack sits at 0.37 —
  // that's a genuinely empty ~170mm-deep gap on every side, big enough for
  // several fully-separated rows. Lay flowers/melds there instead, centred
  // like the hand, wrapping to a new (properly z-gapped, not stacked) row
  // when a row fills up — so the whole area grows to fit however many
  // tiles there are, and no two tiles ever occupy the same footprint.
  const unit = S3_TILE_W + 0.003;
  const rowGap = S3_TILE_H + 0.012;
  const baseZ = S3_HAND_Z - 0.06;
  const ROW_CAP = 10;   // 2 rows of 10 (measured clearance ≥69mm from the wall)
                        // cover all but the most extreme hands before a 3rd
                        // row would start crowding the wall

  const groups = [];
  for (const f of info.flowers || []) groups.push({ tiles: [f], gatherIn: false });
  const prevMelds = SCENE3D_MELD_COUNTS[seat] || 0;
  (info.melds || []).forEach((meld, mi) => {
    const isNew = mi >= prevMelds;
    const kinds = meld.type === "chow" ? [meld.kind, meld.kind + 1, meld.kind + 2]
      : new Array(meld.type === "kong" ? 4 : 3).fill(meld.kind);
    groups.push({ tiles: kinds, gatherIn: isNew });
  });

  // Assign whole groups to rows — a meld's tiles never split across a wrap.
  const rows = [[]];
  let curLen = 0;
  for (const g of groups) {
    if (curLen && curLen + g.tiles.length > ROW_CAP) { rows.push([]); curLen = 0; }
    rows[rows.length - 1].push(g);
    curLen += g.tiles.length;
  }

  const finalRot = new THREE.Euler(-Math.PI / 2, S3_SEAT_ANGLE[seat], 0, "YXZ");
  rows.forEach((rowGroups, rIdx) => {
    const total = rowGroups.reduce((s, g) => s + g.tiles.length, 0);
    if (!total) return;
    let li = -(total - 1) / 2;
    const z = baseZ - rIdx * rowGap;
    for (const g of rowGroups) {
      for (const kind of g.tiles) {
        const m = s3MakeTile(kind);
        const [x, zz] = s3SeatXZ(seat, li * unit, z);
        const finalPos = new THREE.Vector3(x, S3_FELT_Y + S3_TILE_T / 2, zz);
        if (g.gatherIn) {
          // a brand-new meld: its tiles converge from a small scattered
          // pop-up, like they were just swept together into place
          const [sx, sz] = s3SeatXZ(seat, (Math.random() - 0.5) * 0.06, baseZ + (Math.random() - 0.5) * 0.06);
          m.position.set(sx, S3_FELT_Y + 0.09, sz);
          m.rotation.set(-Math.PI / 2 + 0.3, S3_SEAT_ANGLE[seat], (Math.random() - 0.5) * 0.7);
          SCENE3D.scene.add(m);
          SCENE3D.publicTiles.push(m);
          s3Tween(m, finalPos, finalRot, 300);
        } else {
          m.position.copy(finalPos);
          m.rotation.copy(finalRot);
          SCENE3D.scene.add(m);
          SCENE3D.publicTiles.push(m);
        }
        li++;
      }
    }
  });
  SCENE3D_MELD_COUNTS[seat] = (info.melds || []).length;
}

/* ---------- render loop ---------- */
function s3AnimatePortraits(now) {
  const reduced = typeof fxMotion === "function" && !fxMotion();
  const t = now * 0.001;
  for (const p of SCENE3D_PORTRAITS) {
    if (!p) continue;
    const thinking = SCENE3D.activeSeat === p.seat;
    if (reduced) {
      // no continuous bob/pulse — "thinking" still reads via a discrete size
      // + tint change (a real, static difference), just nothing keeps moving
      p.sprite.position.y = p.baseY;
      const s = p.baseScale * (thinking ? 1.14 : 1);
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.color.setHex(thinking ? 0xffdca0 : 0xffffff);
      continue;
    }
    const bob = Math.sin(t * 1.3 + p.seat * 2.1) * 0.006;
    p.sprite.position.y = p.baseY + bob;
    if (thinking) {
      const pulse = 1 + Math.sin(t * 3.4) * 0.06;
      p.sprite.scale.set(p.baseScale * 1.14 * pulse, p.baseScale * 1.14 * pulse, 1);
      p.sprite.material.color.setHex(0xffdca0);
    } else {
      p.sprite.scale.set(p.baseScale, p.baseScale, 1);
      p.sprite.material.color.setHex(0xffffff);
    }
  }
}

/* Pin the DOM action bar (You pill + prompt + claim buttons) just above the
   rack's TOP edge in screen space, every frame, whatever the camera, zoom, or
   viewport does. The old fixed `bottom: 168px` sat directly on the tiles at
   some window sizes (user-annotated screenshot) — a projected anchor can't:
   the rack's top is computed through the live camera, so the bar rides it. */
function s3PinPanelAboveRack() {
  if (!SCENE3D.panelEl) SCENE3D.panelEl = document.getElementById("player-panel");
  if (!SCENE3D.panelEl) return;
  const v = SCENE3D._v || (SCENE3D._v = new THREE.Vector3());
  v.set(0, S3_FELT_Y + S3_TILE_H + 0.014, S3_HAND_Z).project(SCENE3D.camera);
  const topPx = (1 - v.y) / 2 * window.innerHeight;
  const bottomPx = Math.max(8, Math.round(window.innerHeight - topPx + 10));
  if (Math.abs(bottomPx - SCENE3D.panelBottomPx) > 1) {
    SCENE3D.panelBottomPx = bottomPx;
    SCENE3D.panelEl.style.bottom = bottomPx + "px";
  }
}

function s3Loop(now) {
  if (!SCENE3D.on) { SCENE3D.raf = 0; return; }
  SCENE3D.raf = requestAnimationFrame(s3Loop);
  now = now || performance.now();
  const c = SCENE3D.cam;
  // P6: reduced motion / fx-off gets an instantly-responsive camera (no
  // eased head-turn/zoom, no smoothed win-reaction pull-back) instead of the
  // usual 12%-per-frame ease — matches the plan's explicit "no camera easing"
  // requirement, and reuses fxMotion() rather than a new setting.
  if (typeof fxMotion === "function" && !fxMotion()) {
    c.az = c.tAz; c.pol = c.tPol; c.dist = c.tDist;
  } else {
    c.az += (c.tAz - c.az) * 0.12;
    c.pol += (c.tPol - c.pol) * 0.12;
    c.dist += (c.tDist - c.dist) * 0.12;
  }
  s3ApplyCamera();
  s3PinPanelAboveRack();
  s3RunTweens(now);
  s3AnimatePortraits(now);
  // ambient life gated by the same fx-motion setting as the 2D board's dust
  // motes/lamp breathe — off at fx-off or prefers-reduced-motion
  if (typeof fxMotion !== "function" || fxMotion()) {
    const t = now * 0.001;
    if (SCENE3D.lamp) SCENE3D.lamp.intensity = SCENE3D.lampBase * (0.93 + 0.07 * Math.sin(t / 7 * Math.PI * 2));
    s3AnimateDust(t);
    // the last-discard ring breathes gently; a steady ring when motion is off
    if (SCENE3D.discardRing && SCENE3D.discardRing.visible) {
      SCENE3D.discardRing.material.opacity = 0.34 + 0.20 * (0.5 + 0.5 * Math.sin(t * 3.2));
    }
    if (SCENE3D.goldRing && SCENE3D.goldRing.visible) {
      SCENE3D.goldRing.material.opacity = 0.34 + 0.20 * (0.5 + 0.5 * Math.sin(t * 3.2));
    }
    // the coach's suggested-discard tile(s) pulse too, mirroring the 2D
    // board's fx-wiggle on .tile.suggest — same "look here" intent
    for (const m of SCENE3D.hintTiles) m.material[4].emissiveIntensity = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.2));
  } else {
    if (SCENE3D.lamp) SCENE3D.lamp.intensity = SCENE3D.lampBase;
    if (SCENE3D.discardRing) SCENE3D.discardRing.material.opacity = 0.45;
    if (SCENE3D.goldRing) SCENE3D.goldRing.material.opacity = 0.45;
    for (const m of SCENE3D.hintTiles) m.material[4].emissiveIntensity = 0.55;
  }
  SCENE3D.renderer.render(SCENE3D.scene, SCENE3D.camera);
}

/* ---------- win/draw moment: camera eases back to see the whole table ----------
   The DOM board's win FX (shake/glow/board-confetti) target #table/#hand,
   which are display:none in mode3d — harmless no-ops, but no celebration
   either. This gives the 3D table its own reaction: zoom out toward the max
   seated distance for a few seconds, then ease back to wherever you were. */
function scene3dWinReaction() {
  if (!SCENE3D.on || !SCENE3D.ready) return;
  const prevDist = SCENE3D.cam.tDist;
  SCENE3D.cam.tDist = S3_CAM.maxD;
  setTimeout(() => { SCENE3D.cam.tDist = prevDist; }, 2600);
}

/* ---------- live integrity audit (same sweep as the prototype) ---------- */
function s3LeakCheck() {
  const sph = { }, camPos = new THREE.Vector3(), nrm = new THREE.Vector3(), toCam = new THREE.Vector3();
  let worst = -Infinity, exposed = 0, samples = 0;
  const hidden = [];
  for (const rack of SCENE3D.oppRacks) for (const m of rack) hidden.push(m);
  for (let a = 0; a <= 12; a++) {
    const az = S3_CAM.minAz + (a / 12) * (S3_CAM.maxAz - S3_CAM.minAz);
    for (let p = 0; p <= 8; p++) {
      const pol = S3_CAM.minPol + (p / 8) * (S3_CAM.maxPol - S3_CAM.minPol);
      for (const d of [S3_CAM.minD, (S3_CAM.minD + S3_CAM.maxD) / 2, S3_CAM.maxD]) {
        camPos.set(
          S3_CAM.target.x + d * Math.sin(pol) * Math.sin(az),
          S3_CAM.target.y + d * Math.cos(pol),
          S3_CAM.target.z + d * Math.sin(pol) * Math.cos(az));
        samples++;
        for (const m of hidden) {
          nrm.set(0, 0, 1).applyQuaternion(m.quaternion);
          toCam.copy(camPos).sub(m.position).normalize();
          const dot = nrm.dot(toCam);
          if (dot > worst) worst = dot;
          if (dot > 0.02) exposed++;
        }
      }
    }
  }
  return { samples, hidden: hidden.length, exposed, worstDot: +worst.toFixed(4),
    verdict: exposed === 0 ? "SEALED" : "LEAK" };
}

/* ---------- mode switching (wired from main.js boot) ---------- */
async function scene3dSetEnabled(on) {
  if (on === SCENE3D.on) return;
  if (on) {
    if (SCENE3D.failed) return;
    if (!scene3dDeviceOk()) {
      if (typeof coachSay === "function") coachSay("The 3D table needs a bigger screen and a mouse to really work — staying on the classic board here. 🐱");
      const t = document.getElementById("toggle-3d");
      if (t) t.checked = false;
      if (typeof storeSet === "function") storeSet("meowjong-3d", "0");
      return;
    }
    if (!(await ensureThreeLib())) {
      SCENE3D.failed = true;
      if (typeof coachSay === "function") coachSay("Couldn't load the 3D library — the classic board is still here. 🐱");
      const t = document.getElementById("toggle-3d");
      if (t) t.checked = false;
      return;
    }
    if (!SCENE3D.ready) { s3Build(); SCENE3D.ready = true; }
    SCENE3D.on = true;
    document.body.classList.add("mode3d");
    scene3dSync();
    if (!SCENE3D.raf) SCENE3D.raf = requestAnimationFrame(s3Loop);
  } else {
    SCENE3D.on = false;
    document.body.classList.remove("mode3d");
    if (SCENE3D.panelEl) { SCENE3D.panelEl.style.bottom = ""; SCENE3D.panelBottomPx = -1; }   // classic layout owns it again
  }
  if (typeof storeSet === "function") storeSet("meowjong-3d", on ? "1" : "0");
  // a turn prompt already on screen when the mode flips (toggle, or P5's
  // live resize fallback) would otherwise show stale "drag"/"click" copy
  if (typeof refreshTurnPromptForModeSwitch === "function") refreshTurnPromptForModeSwitch();
}

/* hook called at the end of renderAll() — presentation only, never throws into the engine */
function scene3dAfterRender() {
  try { scene3dSync(); } catch (e) { try { console.error("[scene3d]", e); } catch (_) {} }
}
