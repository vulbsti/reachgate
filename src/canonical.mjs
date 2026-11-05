// Canonical JSON: the same value always prints the same way (object keys sorted), so it can be
// hashed and compared. Used for state identity, action equality during replay, and default labels.
import { createHash } from 'node:crypto';

/** Stable stringify. Objects get sorted keys; Map/Set become sorted entry lists; NaN/±Infinity and
 * undefined get explicit tokens so they never collide with null. */
export function canonical(value) {
  return walk(value);
}

function walk(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      if (Number.isNaN(v)) return '"__NaN__"';
      if (!Number.isFinite(v)) return v > 0 ? '"__Inf__"' : '"__-Inf__"';
      return Object.is(v, -0) ? '0' : String(v);
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'undefined': return '"__undefined__"';
    case 'bigint': return `"__bigint:${v}"`;
    case 'function': case 'symbol':
      throw new TypeError(`reachgate: state and actions must be data, found a ${typeof v}`);
  }
  if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
  if (v instanceof Map) return '{"__map__":[' + [...v].map(([k, x]) => '[' + walk(k) + ',' + walk(x) + ']').sort().join(',') + ']}';
  if (v instanceof Set) return '{"__set__":[' + [...v].map(walk).sort().join(',') + ']}';
  if (v instanceof Date) return `"__date:${v.toISOString()}"`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + walk(v[k])).join(',') + '}';
}

/** A short, collision-resistant identity for a value (SHA-1 of its canonical form, base64url). */
export function digest(value) {
  const s = typeof value === 'string' ? value : canonical(value);
  return createHash('sha1').update(s).digest('base64url');
}

/** Turn whatever a hash/abstract hook returned into a Map key: short strings stay readable. */
export function keyOf(value) {
  if (typeof value === 'string') return value.length <= 64 ? value : digest(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const c = canonical(value);
  return c.length <= 64 ? c : digest(c);
}
