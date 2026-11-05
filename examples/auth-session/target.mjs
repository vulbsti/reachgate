// reachgate target for the auth service. auth-service.mjs knows nothing about reachgate; this file says
// what the user, the attacker, the clock and the admin can do, and what must always be true.
//
//   default  release 2.3 (remembered-device shortcut before the lockout check)
//            node bin/reachgate.mjs explore examples/auth-session/target.mjs
//   fixed    node bin/reachgate.mjs explore examples/auth-session/target.mjs#fixed
import { AuthService, emptyDatabase, MAX_FAILURES } from './auth-service.mjs';

const USER = 'alice';
const DEVICES = ['laptop', 'phone'];
const PASSWORDS = ['hunter2', 'correct-horse']; // alice starts with the first; a reset picks either
const TOTP_OK = '246810';
const TOTP_BAD = '000000';
const MAX_RESET_REQUESTS = 2; // bounds the state space: at most two reset emails in one run

function service(db, options) {
  return new AuthService(db, {
    ...options,
    verifyTotp: (user, code) => code === TOTP_OK,
    newToken: () => `rt-${Object.keys(db.resetTokens).length + 1}`,
  });
}

function affordances(db) {
  const out = [];
  for (const device of DEVICES) {
    if (db.sessions[device]) {
      out.push({ type: 'logout', device }, { type: 'sessionExpires', device });
      continue;
    }
    for (const password of PASSWORDS) out.push({ type: 'login', device, password });
    if (db.challenges[device]) {
      out.push({ type: 'verify', device, code: TOTP_OK, remember: true }, { type: 'verify', device, code: TOTP_OK, remember: false }, { type: 'verify', device, code: TOTP_BAD, remember: false });
    }
  }
  if (Object.keys(db.resetTokens).length < MAX_RESET_REQUESTS) out.push({ type: 'requestReset' });
  // Any link can be opened again, used or not: that is the point of checking single use.
  for (const [token, t] of Object.entries(db.resetTokens)) {
    for (const password of PASSWORDS) out.push({ type: 'resetPassword', token, password });
    if (t.status === 'issued') out.push({ type: 'tokenExpires', token });
  }
  if (db.users[USER].locked) out.push({ type: 'adminUnlock' });
  return out;
}

function step(db, a, options) {
  const auth = service(db, options);
  switch (a.type) {
    case 'login': auth.login(USER, a.password, a.device); break;
    case 'verify': auth.verifySecondFactor(a.device, a.code, { rememberDevice: a.remember }); break;
    case 'logout': auth.logout(a.device); break;
    case 'sessionExpires': auth.expireSession(a.device); break;
    case 'requestReset': auth.requestPasswordReset(USER); break;
    case 'resetPassword': auth.resetPassword(a.token, a.password); break;
    case 'tokenExpires': auth.expireResetToken(a.token); break;
    case 'adminUnlock': auth.adminUnlock(USER); break;
    default: throw new Error(`unknown action ${a.type}`);
  }
  return db;
}

const invariants = {
  'failures-bounded': (db) => (db.users[USER].failures >= 0 && db.users[USER].failures <= MAX_FAILURES) || `failures = ${db.users[USER].failures}`,
  'session-requires-2fa': (db) => {
    for (const [device, s] of Object.entries(db.sessions)) {
      const ok = s.via === 'totp' || (s.via === 'remembered-device' && db.users[s.user].trustedDevices.includes(device));
      if (!ok) return `session on ${device} (via ${s.via}) never passed a second factor`;
    }
    return true;
  },
};

const transitions = {
  'locked-has-no-new-session': (prev, a, next) => {
    if (!prev.users[USER].locked) return true;
    const fresh = Object.keys(next.sessions).filter((d) => !prev.sessions[d]);
    return fresh.length === 0 || `the account is locked, yet ${a.type} on ${fresh.join(', ')} created a session`;
  },
  'reset-token-single-use': (prev, a, next) => {
    if (a.type !== 'resetPassword' || prev.resetTokens[a.token]?.status === 'issued') return true;
    const same = JSON.stringify(prev.users[USER]) === JSON.stringify(next.users[USER]);
    return same || `reset link ${a.token} (${prev.resetTokens[a.token]?.status}) changed the account again`;
  },
};

const describe = {
  'failures-bounded': `the failure counter stays within 0..${MAX_FAILURES}`,
  'session-requires-2fa': 'every session passed TOTP, on this device or when it was remembered',
  'locked-has-no-new-session': 'no session starts while the account is locked',
  'reset-token-single-use': 'a used, expired or revoked reset link changes nothing',
};

function observe(db) {
  const u = db.users[USER];
  const tokens = Object.values(db.resetTokens);
  return [
    u.locked ? 'state:locked' : `state:failures-${u.failures}`,
    ...(Object.keys(db.sessions).length ? ['session:active'] : []),
    ...(Object.values(db.sessions).some((s) => s.via === 'remembered-device') ? ['session:remembered-device'] : []),
    ...(Object.keys(db.sessions).length === DEVICES.length ? ['session:both-devices'] : []),
    ...(Object.keys(db.challenges).length ? ['2fa:pending'] : []),
    ...(u.trustedDevices.length ? ['device:remembered'] : []),
    ...(tokens.some((t) => t.status === 'issued') ? ['reset:requested'] : []),
    ...(tokens.some((t) => t.status === 'used') ? ['reset:used'] : []),
    ...(tokens.some((t) => t.status === 'expired') ? ['reset:expired'] : []),
    ...(tokens.some((t) => t.status === 'revoked') ? ['reset:revoked'] : []),
    ...(u.password !== PASSWORDS[0] ? ['password:changed'] : []),
  ];
}

function label(a) {
  switch (a.type) {
    case 'login': return `login ${a.device} ${a.password === PASSWORDS[0] ? 'hunter2' : 'correct-horse'}`;
    case 'verify': return `verify ${a.device} ${a.code === TOTP_OK ? 'good-code' : 'bad-code'}${a.remember ? ' +remember' : ''}`;
    case 'resetPassword': return `resetPassword ${a.token} ${a.password}`;
    default: return [a.type, a.device ?? a.token].filter(Boolean).join(' ');
  }
}

function authTarget(name, options) {
  return {
    name,
    initial: () => emptyDatabase({ [USER]: PASSWORDS[0] }),
    affordances,
    step: (db, a) => step(db, a, options),
    invariants,
    transitions,
    describe,
    observe,
    label,
  };
}

export default authTarget('auth-session (release 2.3)', { legacyRememberedDeviceFlow: true });
export const fixed = authTarget('auth-session (fixed)', {});
