// Reports: a JSON report for machines, a Markdown report for people, and one witness file per
// violation. Witness files put one step per line so a diff of two witnesses reads step by step.

export const EXIT = { PASS: 0, FAIL: 1, USAGE: 2, ERROR: 3 };

export function exitCodeOf(result) {
  if (result.violations.some((v) => v.replayed === false)) return EXIT.ERROR;
  return result.violations.length ? EXIT.FAIL : EXIT.PASS;
}

export function witnessJson(w) {
  const { trace, ...head } = w;
  const steps = trace.map((s) => '  ' + JSON.stringify(s)).join(',\n');
  return `${JSON.stringify(head).slice(0, -1)},"trace":[${trace.length ? '\n' + steps + '\n' : ''}]}\n`;
}

/** The witness file content for a violation: actions plus their printed labels. */
export function witnessOf(result, v, driver) {
  return {
    reachgate: 1,
    target: result.target,
    kind: 'violation',
    id: v.id,
    message: v.message,
    length: v.length,
    shortest: v.shortest,
    minimal: v.minimal,
    trace: v.trace.map((a) => ({ label: driver.label(a), action: a })),
  };
}

/** Accept a witness file's trace in either form: [{label, action}] or plain [action]. */
export function actionsOf(witness) {
  const t = Array.isArray(witness) ? witness : witness.trace;
  if (!Array.isArray(t)) throw new Error('witness has no "trace" array');
  return t.map((s) => (s && typeof s === 'object' && 'action' in s && Object.keys(s).every((k) => k === 'action' || k === 'label') ? s.action : s));
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** How to name this target on a reachgate command line. */
export function replayTarget(driver) {
  if (!driver?.source) return '<target>';
  return driver.kind === 'adapter' && !/\.py$/.test(driver.source) ? `--cmd ${JSON.stringify(driver.source)}` : driver.source.split(' ').pop();
}

export function summaryLine(result) {
  const s = result.stats;
  const bad = result.violations.length;
  const space = s.exhaustive ? 'state space exhausted' : `stopped by ${s.stoppedBy} budget`;
  const verdict = bad ? 'FAIL' : result.incomplete ? 'INCOMPLETE (exit 3: --require-exhaustive, the search stopped on a budget)' : 'PASS';
  return `${verdict}: ${plural(bad, 'invariant')} violated · ${plural(s.states, 'state')}, ${plural(s.steps, 'step')}, ${Object.keys(result.labels).length} labels · ${space} · ${s.ms} ms`;
}

export function exploreMarkdown(result, { witnessFiles = {}, driver }) {
  const s = result.stats, L = [];
  L.push(`# reachgate report: ${result.target}`, '');
  L.push(`**${summaryLine(result)}**`, '');
  L.push(`- Strategy: \`${result.options.strategy}\`, seed ${result.options.seed}, budgets: ${result.options.maxSteps} steps, ${result.options.maxStates} states, ${result.options.maxSeconds}s${result.options.maxDepth ? `, depth ${result.options.maxDepth}` : ''}.`);
  L.push(`- Explored ${s.states} distinct states${s.cells ? ` in ${s.cells} cells` : ''}, deepest trace ${s.depth} steps.${s.exhaustive ? ' Every reachable state was visited.' : ` The search stopped on the ${s.stoppedBy} budget, so states beyond it were not checked.`}`);
  if (s.firstViolation) L.push(`- First violation (\`${s.firstViolation.id}\`) after ${s.firstViolation.ms} ms, ${s.firstViolation.steps} steps, ${s.firstViolation.states} states.`);
  for (const w of result.warnings) L.push(`- **Warning:** ${w}`);
  L.push('', '## Invariants', '', '| Invariant | Holds? | Witness |', '| --- | --- | --- |');
  for (const inv of result.invariants) {
    const v = result.violations.find((x) => x.id === inv.id);
    const name = inv.description ? `\`${inv.id}\`: ${esc(inv.description)}` : `\`${inv.id}\``;
    L.push(`| ${name} | ${v ? `**no** (${v.count}×)` : s.unexpanded && result.violations.length ? 'yes, outside the violating states*' : 'yes'} | ${v ? `${plural(v.length, 'step')}${v.shortest ? ' (shortest)' : ` (${v.minimal})`}${witnessFiles[v.id] ? ` · \`${witnessFiles[v.id]}\`` : ''}` : ''} |`);
  }
  if (s.unexpanded && result.violations.length) L.push('', `\\* ${s.unexpanded} state(s) that violate an invariant were not explored further (the default). Rerun with \`--expand-violations\` to check the other invariants past them.`);
  for (const v of result.violations) {
    L.push('', `## Violation: \`${v.id}\``, '');
    if (v.message) L.push(`> ${esc(v.message)}`, '');
    L.push(`Witness: ${plural(v.length, 'step')} from \`initial()\`, ${v.shortest ? 'shortest possible (BFS)' : v.minimal === '1-minimal' ? `1-minimal (shrunk from ${v.shrunk?.from} steps; no single step can be removed)` : 'not minimised'}. ${v.replayed === false ? '**Did not replay deterministically.**' : 'Replayed twice to the same violation.'}`, '');
    if (v.trace.length) {
      L.push('```');
      v.trace.forEach((a, i) => L.push(`${String(i + 1).padStart(3)}. ${driver.label(a)}`));
      L.push('```');
    } else L.push('The initial state already violates it.');
    if (witnessFiles[v.id]) L.push('', `Replay: \`reachgate replay ${replayTarget(driver)} ${witnessFiles[v.id]}\``);
  }
  const labels = Object.entries(result.labels);
  L.push('', `## Reachable labels (${labels.length})`, '');
  if (!labels.length) L.push('None. Add `observe(state)` to name the behaviour you want the baseline to track.');
  else {
    L.push('| Label | Shortest trace found |', '| --- | --- |');
    for (const [l, t] of labels.slice(0, 200)) L.push(`| \`${esc(l)}\` | ${plural(t.length, 'step')} |`);
    if (labels.length > 200) L.push(`| … and ${labels.length - 200} more (see report.json) | |`);
  }
  return L.join('\n') + '\n';
}

export function diffMarkdown(diff, { target, driver }) {
  const L = [], lab = (a) => driver.label(a);
  L.push(`# reachgate check: ${target}`, '');
  L.push(diff.verdict === 'pass' && diff.incomplete ? `**INCOMPLETE: nothing got worse in the states searched, but --require-exhaustive is set and the search stopped on the ${diff.stats.after.stoppedBy} budget, so this is not a pass (exit 3).**` : diff.verdict === 'pass' ? '**PASS: nothing reachable was lost and no invariant got worse than the baseline.**' : `**FAIL: ${diff.reasons.join('; ')}.**`, '');
  L.push(`Before: ${diff.stats.before.states} states${diff.stats.before.exhaustive ? ' (exhaustive)' : ''}. After: ${diff.stats.after.states} states${diff.stats.after.exhaustive ? ' (exhaustive)' : ''}. Failing on: ${diff.failOn.join(', ')}.`, '');
  const section = (title, items, fn) => {
    if (!items.length) return;
    L.push(`## ${title} (${items.length})`, '');
    for (const x of items) fn(x);
    L.push('');
  };
  section('Newly violated invariants', diff.regressed, (r) => {
    L.push(`- \`${r.id}\` (was: ${r.before}): ${esc(r.message || 'violated')}. Witness, ${plural(r.length, 'step')}${r.shortest ? ' (shortest)' : ''}: ${r.witness.map(lab).join(' → ') || '(the initial state)'}${r.witnessFile ? ` (\`${r.witnessFile}\`)` : ''}`);
  });
  section('No longer reachable', diff.lost, (x) => {
    L.push(`- \`${x.label}\`: ${x.diagnosis.text}.`);
    L.push(`  Baseline witness: ${x.baselineWitness.map(lab).join(' → ') || '(the initial state)'}${x.witnessFile ? ` (\`${x.witnessFile}\`)` : ''}`);
  });
  section('Newly reachable', diff.added, (x) => L.push(`- \`${x.label}\` via ${x.witness.map(lab).join(' → ') || '(the initial state)'}`));
  section('Fixed (violated in the baseline, holds now)', diff.fixed, (x) => L.push(`- \`${x.id}\``));
  section('Still violated (already in the baseline, not failing the gate)', diff.stillViolated, (x) => L.push(`- \`${x.id}\`: ${esc(x.message || '')} (${plural(x.length, 'step')})`));
  section('Invariants removed since the baseline', diff.removedInvariants.map((id) => ({ id })), (x) => L.push(`- \`${x.id}\``));
  section('Not found by this search but still reachable via the baseline witness', diff.recovered, (x) => L.push(`- \`${x.label}\` (${plural(x.length, 'step')})`));
  L.push('## What to do', '');
  if (diff.verdict === 'pass' && diff.incomplete) L.push('Bound the scenario (smaller value domains) or raise the budget until the report says "exhaustive", or drop --require-exhaustive if a partial search is acceptable here.');
  else if (diff.verdict === 'pass') L.push('Nothing. If labels were added on purpose, run `reachgate baseline` to record them.');
  else {
    L.push(`1. Replay a witness to see the regression step by step: \`reachgate replay ${replayTarget(driver)} <witness file>\` (files listed above).`);
    L.push('2. If the change in behaviour is a bug, fix the code and run `reachgate check` again.');
    L.push('3. If it is intended (a feature removed on purpose), say why in the PR and run `reachgate baseline` to accept it.');
  }
  return L.join('\n') + '\n';
}
