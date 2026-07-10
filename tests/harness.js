"use strict";
/* ============================================================
   Meowjong — test harness

   The game ships as browser <script> globals with no module
   exports, so we load the REAL source files (unmodified) into a
   Node vm context with light DOM/localStorage stubs, then expose
   the functions we want to test. This tests production code as-is.

   Run:  node tests/run.js     (or: npm test)
   ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
// Order matters (same as index.html) — later files reference earlier globals.
const FILES = ["js/tiles.js", "js/engine.js", "js/ai.js", "js/net.js", "js/main.js"];

/* Names we surface for tests (missing ones resolve to undefined, not a crash). */
const EXPORTS = [
  "G", "SUITS", "WINDS", "DRAGONS", "MELD_LABEL", "N_KINDS",
  "suitOf", "rankOf", "isWind", "isHonor", "isDragon", "tileName", "tileShort",
  "buildWall", "sortHand", "countsOf",
  "canFormSetsW", "isWinningCounts", "winningKinds", "fjScore", "fjPayout",
  "canPung", "canKongFromDiscard", "chowOptions", "concealedKongs", "addedKongs",
  "evalCounts", "chooseDiscard", "roughShanten", "fjShanten", "fjUkeire", "bestShape", "aiWantsPung", "aiWantsChow",
  "visibleKindCounts", "liveCount", "dangerNote",
  "escapeHtml", "sanitizeName", "sanitizeMarkup", "isPartyMode", "projectFor",
  "isSoloMatch", "saveMatch", "loadMatch", "clearSave", "storeGet", "storeSet",
  "MATCH_HANDS", "SAVE_VERSION",
];

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
  };
}

function fakeEl() {
  return {
    style: {}, dataset: {}, innerHTML: "", textContent: "", children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, prepend() {}, setAttribute() {}, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return fakeEl(); },
  };
}

/* Build a fresh, isolated game context. Call once per test file for isolation. */
function loadGame() {
  const localStorage = makeLocalStorage();
  const sandbox = {
    console, localStorage,
    performance: { now: () => Date.now() },
    window: { addEventListener() {}, location: { reload() {}, href: "", pathname: "/", origin: "http://test" } },
    document: {
      querySelector: () => null, getElementById: () => null,
      createElement: () => fakeEl(), addEventListener() {},
      body: { classList: { toggle() {} } }, scripts: [],
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox);
  let src = FILES.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  src += "\n;globalThis.__T = { " +
    EXPORTS.map(n => `${n}: (typeof ${n} !== "undefined" ? ${n} : undefined)`).join(", ") +
    " };";
  vm.runInContext(src, sandbox, { filename: "meowjong-bundle.js" });
  return { T: sandbox.__T, localStorage, sandbox };
}

/* ---------- tiny zero-dependency test framework ---------- */

const REG = [];
function test(name, fn) { REG.push({ name, fn }); }

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "eq"}: expected ${e}, got ${a}`);
}
function ok(v, msg) { if (!v) throw new Error(`${msg || "ok"}: expected truthy, got ${JSON.stringify(v)}`); }
function notOk(v, msg) { if (v) throw new Error(`${msg || "notOk"}: expected falsy, got ${JSON.stringify(v)}`); }
function throws(fn, msg) {
  try { fn(); } catch (e) { return; }
  throw new Error(`${msg || "throws"}: expected an exception`);
}

function run() {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of REG) {
    try { fn(); passed++; process.stdout.write("."); }
    catch (e) { failures.push([name, e.message]); process.stdout.write("F"); }
  }
  process.stdout.write("\n\n");
  for (const [name, msg] of failures) console.log(`  ✗ ${name}\n      ${msg}`);
  const total = passed + failures.length;
  console.log(`\n${passed}/${total} passed${failures.length ? `, ${failures.length} FAILED` : " — all green ✓"}`);
  return failures.length ? 1 : 0;
}

module.exports = { loadGame, test, eq, ok, notOk, throws, run };
