"use strict";
/* Meowjong test runner — loads every *.test.js, then runs the suite.
   Usage:  node tests/run.js   (or: npm test) */

require("./tiles.test");
require("./engine.test");
require("./scoring.test");
require("./ai.test");
require("./shanten.test");
require("./net.test");
require("./emotes.test");
require("./save.test");
require("./hand-history.test");
require("./fairness.test");
require("./scene3d.test");

const { run } = require("./harness");
process.exit(run());
