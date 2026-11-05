// The reachgate command line. See `reachgate help` and docs/cli.md.
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDriver, readConfig } from './load.mjs';
import { explore, DEFAULTS } from './explore.mjs';
import { replay } from './replay.mjs';
import { signature, compare, exploreOptionsOf } from './baseline.mjs';
import { EXIT, exitCodeOf, summaryLine, exploreMarkdown, diffMarkdown, witnessJson, witnessOf, actionsOf } from './report.mjs';
import { canonical } from './canonical.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const HELP = `reachgate ${VERSION}: explore your code's reachable states, check invariants, gate changes on a baseline.

Usage:
  reachgate explore  [target]            explore, check invariants, write .reachgate/report.{json,md}
  reachgate baseline [target]            explore and record the behaviour baseline (reachgate.baseline.json)
  reachgate check    [target]            explore again and diff against the baseline (the gate)
  reachgate replay   [target] <witness>  replay a witness trace step by step
  reachgate inspect  [target]            show the initial state, its actions and invariants (wiring check)
  reachgate init     [--lang js|python]  write a starter target and reachgate.config.json

Target: a .mjs/.js file exporting the target (file.mjs#exportName picks a named export), a .py file
(run through the stdio adapter), or --cmd "<adapter command>". Defaults come from reachgate.config.json.

Options:
  --strategy bfs|go-explore   bfs (default) gives shortest witnesses; go-explore reaches deeper in budget
  --max-steps N               step() calls (default ${DEFAULTS.maxSteps})
  --max-states N              distinct states (default ${DEFAULTS.maxStates})
  --max-seconds N             wall-clock safety cap (default ${DEFAULTS.maxSeconds})
  --max-depth N               longest trace explored (default unlimited)
  --seed N                    PRNG seed for go-explore (default ${DEFAULTS.seed})
  --rollout N                 go-explore steps per return to a cell, at most (default ${DEFAULTS.rollout})
  --no-action-labels          leave "action:<label>" out of the reachable-behaviour signature
  --expand-violations         keep exploring past states that violate an invariant
  --require-exhaustive        exit 3 if the search stopped on a budget instead of exhausting the space
  --cmd "<command>"           run the target through the JSON-over-stdio adapter
  --config FILE               config file (default reachgate.config.json)
  --baseline FILE             baseline file (default reachgate.baseline.json)
  --out DIR                   where reports and witnesses go (default .reachgate)
  --fail-on LIST              check: comma list of lost,violation,new,removed (default lost,violation)
  --json                      print the JSON report to stdout instead of the summary
  --quiet                     no progress line on stderr (the summary still prints)

Exit codes: 0 pass · 1 fail (violation found, or check found a regression) · 2 usage/config error ·
            3 could not measure (target crashed in initial(), adapter died, witness not deterministic)`;

const NUM = { 'max-steps': 'maxSteps', 'max-states': 'maxStates', 'max-seconds': 'maxSeconds', 'max-depth': 'maxDepth', seed: 'seed', rollout: 'rollout' };
const STR = new Set(['strategy', 'cmd', 'config', 'baseline', 'out', 'fail-on', 'lang']);
const BOOL = new Set(['json', 'quiet', 'no-action-labels', 'expand-violations', 'require-exhaustive', 'force', 'help', 'version']);

class UsageError extends Error {}

export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a === '-v') { flags.version = true; continue; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    let [k, v] = a.slice(2).split(/=(.*)/s);
    if (BOOL.has(k)) { flags[k] = true; continue; }
    if (!(k in NUM) && !STR.has(k)) throw new UsageError(`unknown option --${k} (see reachgate help)`);
    if (v === undefined) {
      v = argv[++i];
      if (v === undefined) throw new UsageError(`--${k} needs a value`);
    }
    if (k in NUM) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${k} must be a non-negative number, got "${v}"`);
      flags[k] = n;
    } else flags[k] = v;
  }
  return { pos, flags };
}

/** Exploration options: defaults < config file < (baseline, for check) < command-line flags. */
function exploreOptions(config, flags, base = {}) {
  const o = { ...base };
  for (const k of ['strategy', 'maxSteps', 'maxStates', 'maxSeconds', 'maxDepth', 'seed', 'rollout', 'actionLabels', 'expandViolations']) if (config[k] !== undefined && base[k] === undefined) o[k] = config[k];
  for (const [flag, key] of Object.entries(NUM)) if (flags[flag] !== undefined) o[key] = flags[flag];
  if (flags.strategy) o.strategy = flags.strategy;
  if (flags['no-action-labels']) o.actionLabels = false;
  if (flags['expand-violations']) o.expandViolations = true;
  if (o.strategy && !['bfs', 'go-explore'].includes(o.strategy)) throw new UsageError(`--strategy must be bfs or go-explore, got "${o.strategy}"`);
  return o;
}

export async function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), cwd: process.cwd() }) {
  const say = (s = '') => io.out(s + '\n');
  const warn = (s) => io.err(s + '\n');
  let driver = null;
  try {
    const { pos, flags } = parseArgs(argv);
    if (flags.version) return say(VERSION), EXIT.PASS;
    const cmd = pos.shift();
    if (!cmd || flags.help || cmd === 'help') return say(HELP), cmd || flags.help ? EXIT.PASS : EXIT.USAGE;
    if (cmd === 'init') return init(flags, io.cwd, say);
    if (!['explore', 'baseline', 'check', 'replay', 'inspect'].includes(cmd)) throw new UsageError(`unknown command "${cmd}" (see reachgate help)`);

    const { config, dir } = readConfig(io.cwd, flags.config);
    let witnessPath = null;
    if (cmd === 'replay') {
      witnessPath = pos.pop();
      if (!witnessPath) throw new UsageError('replay needs a witness file: reachgate replay [target] <witness.json>');
    }
    const spec = pos[0] ? { target: pos[0], cwd: io.cwd } : flags.cmd ? { cmd: flags.cmd, cwd: io.cwd } : config.cmd ? { cmd: config.cmd, cwd: dir } : { target: config.target, cwd: dir };
    if (pos[0] && flags.cmd) throw new UsageError('give either a target file or --cmd, not both');
    if (flags.cmd) spec.cmd = flags.cmd;
    const outDir = resolve(io.cwd, flags.out ?? config.out ?? '.reachgate');
    const baselineFile = resolve(io.cwd, flags.baseline ?? (config.baseline ? resolve(dir, config.baseline) : 'reachgate.baseline.json'));
    const rel = (p) => { const r = relative(io.cwd, p) || '.'; return r.startsWith('..') ? p : r; };
    const progress = flags.quiet || flags.json || !process.stderr.isTTY ? undefined : (s) => io.err(`\r  ${Math.round(s.ms / 1000)}s: ${s.states} states, ${s.steps} steps, ${s.violations} violations, ${s.labels} labels   `);
    const endProgress = () => progress && io.err('\r' + ' '.repeat(78) + '\r');

    if (cmd === 'check' && !existsSync(baselineFile)) throw new UsageError(`no baseline at ${rel(baselineFile)}: run "reachgate baseline" first (on the code before your change) and commit it`);
    driver = await loadDriver(spec);

    if (cmd === 'inspect') return await inspect(driver, say);
    if (cmd === 'replay') return await replayCmd(driver, resolve(io.cwd, witnessPath), say, flags);

    let base = null, opts;
    if (cmd === 'check') {
      base = JSON.parse(readFileSync(baselineFile, 'utf8'));
      opts = exploreOptions(config, flags, exploreOptionsOf(base));
    } else opts = exploreOptions(config, flags);
    const result = await explore(driver, { ...opts, onProgress: progress });
    endProgress();
    // A pass on a partial search is only a pass on what was searched. Where the space is meant to be
    // finite, --require-exhaustive turns "stopped on a budget" into "could not measure" (exit 3).
    const requireExhaustive = flags['require-exhaustive'] || config.requireExhaustive === true;
    const incomplete = requireExhaustive && !result.stats.exhaustive;
    result.incomplete = incomplete;
    if (incomplete) result.warnings.push(`--require-exhaustive: the search stopped on the ${result.stats.stoppedBy} budget after ${result.stats.states} states, so not every reachable state was checked. Bound the scenario or raise the budget.`);
    mkdirSync(join(outDir, 'witnesses'), { recursive: true });
    // Witnesses from the previous run move to witnesses/previous/: they no longer look like open violations,
    // but `reachgate replay` on them can still confirm a fix (exit 1: replays, violation gone).
    const W = join(outDir, 'witnesses'), P = join(W, 'previous');
    const old = readdirSync(W).filter((f) => f.endsWith('.json'));
    if (old.length) {
      mkdirSync(P, { recursive: true });
      for (const f of readdirSync(P)) if (f.endsWith('.json')) rmSync(join(P, f));
      for (const f of old) renameSync(join(W, f), join(P, f));
    }
    const witnessFiles = {};
    for (const v of result.violations) {
      const f = join(outDir, 'witnesses', `${v.id.replace(/[^\w.-]+/g, '_')}.json`);
      writeFileSync(f, witnessJson(witnessOf(result, v, driver)));
      witnessFiles[v.id] = rel(f);
    }
    const report = { reachgate: 1, tool: VERSION, ...result, violations: result.violations.map((v) => ({ ...v, witnessFile: witnessFiles[v.id] ?? null })), exitCode: incomplete && exitCodeOf(result) === EXIT.PASS ? EXIT.ERROR : exitCodeOf(result) };
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1) + '\n');
    writeFileSync(join(outDir, 'report.md'), exploreMarkdown(result, { witnessFiles, driver }));

    if (cmd === 'explore') {
      if (flags.json) say(JSON.stringify(report, null, 1));
      else {
        say(summaryLine(result));
        for (const v of result.violations) say(`  ✗ ${v.id}: ${v.message || 'violated'}\n    witness (${v.length} steps${v.shortest ? ', shortest' : `, ${v.minimal}`}): ${v.trace.map((a) => driver.label(a)).join(' → ') || '(initial state)'}\n    replay: reachgate replay ${spec.target ?? '--cmd ' + JSON.stringify(spec.cmd)} ${witnessFiles[v.id]}`);
        for (const w of result.warnings) warn(`warning: ${w}`);
        say(`report: ${rel(join(outDir, 'report.md'))}`);
      }
      return report.exitCode;
    }
    if (cmd === 'baseline') {
      writeFileSync(baselineFile, JSON.stringify(signature(result, { version: VERSION }), null, 1) + '\n');
      if (flags.json) say(JSON.stringify(signature(result, { version: VERSION }), null, 1));
      else {
        say(summaryLine(result));
        say(`baseline: ${rel(baselineFile)} (${Object.keys(result.labels).length} labels, ${result.invariants.length} invariants incl. built-in no-crash${result.violations.length ? `, ${result.violations.length} already violated: they won't fail the gate until fixed and broken again` : ''})`);
        for (const w of result.warnings) warn(`warning: ${w}`);
      }
      return result.violations.some((v) => v.replayed === false) || incomplete ? EXIT.ERROR : EXIT.PASS;
    }
    // check
    const failOn = (flags['fail-on'] ?? config.failOn ?? 'lost,violation').toString().split(',').map((s) => s.trim()).filter(Boolean);
    const bad = failOn.filter((x) => !['lost', 'violation', 'new', 'removed'].includes(x));
    if (bad.length) throw new UsageError(`--fail-on: unknown ${bad.join(', ')} (use lost, violation, new, removed)`);
    const diff = await compare(driver, base, result, { failOn });
    diff.incomplete = incomplete;
    const save = (name, trace, extra) => {
      const f = join(outDir, 'witnesses', `${name.replace(/[^\w.-]+/g, '_').slice(0, 100)}.json`);
      writeFileSync(f, witnessJson({ reachgate: 1, target: result.target, ...extra, length: trace.length, trace: trace.map((a) => ({ label: driver.label(a), action: a })) }));
      return rel(f);
    };
    for (const x of diff.lost) x.witnessFile = save(`lost_${x.label}`, x.baselineWitness, { kind: 'baseline-label', label: x.label, note: x.diagnosis.text });
    for (const x of diff.regressed) x.witnessFile = witnessFiles[x.id];
    const md = diffMarkdown(diff, { target: result.target, driver });
    const diffJson = { reachgate: 1, tool: VERSION, target: result.target, baseline: rel(baselineFile), ...diff, exitCode: diff.verdict === 'pass' ? EXIT.PASS : EXIT.FAIL };
    if (result.violations.some((v) => v.replayed === false) || (incomplete && diffJson.exitCode === EXIT.PASS)) diffJson.exitCode = EXIT.ERROR;
    writeFileSync(join(outDir, 'diff.json'), JSON.stringify(diffJson, null, 1) + '\n');
    writeFileSync(join(outDir, 'diff.md'), md);
    if (flags.json) say(JSON.stringify(diffJson, null, 1));
    else {
      say(md.trimEnd());
      for (const w of result.warnings) warn(`warning: ${w}`);
      say('', `diff: ${rel(join(outDir, 'diff.md'))} · json: ${rel(join(outDir, 'diff.json'))}`);
    }
    return diffJson.exitCode;
  } catch (e) {
    if (e instanceof UsageError || e?.usage) {
      warn(`reachgate: ${e.message}`);
      return EXIT.USAGE;
    }
    warn(`reachgate: could not measure: ${e?.message ?? e}`);
    if (process.env.REACHGATE_DEBUG) warn(e?.stack ?? '');
    return EXIT.ERROR;
  } finally {
    await driver?.close();
  }
}

async function inspect(driver, say) {
  const s = await driver.initial();
  const info = await driver.visit(s);
  const short = (x) => { const c = canonical(x); return c.length > 400 ? c.slice(0, 400) + '…' : c; };
  say(`target: ${driver.name} (${driver.kind}${driver.source ? ': ' + driver.source : ''})`);
  say(`invariants: ${[...driver.invariantIds, ...driver.transitionIds].join(', ') || '(none: add some, or reachgate only checks no-crash)'}`);
  say(`deadlock detection: ${driver.deadlock ? 'on (isTerminal is defined)' : `off (define ${driver.kind === 'adapter' ? 'is_terminal (Python helper) or report terminal in visit' : 'isTerminal'} to turn it on)`}`);
  say(`initial state: ${short(s)}`);
  say(`  hash ${info.hash}${info.cell ? ` · cell ${info.cell}` : ''}`);
  say(`  labels: ${info.labels.join(', ') || '(none: add observe(state) to name behaviour for the baseline)'}`);
  say(`  violations: ${info.violations.map((v) => v.id).join(', ') || 'none'}`);
  say(`  ${info.actions.length} action(s):`);
  for (const a of info.actions.slice(0, 20)) {
    const r = await driver.step(s, a);
    if (r.crash) { say(`    ${driver.label(a)}  →  CRASH: ${r.crash}`); continue; }
    const ni = await driver.visit(r.state);
    say(`    ${driver.label(a)}  →  ${ni.hash === info.hash ? 'same state' : 'new state'}${ni.violations.length || r.violations.length ? ` (violates ${[...r.violations, ...ni.violations].map((v) => v.id).join(', ')})` : ''}`);
  }
  if (info.actions.length > 20) say(`    … and ${info.actions.length - 20} more`);
  if (!info.actions.length) say('    (none: affordances(initial) returned nothing, so there is nothing to explore)');
  return EXIT.PASS;
}

async function replayCmd(driver, file, say, flags) {
  if (!existsSync(file)) throw new UsageError(`witness not found: ${file}`);
  const w = JSON.parse(readFileSync(file, 'utf8'));
  const trace = actionsOf(w);
  const r = await replay(driver, trace);
  const at = new Map();
  for (const v of r.violations) (at.get(v.at) ?? at.set(v.at, []).get(v.at)).push(v);
  const newLabels = new Map();
  for (const [l, i] of r.labelAt) if (!l.startsWith('action:')) (newLabels.get(i) ?? newLabels.set(i, []).get(i)).push(l);
  const lines = [];
  const show = (i) => {
    for (const l of newLabels.get(i) ?? []) lines.push(`       + ${l}`);
    for (const v of at.get(i) ?? []) lines.push(`       ✗ ${v.id}${v.message ? ': ' + v.message : ''}`);
  };
  lines.push(`replaying ${trace.length} step(s) on ${driver.name}${w.id ? ` (recorded violation: ${w.id})` : ''}`);
  lines.push('  0. initial()');
  show(0);
  const upto = r.ok ? trace.length : r.divergence.at + (r.divergence.reason === 'crashed' ? 1 : 0);
  for (let i = 0; i < upto; i++) {
    lines.push(`${String(i + 1).padStart(3)}. ${driver.label(trace[i])}`);
    show(i + 1);
  }
  let code;
  if (!r.ok) {
    lines.push(r.divergence.reason === 'not-offered'
      ? `DIVERGED at step ${r.divergence.at + 1}: ${r.divergence.action} is not offered. Offered: ${r.divergence.offered.join(', ') || '(nothing)'}`
      : `DIVERGED at step ${r.divergence.at + 1}: ${r.divergence.action} threw before the end of the trace`);
    code = EXIT.ERROR;
  } else if (w.id) {
    const hit = r.violations.find((v) => v.id === w.id);
    lines.push(hit ? `REPRODUCED: ${w.id} at step ${hit.at}` : `NOT REPRODUCED: the trace replays, but ${w.id} no longer happens (fixed?)`);
    code = hit ? EXIT.PASS : EXIT.FAIL;
  } else if (w.label) {
    const ok = r.labels.has(w.label);
    lines.push(ok ? `REACHED: ${w.label} at step ${r.labelAt.get(w.label)}` : `NOT REACHED: the trace replays, but ${w.label} is not reached along it${w.note ? ` (${w.note})` : ''}`);
    code = ok ? EXIT.PASS : EXIT.FAIL;
  } else {
    lines.push('REPLAYED: every step was offered and applied');
    code = EXIT.PASS;
  }
  if (flags.json) say(JSON.stringify({ ok: r.ok, divergence: r.divergence ?? null, violations: r.violations, labels: [...r.labelAt].map(([label, at]) => ({ label, at })), exitCode: code }, null, 1));
  else say(lines.join('\n'));
  return code;
}

function init(flags, cwd, say) {
  const lang = flags.lang ?? 'js';
  if (!['js', 'python'].includes(lang)) throw new UsageError(`--lang must be js or python, got "${lang}"`);
  const files = lang === 'js'
    ? [['reachgate.target.mjs', 'target.mjs']]
    : [['reachgate_target.py', 'target.py'], ['reachgate_adapter.py', null]];
  const written = [];
  for (const [name, tpl] of files) {
    const dest = join(cwd, name);
    if (existsSync(dest) && !flags.force) throw new UsageError(`${name} already exists (use --force to overwrite)`);
    if (tpl) copyFileSync(join(ROOT, 'templates', tpl), dest);
    else copyFileSync(join(ROOT, 'adapters', 'python', 'reachgate_adapter.py'), dest);
    written.push(name);
  }
  const cfg = join(cwd, 'reachgate.config.json');
  if (!existsSync(cfg) || flags.force) {
    writeFileSync(cfg, JSON.stringify({ target: lang === 'js' ? './reachgate.target.mjs' : './reachgate_target.py', strategy: 'bfs', maxSteps: 200000, maxStates: 100000, baseline: 'reachgate.baseline.json', out: '.reachgate' }, null, 2) + '\n');
    written.push('reachgate.config.json');
  }
  say(`wrote ${written.join(', ')}`);
  say('next:');
  say(`  1. edit ${files[0][0]}: point initial/affordances/step at your code, add invariants`);
  say('  2. reachgate inspect        check the wiring');
  say('  3. reachgate explore        find violations');
  say('  4. reachgate baseline       record behaviour (commit reachgate.baseline.json; add .reachgate/ to .gitignore)');
  say('  5. reachgate check          after every change: the gate');
  return EXIT.PASS;
}
