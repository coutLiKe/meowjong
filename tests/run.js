"use strict";
/* Meowjong test runner — loads every *.test.js, then runs the suite.
   Usage:  node tests/run.js   (or: npm test) */

require("./tiles.test");
require("./engine.test");
require("./scoring.test");
require("./ai.test");
require("./net.test");
require("./save.test");
require("./fairness.test");

const { run } = require("./harness");
process.exit(run());
