#!/usr/bin/env node
import { main } from '../src/cli.mjs';
// `reachgate ... | head` closes stdout early: that is not an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0); else throw e; });
process.exitCode = await main();
