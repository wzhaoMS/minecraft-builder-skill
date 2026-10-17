#!/usr/bin/env node
import { main } from '../src/cli/main.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
    // mineflayer/minecraft-protocol can leave timers behind; don't hang the CLI.
    setTimeout(() => process.exit(process.exitCode), 200).unref();
  },
  (err) => {
    process.stderr.write(`fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
