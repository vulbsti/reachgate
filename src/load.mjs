// Resolving "what to explore" into a driver: a JS module path (optionally path#exportName), a .py
// file (run through the stdio adapter), or an explicit adapter command.
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolve, extname, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { inProcessDriver, TargetError } from './target.mjs';
import { adapterDriver } from './adapter.mjs';

export const CONFIG_FILE = 'reachgate.config.json';

export function readConfig(cwd = process.cwd(), file = null) {
  const p = resolve(cwd, file ?? CONFIG_FILE);
  if (!existsSync(p)) {
    if (file) throw new TargetError(`config file not found: ${p}`, { fatal: true, usage: true });
    return { config: {}, dir: cwd };
  }
  try {
    return { config: JSON.parse(readFileSync(p, 'utf8')), dir: dirname(p), file: p };
  } catch (e) {
    throw new TargetError(`could not parse ${p}: ${e.message}`, { fatal: true });
  }
}

const JS = new Set(['.mjs', '.js', '.cjs']);

/** @param {{target?: string, cmd?: string|string[], cwd?: string}} spec */
export async function loadDriver({ target, cmd, cwd = process.cwd(), timeoutMs } = {}) {
  if (cmd) return adapterDriver(cmd, { cwd, timeoutMs });
  if (!target) throw new TargetError('no target: pass a target file, --cmd "<adapter command>", or set "target" in reachgate.config.json', { fatal: true, usage: true });
  const [file, exportName] = target.split('#');
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new TargetError(`target not found: ${path}`, { fatal: true, usage: true });
  const ext = extname(path);
  if (ext === '.py') return adapterDriver([process.platform === 'win32' ? 'python' : 'python3', path], { cwd, timeoutMs });
  if (!JS.has(ext)) throw new TargetError(`don't know how to load ${ext || 'a file without an extension'}: use a .mjs/.js target or --cmd "<adapter command>"`, { fatal: true, usage: true });
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (e) {
    // Node leaves the file out of a SyntaxError caught from import(). Parsing fails before any module
    // runs, so re-importing in a child process has no side effects, and its uncaught error names the file.
    let at = '';
    if (e instanceof SyntaxError) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path).href)})`], { encoding: 'utf8', timeout: 10000 });
      const loc = (r.stderr ?? '').split('\n')[0].trim();
      if (/^(file:\/\/|\/|[A-Za-z]:\\)\S+:\d+$/.test(loc)) at = ` (at ${loc.replace(/^file:\/\//, '')})`;
    }
    throw new TargetError(`could not import ${path}: ${e.message}${at}`, { cause: e, fatal: true });
  }
  let t = exportName ? mod[exportName] : (mod.default ?? mod.target);
  if (!t) throw new TargetError(`${path} has no ${exportName ? `export "${exportName}"` : 'default export (or export named "target")'}`, { fatal: true, usage: true });
  if (typeof t === 'function' && typeof t.initial !== 'function') t = await t();
  return inProcessDriver(t, { source: target });
}
