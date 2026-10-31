#!/usr/bin/env node
// Entry point of the `hueke` command: runs the CLI against the real file system.

import { readFileSync } from "node:fs";
import { run } from "./run.js";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  readFile: (path) => readFileSync(path, "utf8"),
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});
