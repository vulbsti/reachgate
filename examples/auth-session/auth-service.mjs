// Login and session service: password, then a second factor (TOTP), with lockout, remembered devices,
// password reset links and an admin unlock.
//
// All persistent data lives in one plain object (what you would keep in a database) that the service
// reads and updates. Token generation and the TOTP check are injected, the way you would inject them
// to test it.
//
// Option `legacyRememberedDeviceFlow: true` reproduces release 2.3, where the remembered-device
// shortcut in login() ran before the lockout check. It shipped that way for a month.

export const MAX_FAILURES = 3;

export function emptyDatabase(users) {
  return {
    users: Object.fromEntries(Object.entries(users).map(([name, password]) => [name, { password, failures: 0, locked: false, trustedDevices: [] }])),
    challenges: {}, // device -> { user }: password accepted, waiting for the second factor
    sessions: {}, // device -> { user, via: 'totp' | 'remembered-device' }
    resetTokens: {}, // token -> { user, status: 'issued' | 'used' | 'expired' | 'revoked' }
  };
}

export class AuthService {
  /**
   * @param {object} db  the data, see emptyDatabase(); mutated in place
   * @param {{ verifyTotp: (user: string, code: string) => boolean, newToken: () => string, legacyRememberedDeviceFlow?: boolean }} deps
   */
  constructor(db, { verifyTotp, newToken, legacyRememberedDeviceFlow = false }) {
    this.db = db;
    this.verifyTotp = verifyTotp;
    this.newToken = newToken;
    this.legacyRememberedDeviceFlow = legacyRememberedDeviceFlow;
  }

  /** Step 1: the password. Returns { status: 'challenge' | 'signed-in' | 'invalid' | 'locked' }. */
  login(username, password, device) {
    const user = this.db.users[username];
    if (!user) return { status: 'invalid' };
    if (this.legacyRememberedDeviceFlow && this.#remembered(user, device) && password === user.password) {
      return this.#startSession(username, device, 'remembered-device');
    }
    if (user.locked) return { status: 'locked' };
    if (password !== user.password) return this.#fail(user);
    if (this.#remembered(user, device)) return this.#startSession(username, device, 'remembered-device');
    this.db.challenges[device] = { user: username };
    return { status: 'challenge' };
  }

  /** Step 2: the TOTP code for a pending challenge on this device. */
  verifySecondFactor(device, code, { rememberDevice = false } = {}) {
    const challenge = this.db.challenges[device];
    if (!challenge) return { status: 'no-challenge' };
    const user = this.db.users[challenge.user];
    if (user.locked) {
      delete this.db.challenges[device];
      return { status: 'locked' };
    }
    if (!this.verifyTotp(challenge.user, code)) return this.#fail(user);
    delete this.db.challenges[device];
    if (rememberDevice && !user.trustedDevices.includes(device)) user.trustedDevices = [...user.trustedDevices, device].sort();
    return this.#startSession(challenge.user, device, 'totp');
  }

  logout(device) {
    delete this.db.sessions[device];
  }

  /** The session store's TTL ran out. */
  expireSession(device) {
    delete this.db.sessions[device];
  }

  requestPasswordReset(username) {
    if (!this.db.users[username]) return { status: 'ok' }; // don't reveal which accounts exist
    const token = this.newToken();
    this.db.resetTokens[token] = { user: username, status: 'issued' };
    return { status: 'ok', token };
  }

  /** The reset link was opened and a new password chosen. */
  resetPassword(token, newPassword) {
    const record = this.db.resetTokens[token];
    if (!record || record.status !== 'issued') return { status: 'invalid-token' };
    const user = this.db.users[record.user];
    user.password = newPassword;
    user.failures = 0;
    user.locked = false;
    user.trustedDevices = [];
    record.status = 'used';
    // A new password ends every session and invalidates every other link for this account.
    for (const t of Object.values(this.db.resetTokens)) if (t.user === record.user && t.status === 'issued') t.status = 'revoked';
    this.#endAllSessions(record.user);
    return { status: 'ok' };
  }

  expireResetToken(token) {
    const record = this.db.resetTokens[token];
    if (record?.status === 'issued') record.status = 'expired';
  }

  adminUnlock(username) {
    const user = this.db.users[username];
    if (!user) return;
    user.locked = false;
    user.failures = 0;
  }

  #remembered(user, device) {
    return user.trustedDevices.includes(device);
  }

  #fail(user) {
    user.failures = Math.min(user.failures + 1, MAX_FAILURES);
    if (user.failures >= MAX_FAILURES) {
      user.locked = true;
      return { status: 'locked' };
    }
    return { status: 'invalid' };
  }

  #startSession(username, device, via) {
    this.db.users[username].failures = 0;
    this.db.sessions[device] = { user: username, via };
    return { status: 'signed-in' };
  }

  #endAllSessions(username) {
    for (const [device, s] of Object.entries(this.db.sessions)) if (s.user === username) delete this.db.sessions[device];
    for (const [device, c] of Object.entries(this.db.challenges)) if (c.user === username) delete this.db.challenges[device];
  }
}
