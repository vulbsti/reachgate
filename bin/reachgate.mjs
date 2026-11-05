#!/usr/bin/env node
import { main } from '../src/cli.mjs';
// `reachgate ... | head` closes stdout early. Swallow the rest of the output but keep running, so the
// exit code is still the verdict (exiting here would turn a FAIL into exit 0).
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e;
  process.stdout.write = () => true;
});
process.exitCode = await main();
