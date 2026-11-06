#!/usr/bin/env node
// Benchmarks every example: node bench/run.mjs [--runs N] [--only <example>] [--examples <dir>]
//
// Examples are discovered as examples/<name>/target.mjs or target.py. An optional
// examples/<name>/bench.json lists the variants to run:
//   {"variants": [{"target": "target.mjs#deep", "strategy": "go-explore", "maxSteps": 200000, "seed": 1}]}
// A .py variant may add "args": ["--fixed"] (passed to the adapter script).
// Without it, one BFS run of target.mjs (or target.py) with the default budgets.
//
// Each variant runs the real CLI in a child process (`reachgate explore <target> --json --quiet`) N
// times (default 3) and reports the median wall time and peak RSS. Writes docs/benchmarks.md and
// bench/results.json (with --only, the other examples' rows are kept from the previous results).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'reachgate.mjs');
const RSS_HOOK = join(ROOT, 'bench', 'rss-hook.mjs');
const PY_RSS = join(ROOT, 'bench', 'py_rss.py');
const GNU_TIME = existsSync('/usr/bin/time') ? '/usr/bin/time' : null;
const FLAGS = { strategy: '--strategy', maxSteps: '--max-steps', maxStates: '--max-states', maxSeconds: '--max-seconds', maxDepth: '--max-depth', seed: '--seed', rollout: '--rollout' };

function parseArgs(argv) {
  const o = { runs: 3, only: null, examples: join(ROOT, 'examples') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') o.runs = Number(argv[++i]);
    else if (argv[i] === '--only') o.only = argv[++i];
    else if (argv[i] === '--examples') o.examples = resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]} (use --runs N, --only <example>, --examples <dir>)`);
  }
  if (!(o.runs >= 1)) throw new Error('--runs must be at least 1');
  return o;
}

function discover(examplesDir) {
  if (!existsSync(examplesDir)) return [];
  const out = [];
  for (const name of readdirSync(examplesDir).sort()) {
    const dir = join(examplesDir, name);
    const file = ['target.mjs', 'target.py'].find((f) => existsSync(join(dir, f)));
    if (!file) continue;
    const cfg = join(dir, 'bench.json');
    const variants = existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')).variants : [{ target: file, strategy: 'bfs' }];
    out.push({ name, dir, variants });
  }
  return out;
}

const readKb = (f) => (existsSync(f) ? Number(readFileSync(f, 'utf8').trim().split('\n').pop()) || null : null);

/** One CLI run. Node's peak RSS comes from /usr/bin/time when the CLI has no child of its own (JS
 * targets), else from process.resourceUsage() inside the CLI; a .py adapter records its own. */
function runOnce(example, variant) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'reachgate-bench-'));
  const [file] = variant.target.split('#');
  const path = join(example.dir, variant.target);
  const py = extname(file) === '.py';
  const args = ['explore'];
  if (py) args.push('--cmd', `python3 "${PY_RSS}" "${join(tmp, 'adapter.rss')}" "${join(example.dir, file)}"${(variant.args ?? []).map((x) => ` ${x}`).join('')}`);
  else args.push(path);
  for (const [k, flag] of Object.entries(FLAGS)) if (variant[k] !== undefined) args.push(flag, String(variant[k]));
  args.push('--json', '--quiet', '--out', join(tmp, 'out'));
  const nodeRss = join(tmp, 'node.rss');
  const viaTime = GNU_TIME && !py;
  const [cmd, argv] = viaTime
    ? [GNU_TIME, ['-f', '%M', '-o', nodeRss, process.execPath, CLI, ...args]]
    : [process.execPath, ['--import', RSS_HOOK, CLI, ...args]];
  try {
    const t0 = performance.now();
    const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, REACHGATE_BENCH_RSS: nodeRss } });
    const wallMs = Math.round(performance.now() - t0);
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      throw new Error(`${example.name} ${variant.target}: the CLI printed no JSON report (exit ${r.status}): ${r.stderr.trim().slice(-500)}`);
    }
    const s = report.stats;
    const first = s.firstViolation ? report.violations.find((v) => v.id === s.firstViolation.id) : null;
    return {
      exitCode: r.status,
      wallMs,
      nodeRssKb: readKb(nodeRss),
      adapterRssKb: py ? readKb(join(tmp, 'adapter.rss')) : undefined,
      exploreMs: s.ms,
      states: s.states,
      steps: s.steps,
      depth: s.depth,
      stoppedBy: s.stoppedBy,
      exhaustive: s.exhaustive,
      violations: report.violations.map((v) => v.id),
      firstViolation: s.firstViolation ? { id: s.firstViolation.id, ms: s.firstViolation.ms, steps: s.firstViolation.steps, witness: first?.length ?? null, minimal: first?.minimal ?? null } : null,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
};

function summarise(runs) {
  const keyOf = (r) => JSON.stringify([r.states, r.steps, r.violations, r.firstViolation?.steps]);
  return {
    wallMs: median(runs.map((r) => r.wallMs)),
    exploreMs: median(runs.map((r) => r.exploreMs)),
    firstViolationMs: median(runs.map((r) => r.firstViolation?.ms)),
    nodeRssKb: median(runs.map((r) => r.nodeRssKb)),
    adapterRssKb: median(runs.map((r) => r.adapterRssKb)),
    deterministic: new Set(runs.map(keyOf)).size === 1, // same states, steps and findings every run
  };
}

function machine() {
  const cpuinfo = existsSync('/proc/cpuinfo') ? readFileSync('/proc/cpuinfo', 'utf8') : '';
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return {
    cpu: cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1] ?? os.cpus()[0]?.model ?? 'unknown',
    cores: os.availableParallelism?.() ?? os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    python: py.status === 0 ? (py.stdout || py.stderr).trim().replace(/^Python /, '') : 'not found',
    loadAvg: os.loadavg().map((x) => x.toFixed(2)).join(' '),
    date: new Date().toISOString().slice(0, 10),
    rss: `Node: ${GNU_TIME ? '/usr/bin/time -f %M on the CLI process for JS targets, ' : ''}process.resourceUsage().maxRSS inside the CLI${GNU_TIME ? ' for Python targets' : ''} (Node only). Python adapter: getrusage(RUSAGE_SELF) inside the adapter process (bench/py_rss.py).`,
  };
}

const mb = (kb) => (kb == null ? 'n/a' : `${(kb / 1024).toFixed(0)} MB`);
const num = (n) => (n == null ? '' : n.toLocaleString('en-US'));

function markdown(results, m, runs) {
  const L = ['# Benchmarks', ''];
  L.push(`Generated by \`node bench/run.mjs\` on ${m.date}. Each row is the median of ${runs} run${runs === 1 ? '' : 's'} of the real CLI`);
  L.push('(`reachgate explore <target> --json --quiet`) in a child process. States, steps and findings are');
  L.push('deterministic for a given seed and budget; times and memory depend on the machine.', '');
  L.push('| Machine | |', '| --- | --- |');
  L.push(`| CPU | ${m.cpu} (${m.cores} cores) |`, `| Memory | ${m.memoryGb} GB |`, `| OS | ${m.os} |`, `| Node | ${m.node} |`, `| Python | ${m.python} |`, `| Load average at start | ${m.loadAvg} |`, `| Peak RSS | ${m.rss} |`, '');
  L.push('Columns: **deepest** is the longest trace explored. **Stopped by** is `exhausted` when every reachable state was visited (BFS) or the budget that');
  L.push('ran out. **First violation** is the time (and steps) until the first invariant violation was seen;');
  L.push('**witness** is that violation\'s trace length (shortest for BFS, 1-minimal after shrinking for Go-Explore).');
  for (const ex of results) {
    const py = ex.variants.some((v) => v.target.split('#')[0].endsWith('.py'));
    L.push('', `## ${ex.name}`, '');
    L.push(`| Target | Strategy | Budget | Violations | States | Steps | Deepest | Stopped by | First violation | Witness | Wall | Peak RSS (Node)${py ? ' | Peak RSS (adapter)' : ''} |`);
    L.push(`| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---:${py ? ' | ---:' : ''} |`);
    for (const v of ex.variants) {
      const r = v.runs[0], md = v.median, fv = r.firstViolation;
      const budget = [v.maxSteps ? `${num(v.maxSteps)} steps` : 'default', v.seed !== undefined ? `seed ${v.seed}` : ''].filter(Boolean).join(', ');
      L.push(`| \`${v.target}${v.args ? ' ' + v.args.join(' ') : ''}\` | ${v.strategy ?? 'bfs'} | ${budget} | ${r.violations.join(', ') || 'none'} | ${num(r.states)} | ${num(r.steps)} | ${r.depth} | ${r.stoppedBy}${md.deterministic ? '' : ' (varied!)'} | ${fv ? `${md.firstViolationMs} ms, ${num(fv.steps)} steps` : ''} | ${fv?.witness ?? ''} | ${(md.wallMs / 1000).toFixed(2)} s | ${mb(md.nodeRssKb)}${py ? ` | ${mb(md.adapterRssKb)}` : ''} |`);
    }
  }
  return L.join('\n') + '\n';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const examples = discover(opts.examples).filter((e) => !opts.only || e.name === opts.only);
  if (!examples.length) throw new Error('no examples found (looked for examples/*/target.mjs and target.py)');
  const m = machine();
  const results = [];
  for (const ex of examples) {
    const variants = [];
    for (const v of ex.variants) {
      const runs = [];
      for (let i = 0; i < opts.runs; i++) {
        process.stderr.write(`\r${ex.name} ${v.target} ${v.strategy ?? 'bfs'}${v.seed !== undefined ? ` seed ${v.seed}` : ''}: run ${i + 1}/${opts.runs}   `);
        runs.push(runOnce(ex, v));
      }
      variants.push({ ...v, runs, median: summarise(runs) });
    }
    results.push({ name: ex.name, variants });
  }
  process.stderr.write('\n');
  // --only re-measures one example and keeps the others from the last full run.
  const resultsFile = join(ROOT, 'bench', 'results.json');
  if (opts.only && existsSync(resultsFile)) {
    const kept = JSON.parse(readFileSync(resultsFile, 'utf8')).examples.filter((e) => e.name !== opts.only);
    results.push(...kept);
    results.sort((a, b) => a.name.localeCompare(b.name));
  }
  writeFileSync(resultsFile, JSON.stringify({ machine: m, runs: opts.runs, examples: results }, null, 1) + '\n');
  writeFileSync(join(ROOT, 'docs', 'benchmarks.md'), markdown(results, m, opts.runs));
  console.log(`wrote docs/benchmarks.md and bench/results.json (${results.reduce((n, e) => n + e.variants.length, 0)} variants × ${opts.runs} runs)`);
}

main().catch((e) => {
  console.error(`bench: ${e.message}`);
  process.exitCode = 1;
});
