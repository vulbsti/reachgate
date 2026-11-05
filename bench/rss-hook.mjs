// Preloaded into the CLI by bench/run.mjs (`node --import`) when /usr/bin/time can't be used: writes
// this process's own peak RSS, in KiB, to the file named by REACHGATE_BENCH_RSS when it exits.
import { writeFileSync } from 'node:fs';

process.on('exit', () => {
  if (process.env.REACHGATE_BENCH_RSS) writeFileSync(process.env.REACHGATE_BENCH_RSS, String(process.resourceUsage().maxRSS));
});
