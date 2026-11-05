#!/usr/bin/env node
// Lint the Python files that ship with reachgate (adapter helper, templates, examples).
// Runs `python3 -m py_compile` on each file and, when `ruff` is on PATH, `ruff check`.
// Zero npm dependencies. Exit 0 when everything passes, 1 on any failure.
// Set PYTHON to use a different interpreter (default: python3).
import { readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['adapters', 'examples', 'templates'];
const SKIP = new Set(['__pycache__', 'node_modules', '.reachgate', '.venv', 'venv']);
const PYTHON = process.env.PYTHON || 'python3';

function pyFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pyFiles(p));
    else if (entry.isFile() && entry.name.endsWith('.py')) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => pyFiles(join(ROOT, d))).sort();
const rel = (p) => relative(ROOT, p);

if (files.length === 0) {
  console.log('check-python: no .py files found');
  process.exit(0);
}

let failed = false;

// Keep compiled bytecode out of the source tree.
const env = { ...process.env, PYTHONPYCACHEPREFIX: mkdtempSync(join(tmpdir(), 'reachgate-pycache-')) };
const compile = spawnSync(PYTHON, ['-m', 'py_compile', ...files], { cwd: ROOT, env, stdio: 'inherit' });
if (compile.error) {
  console.error(`check-python: could not run ${PYTHON} (${compile.error.code ?? compile.error.message}). Python 3.9+ is required to lint.`);
  process.exit(1);
}
if (compile.status !== 0) {
  console.error('check-python: py_compile failed');
  failed = true;
} else {
  console.log(`check-python: py_compile ok (${files.length} files)`);
}

const ruffProbe = spawnSync('ruff', ['--version'], { stdio: 'ignore' });
if (ruffProbe.error) {
  console.log('check-python: ruff not on PATH, skipping ruff check');
} else {
  const ruff = spawnSync('ruff', ['check', ...files.map(rel)], { cwd: ROOT, stdio: 'inherit' });
  if (ruff.status !== 0) {
    console.error('check-python: ruff check failed');
    failed = true;
  } else {
    console.log('check-python: ruff check ok');
  }
}

process.exit(failed ? 1 : 0);
