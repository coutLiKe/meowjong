"use strict";
const { loadGame, test, eq, ok, notOk } = require("./harness");

test("handHistoryRecord appends a hand and reuses G.myDiscardLog's trace shape", () => {
  const { T } = loadGame();
  T.G.myDiscardLog = [{ kind: 5, before: 3, after: 2 }, { kind: 9, before: 2, after: 2 }];
  T.handHistoryRecord({ youWon: true, flowers: 2, points: 40, handKinds: [1, 2, 3] });
  const hands = T.handHistoryLoad();
  eq(hands.length, 1);
  eq(hands[0].youWon, true);
  eq(hands[0].flowers, 2);
  eq(hands[0].points, 40);
  eq(hands[0].handKinds, [1, 2, 3]);
  eq(hands[0].discardTrace, [{ kind: 5, before: 3, after: 2 }, { kind: 9, before: 2, after: 2 }]);
  ok(Number.isFinite(hands[0].date));
});

test("handHistoryRecord defaults cover a draw (no args) cleanly", () => {
  const { T } = loadGame();
  T.G.myDiscardLog = [];
  T.handHistoryRecord({});
  const hands = T.handHistoryLoad();
  eq(hands.length, 1);
  eq(hands[0].youWon, false);
  eq(hands[0].dealtIn, false);
  eq(hands[0].handKinds, []);
  eq(hands[0].discardTrace, []);
});

test("handHistoryRecord evicts the oldest hand past the cap", () => {
  const { T } = loadGame();
  T.G.myDiscardLog = [];
  for (let i = 0; i < T.HAND_HISTORY_CAP + 5; i++) {
    T.handHistoryRecord({ points: i });
  }
  const hands = T.handHistoryLoad();
  eq(hands.length, T.HAND_HISTORY_CAP, "capped at HAND_HISTORY_CAP entries");
  eq(hands[0].points, 5, "oldest 5 evicted, first surviving entry is #5");
  eq(hands[hands.length - 1].points, T.HAND_HISTORY_CAP + 4, "newest entry kept");
});

test("handHistoryLoad rejects corrupt JSON", () => {
  const { T, localStorage } = loadGame();
  localStorage.setItem(T.HAND_HISTORY_KEY, "{ this is not json");
  eq(T.handHistoryLoad(), []);
});

test("handHistoryLoad rejects a wrong schema version", () => {
  const { T, localStorage } = loadGame();
  localStorage.setItem(T.HAND_HISTORY_KEY, JSON.stringify({ v: 999, hands: [{ youWon: true }] }));
  eq(T.handHistoryLoad(), [], "old/future version → ignored, not crashed");
});

test("handHistoryLoad rejects a malformed blob (hands not an array)", () => {
  const { T, localStorage } = loadGame();
  localStorage.setItem(T.HAND_HISTORY_KEY, JSON.stringify({ v: T.HAND_HISTORY_VERSION, hands: "nope" }));
  eq(T.handHistoryLoad(), []);
});

test("handHistoryLoad returns [] when nothing has been saved yet", () => {
  const { T } = loadGame();
  eq(T.handHistoryLoad(), []);
});
