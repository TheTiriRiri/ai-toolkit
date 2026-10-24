#!/usr/bin/env node
"use strict";
// Entry point of `npx @thetiririri/10x-ai-toolkit` (copy mode) and of the package's postinstall (--postinstall).
process.exitCode = require("./lib/toolkit").runInstall(process.argv.slice(2));
