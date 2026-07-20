# Meowjong — Tile Randomization & AI Fairness Review

**Status: findings confirmed and acted on. The §5 fairness test harness has been committed
(`tests/fairness.test.js`, commit d8cc8c4); the §6 AI/difficulty open question was answered
by `docs/GAMEPLAY_NEXT_LEVEL_PLAN.md`'s G1 milestone (unified strong AI, shipped 2026-07-17),
which replaced the flat heuristic with the danger-aware, Analyst-EV-driven engine proposed
below — no difficulty tiers, one strength for every cat, per that plan's direction.**
**Headline: the shuffle and deal are fair. The "strong hands" feeling is real but its cause is perception and assistance asymmetry, not a biased wall.**

I read the actual generation, shuffle, and deal code, then *proved* the conclusion with a 200,000-deal Monte Carlo simulation that runs the game's **own** `buildWall`, deal, flower-replacement, gold-flip, and `roughShanten` scorer. No assumptions.

---

## 1. How the current system works

**Tile set** (`js/tiles.js` → `buildWall`). A 124-tile FJ set: 4 copies each of 31 kinds — 27 suit tiles (Dots/Bamboo/Characters 1–9) + 4 winds. No dragons. Counts are exactly correct.

**Shuffle** (`buildWall`). A textbook **Fisher–Yates**:

```js
for (let i = wall.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));   // j ∈ [0, i]
  [wall[i], wall[j]] = [wall[j], wall[i]];
}
```

The bounds are correct (`i` descending, `j` inclusive of `i`), so every one of the 124! orderings is equally likely — this is the unbiased algorithm, not the subtly-broken `j ∈ [0, n)` variant.

**Deal** (`js/main.js` → `startHand`). Each seat pops 13 tiles off the back of the wall, in seat order 0→3 (seat 0 is the human), then the hand is sorted for display. Winds dealt into a hand become **flowers** (`replaceInitialFlowers`), replaced from the front ("back wall") in dealer-first order. Then `flipGold` turns the first non-wind tile off the front into the **gold** (wild). Finally the deal checks every seat for instant wins (三金倒 / 抢金) before play begins.

The wall is effectively **two-ended**: hands and normal draws come off one end (`.pop()`), while back-wall events — flower replacements, kong-replacement draws, the gold flip — come off the other (`.shift()`). This faithfully models a real wall with a back, and because the whole array is uniformly shuffled, both ends are equally random.

---

## 2. Answers to the Phase-1 questions

| Question | Finding |
|---|---|
| How are tiles generated? | 4 × 31 kinds = 124-tile FJ set, correct composition. |
| How is the wall shuffled? | In-place **Fisher–Yates** over the full 124 tiles. |
| Is the shuffle truly random? | **Yes — unbiased.** Correct algorithm and bounds. `Math.random()` (V8 xorshift128+) is high-quality and seedless; good for fairness, just not cryptographic. |
| Does every tile have equal probability? | **Yes.** Simulation: suit-kind appearance χ² = 13.5 on 26 df (expected ≈ 26); max deviation from uniform **0.30%**. |
| Any implementation bias? | **None found.** Block-dealing (13 at a time) is statistically identical to round-robin dealing on a uniformly shuffled wall. The two-ended wall introduces no bias. |
| Are tiles reordered after shuffling? | Only **for display** — `sortHand` sorts each hand ascending. The wall itself is never reordered; sorting changes *which slot*, never *which tiles*. |
| Are starting hands manipulated? | **No.** There is no redeal, no strength gate, no "deal until good." The only post-deal logic is instant-win detection, applied to all four seats equally. |
| Hidden logic favoring the player? | **None.** Seat 0 is dealt first and is the dealer on hand 1, but neither affects the *distribution* of tiles a seat receives (proven below). No seat-0-specific code exists in generation, shuffle, or deal. |

---

## 3. Simulation evidence (200,000 deals, dealer randomized)

Scored with the game's own `roughShanten` (lower = closer to a winning hand). Seat 0 is the human.

```
Seat | meanShanten | %tenpai | %<=1-shanten | meanFlowers | meanGoldInHand
  0  |   2.6240    |  0.45%  |    8.24%     |   1.909     |    0.364     <-- human
  1  |   2.6272    |  0.48%  |    8.08%     |   1.916     |    0.365
  2  |   2.6257    |  0.46%  |    8.19%     |   1.908     |    0.364
  3  |   2.6261    |  0.50%  |    8.10%     |   1.908     |    0.365
```

- **All four seats are identical within Monte-Carlo noise** (~±0.003 on mean shanten at this sample size). The human's mean is not meaningfully better or worse than the cats'.
- **Dealer vs non-dealer** starting shanten: 2.6268 vs 2.6254 — also identical. The dealer's edge is *tempo* (they draw/act first), not a stronger dealt hand.
- **Flowers (~1.91) and golds-in-hand (~0.36) per seat are equal**, so scoring-relevant bonuses are unbiased too.
- **Tile frequency is uniform** across dealt hands (suit kinds all within 0.30% of the mean).

Conclusion: **the randomizer is fair.** If we ship nothing here, no player is advantaged.

> Note on the shanten distribution: ~8.2% of *starting* hands are already ≤1 tile from ready. That is high versus standard mahjong — but it's a **rules** effect (three wild golds make many hands "feel close"), and it applies **equally to all four players**, not just the human.

---

## 4. Why it *feels* like the player gets strong hands

The feeling is genuine; the cause is not the wall. In order of likely impact:

1. **Assistance asymmetry (biggest).** The human plays with Professor Paws + the Analyst narrating shanten, live waits, and the optimal discard every turn, and cheering "you're 1 from ready!" The cats play silently. Same tiles, but the human is *guided to realize their hand's potential* and told an encouraging story about it. Hands feel strong because they're played well and framed positively.
2. **Egocentric salience + the gold mechanic.** With three wild golds, close-looking hands are common for everyone (~8% ≤1-shanten). You vividly notice it in *your* hand and never see the three cats who were equally close.
3. **Small-sample confirmation bias.** A testing session is a few dozen hands; streaks feel meaningful but aren't.
4. **Hand-1 dealer tempo.** The human is dealer on the first hand (draws first), so the hand *develops* faster early even though it started equal.
5. **AI, not RNG.** If the cats discard tiles you need or fold poorly, you win more — that's an opponent-strength issue (Section 6), independent of the shuffle. Peek mode, if on, also inflates the feeling.

---

## 5. Randomization: recommendations

Because the system is already fair, these are **quality/robustness upgrades, not fixes** — and one common "fix" would actively hurt.

**Keep**
- **Fisher–Yates.** It's correct; don't touch the algorithm.

**Worth adding**
- **A committed fairness harness.** Turn the simulation above into a checked-in test (per-seat shanten equality + χ² uniformity) so any future change to generation/deal that introduces bias fails CI. This is the single highest-value item — it makes fairness a guarantee, not a one-time check.
- **Seeded RNG (optional but recommended for you specifically).** A small seedable PRNG (e.g. mulberry32) with the seed logged per hand lets you **replay the exact deal** that "felt too strong," share seeds for bug reports, and build deterministic tests. It also enables a future "verifiable fairness" mode (reveal the seed post-hand). This directly serves your investigation without changing odds.

**Consider (immersion, not fairness)**
- **Authentic wall construction** — a visible dead wall + break point — for the visual revamp. Cosmetic; keep the underlying uniform shuffle.
- **Higher-entropy source** — `crypto.getRandomValues` instead of `Math.random`. Statistically unnecessary here; only worth it for anti-tamper feel.

**Explicitly avoid**
- **"Prevent repeated patterns / avoid strong openings."** A uniform shuffle already makes repeats astronomically unlikely, and *forcing* no-repeats or capping opening strength would **reduce** randomness and **break** fairness (it's a non-uniform distribution and, if applied only to the human, an actual bias). The correct response to "hands feel strong" is Sections 4 and 6 — not nerfing the deal.

---

## 6. Draft: how all four players function under a revised system

The guiding principle: **symmetric randomness, asymmetric strategy.** Every seat must draw from the same wall by the same rules (fairness); what should differ is *skill and personality* (feel). Note FJ mahjong has **no Riichi** (that's Japanese mahjong) — the FJ analogues are the gold-wild mechanic and instant wins (三金倒 / 抢金), so "call logic" here means Chi/Peng/Gang discipline.

**Starting hands & draw flow (unchanged, reaffirmed as symmetric).** All four seats: 13 tiles off the shuffled wall, winds→flowers with back-wall replacement, shared gold flip, dealer draws first then counter-clockwise. No per-seat RNG, no per-seat tile pools. This stays exactly as-is; it's already fair.

**AI decision-making (the real lever).** Today the cats use a fast heuristic (`chooseDiscard` over `evalCounts`) plus simple claim rules (`aiWantsPung`/`aiWantsChow`). They already never discard gold. Proposed upgrades, reusing the **Analyst engine we already built** as a shared brain:
- *Discard:* weight the value heuristic by **danger** (the Analyst's per-opponent threat model already computes deal-in risk) so cats play safer when someone is threatening, and can **push or fold** based on EV rather than always shedding the lowest-value tile.
- *Claims (Chi/Peng/Gang):* add discipline — don't claim when it strands tiles or collapses a wide wait, weigh the tempo/flower payoff; the Analyst's claim analysis already encodes this and can drive the AI.
- *Gold & flower awareness:* value gold flexibility and flower payout when choosing speed vs. shape.

**Difficulty balancing (tiers, not tilted odds).** Map difficulty to *how much of the shared brain each cat uses*, never to tile access:
- *Kitten (easy):* near-greedy shape play, little defense (roughly today's AI).
- *Cat (normal):* value + basic danger avoidance + claim discipline.
- *Alley-cat (hard):* full Analyst Layer 1–2 (EV + threat model), disciplined push/fold and claims.

**Personalities (yes — within fair rules).** Give each cat a small, fixed bias on the shared engine so matches feel human and varied: e.g. an **aggressive chaser** (pushes thin waits), a **defensive folder** (bails early when threatened), a **flower-hoarder** (over-values big-payout hands), a **speed player** (claims often for tempo). These are weight tweaks on identical information and identical tile access — flavor without unfairness.

**Should every player follow identical probability rules?** For **randomness and tile access — yes, strictly** (this is fairness). For **decision policy — no** — differing skill and personality is exactly what makes matches feel natural and competitive rather than four identical bots. Keeping these two axes separate is the whole design.

Why this improves things: it makes the *opponents* the source of challenge and variety (addressing the "I win too easily" feeling at its true cause), while the proven-fair deal guarantees no one — human or cat — is handed better tiles.

---

## 7. Additional balancing opportunities discovered

- **The true difficulty dial is AI defense, not the shuffle.** Cats currently don't use their own danger model when discarding; wiring that in is the biggest competitiveness win available and touches no RNG.
- **Perception levers (pair with the visual revamp):** show opponents' progress/tempo, and consider a toggle to tone down the coach's "you're so close!" hype — both shrink the "I always get bombs" illusion honestly.
- **Seed + replay for QA:** the fastest way to investigate any future "this felt off" report is to replay the seed.
- **A committed fairness test** (Section 5) locks in everything above so a later gameplay change can't silently break it.

---

## 8. Deliverables summary

1. **Shuffle & distribution analysis** — Fisher–Yates, correct and unbiased; uniform tile frequency (χ² 13.5/26 df); §1–3.
2. **Fairness issues** — **none in randomization.** The "strong hands" feeling is assistance asymmetry + the gold mechanic + small samples; §4.
3. **Randomization redesign** — keep Fisher–Yates; add a committed fairness test and optional seeded/replayable RNG; avoid "anti-strong-hand" hacks that would break fairness; §5.
4. **Four-player behavior draft** — symmetric randomness, asymmetric strategy: shared fair deal, upgraded AI (defense/claims via the Analyst engine), difficulty tiers, optional personalities; §6.
5. **Extra balancing opportunities** — AI defense as the real difficulty lever, perception levers, seed/replay, fairness CI; §7.

**Awaiting your review. No implementation, and nothing will be committed, until you approve a direction.**

*One question for you, so I don't assume:* is your goal to make the human **win less** (i.e., stronger, more competitive cats), or to make the game **feel less lopsided** (perception/immersion), or both? The two point at different first steps — AI defense work vs. presentation — and it changes what I'd scope first.
