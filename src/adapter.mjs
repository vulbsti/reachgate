// The stdio adapter driver: runs a target written in another language as a child process and talks
// JSON Lines to it (one request per line on stdin, one response per line on stdout). The adapter is
// stateless: reachgate sends the whole state with every request. See docs/protocol.md.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { canonical, keyOf, digest } from './canonical.mjs';
import { TargetError, defaultLabel } from './target.mjs';

export const PROTOCOL_VERSION = 1;

/** Split a command line into argv, honouring single and double quotes (no shell is involved). */
export function splitCommand(cmd) {
  if (Array.isArray(cmd)) return cmd;
  const out = [];
  let cur = '', quote = null, any = false;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = '';
      any = false;
    } else cur += ch;
  }
  if (quote) throw new TargetError(`unclosed ${quote} in command: ${cmd}`, { fatal: true });
  if (cur || any) out.push(cur);
  return out;
}

/** Start an adapter process and return a driver for it. */
export async function adapterDriver(cmd, { cwd = process.cwd(), timeoutMs = 30000, env = process.env } = {}) {
  const argv = splitCommand(cmd);
  if (!argv.length) throw new TargetError('empty adapter command', { fatal: true });
  const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let nextId = 1, dead = null, stderrTail = '';

  const fail = (err) => {
    if (dead) return;
    dead = err;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  };
  child.on('error', (e) => fail(new TargetError(`could not start adapter "${argv.join(' ')}": ${e.message}`, { fatal: true })));
  child.on('exit', (code, signal) => fail(new TargetError(`adapter exited (${signal ?? 'code ' + code})${stderrTail ? ': ' + stderrTail.trim().split('\n').slice(-5).join(' | ') : ''}`, { fatal: true })));
  child.stdin.on('error', () => {}); // EPIPE after exit is reported by the exit handler
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d).slice(-4000);
    if (process.env.REACHGATE_ADAPTER_STDERR) process.stderr.write(d);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(new TargetError(`adapter wrote a line that is not JSON: ${line.slice(0, 200)}`, { fatal: true }));
      child.kill();
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
  });

  const request = (method, params = {}) => {
    if (dead) return Promise.reject(dead);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TargetError(`adapter did not answer "${method}" within ${timeoutMs} ms`, { fatal: true }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  };
  /** A request whose error is the adapter's fault, not the target's: always fatal. */
  const must = async (method, params) => {
    const r = await request(method, params);
    if (r.error) throw new TargetError(`adapter error on "${method}": ${r.error.message ?? JSON.stringify(r.error)}`, { fatal: true });
    return r.result;
  };

  const hello = await must('hello', { protocol: PROTOCOL_VERSION });
  if (hello?.protocol !== PROTOCOL_VERSION) {
    child.kill();
    throw new TargetError(`adapter speaks protocol ${hello?.protocol}, reachgate speaks ${PROTOCOL_VERSION}`, { fatal: true });
  }
  const labels = new Map(); // action canonical -> label the adapter gave it

  return {
    name: hello.name ?? argv.join(' '),
    source: argv.join(' '),
    kind: 'adapter',
    invariantIds: hello.invariants ?? [],
    transitionIds: hello.transitions ?? [],
    deadlock: !!hello.deadlock,
    describe: hello.describe ?? {},
    label: (a) => labels.get(canonical(a)) ?? defaultLabel(a),
    clone: (s) => s, // the adapter never mutates our copy: it only ever sees serialised JSON
    async initial() {
      return (await must('initial')).state;
    },
    async visit(state) {
      const r = await request('visit', { state });
      if (r.error) {
        return { actions: [], violations: [{ id: 'no-crash', message: r.error.message ?? 'visit failed' }], labels: [], hash: digest(canonical(state)), cell: null, terminal: true };
      }
      const v = r.result;
      const actions = (v.actions ?? []).map((x) => {
        // An action may come as { action, label } so the adapter controls how it prints.
        if (x && typeof x === 'object' && 'action' in x && 'label' in x && Object.keys(x).length === 2) {
          labels.set(canonical(x.action), String(x.label));
          return x.action;
        }
        return x;
      });
      return {
        actions,
        violations: v.violations ?? [],
        labels: (v.labels ?? []).map(String),
        hash: v.hash != null ? keyOf(v.hash) : digest(canonical(state)),
        cell: v.cell != null ? keyOf(v.cell) : null,
        terminal: !!v.terminal,
      };
    },
    async step(state, action) {
      const r = await request('step', { state, action });
      if (r.error) return { crash: r.error.message ?? 'step failed' };
      return { state: r.result.state, violations: r.result.violations ?? [] };
    },
    async close() {
      if (dead) return;
      // Ask politely, then give the process up to 500 ms to exit by itself before killing it. Timers
      // are cleared so a fast adapter doesn't keep reachgate alive for the full grace period.
      const exited = new Promise((res) => child.once('exit', res));
      let timer;
      const grace = new Promise((res) => { timer = setTimeout(res, 500); });
      try {
        await Promise.race([request('shutdown').then(() => Promise.race([exited, grace])), grace]);
      } catch {
        /* already gone */
      }
      clearTimeout(timer);
      dead = new TargetError('adapter closed', { fatal: true });
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}
