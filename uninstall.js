#!/usr/bin/env node
"use strict";
// Entry point of `npx -p @thetiriri/10x-ai-toolkit 10x-ai-toolkit-uninstall`; works from the manifest alone.
process.exitCode = require("./lib/toolkit").runUninstall(process.argv.slice(2));
