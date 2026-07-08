# Meowjong test suite

Fast, zero-dependency unit tests over the pure game logic.

```
npm test          # or: node tests/run.js
```

## How it works

The game ships as browser `<script>` globals with no module exports. Rather than
refactor for testability, [`harness.js`](harness.js) loads the **real, unmodified**
source files (`tiles.js`, `engine.js`, `ai.js`, `net.js`, `main.js`) into a Node
`vm` context with light DOM / `localStorage` stubs, then exposes the functions under
test. So these tests exercise production code exactly as it runs in the browser.

`loadGame()` returns a fresh, isolated context each call (state like `G` and the
save blob is shared-mutable global), so groups that mutate state call it per file.

## Coverage

| File | What it locks down |
|---|---|
| `tiles.test.js` | tile taxonomy, 124-tile wall (no dragons), counts/sort/names |
| `engine.test.js` | **wild-aware win detection** (incl. the "gold can't be the pair" rule), waits, claim eligibility with gold exclusion |
| `scoring.test.js` | FJ `fjScore` (flowers × base, no-flower/self-draw/三金倒/抢金 bonuses) and `fjPayout` point conservation |
| `ai.test.js` | `chooseDiscard` never sheds a gold, `roughShanten` sanity, live-tile counting |
| `net.test.js` | `escapeHtml`, `sanitizeName` & `sanitizeMarkup` injection guards |
| `save.test.js` | save/resume round-trip + corruption/version/party-blob rejection + private-mode storage guard |
| `fairness.test.js` | **randomization fairness** — replicates the real deal and asserts no seat (incl. the human) is favored, dealer role is tempo-only, shuffle is position-uniform, deal conserves all 124 tiles, and kind frequency is uniform (statistical, wide tolerances) |

## Adding tests

```js
const { loadGame, test, eq, ok, notOk } = require("./harness");
const { T } = loadGame();
test("my thing", () => { eq(T.someFn(1, 2), 3); });
```
Then `require("./my.test")` in [`run.js`](run.js).
