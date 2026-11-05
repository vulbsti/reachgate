# Example: a login and session service

[`auth-service.mjs`](auth-service.mjs) is an ordinary service class: password login, a TOTP second
factor, lockout after 3 failures, "remember this device", password reset links (request, use,
expire), sessions (create, logout, expire) and an admin unlock. The TOTP check and token generation
are injected. It has no reachgate code in it.

[`target.mjs`](target.mjs) is the environment. One user (`alice`), two devices (`laptop`, `phone`),
two passwords (the right one, `hunter2`, and a wrong one, `correct-horse`, which a reset can also set),
a good and a bad TOTP code, and at most two reset emails. Everything the outside world can do is an
action: the user (or an attacker) typing a password or code, the session store's TTL running out
(`sessionExpires`), a reset link expiring (`tokenExpires`), an old link being opened again, the admin
unlocking the account.

| Invariant | Kind | Meaning |
| --- | --- | --- |
| `failures-bounded` | state | the failure counter stays within 0..3 |
| `session-requires-2fa` | state | every session passed TOTP, on this device or when it was remembered |
| `locked-has-no-new-session` | transition | no session starts while the account is locked |
| `reset-token-single-use` | transition | a used, expired or revoked reset link changes nothing |

Labels: `state:failures-0..2` / `state:locked`, `session:active`, `session:remembered-device`,
`session:both-devices`, `2fa:pending`, `device:remembered`, `reset:requested|used|expired|revoked`,
`password:changed`.

No `isTerminal`: a login service has no end state, and there is always something to do (log in), so
deadlock detection would add nothing.

## The seeded bug

Release 2.3 added a shortcut for remembered devices: a right password on a remembered device skips the
second factor. It was put at the top of `login()`, before the lockout check
([`auth-service.mjs` line 38](auth-service.mjs#L38)):

```js
if (this.legacyRememberedDeviceFlow && this.#remembered(user, device) && password === user.password) {
  return this.#startSession(username, device, 'remembered-device');
}
if (user.locked) return { status: 'locked' };
```

So a locked account still signs in from any device it was ever remembered on. The fixed flow checks the
lock first and takes the shortcut after the password check ([line 43](auth-service.mjs#L43)).

## Run it

```console
$ node bin/reachgate.mjs explore examples/auth-session/target.mjs
FAIL: 1 invariant violated · 2688 states, 23247 steps, 36 labels · state space exhausted · 378 ms
  ✗ locked-has-no-new-session: the account is locked, yet login on laptop created a session
    witness (7 steps, shortest): login laptop hunter2 → verify laptop good-code +remember → logout laptop → login laptop correct-horse → login laptop correct-horse → login laptop correct-horse → login laptop hunter2
    replay: reachgate replay examples/auth-session/target.mjs .reachgate/witnesses/locked-has-no-new-session.json
warning: 231 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
```

The replay (`node bin/reachgate.mjs replay examples/auth-session/target.mjs .reachgate/witnesses/locked-has-no-new-session.json`)
shows the labels change step by step: `device:remembered` after step 2, `state:failures-1`, `-2`, then
`state:locked` after steps 4 to 6, and `session:remembered-device` at step 7, where the transition
invariant fails.

### Why 7 steps is the minimum

BFS finds a shortest witness by construction. By hand, the bypass needs:

1. a remembered device: `login` + `verify +remember` (2 steps; a device can only be remembered after
   a successful second factor),
2. a locked account: 3 failed attempts (3 steps; a wrong password costs one step, a wrong TOTP code
   costs two, `login` then `verify`). The device has to be remembered first: a successful sign-in
   resets the failure counter, and a locked account can't complete the second factor,
3. the remembered device without a session, since the target only offers `login` on a device that
   has none: `logout` or `sessionExpires` (1 step),
4. the right password on that device (1 step).

2 + 3 + 1 + 1 = 7. The failures could come from the phone instead and the logout could come earlier;
those are other 7-step witnesses, and BFS reports the first one in its order.

## The fixed version

```console
$ node bin/reachgate.mjs explore examples/auth-session/target.mjs#fixed
PASS: 0 invariants violated · 2457 states, 23247 steps, 36 labels · state space exhausted · 522 ms
report: .reachgate/report.md
```

All 2457 reachable states and every transition between them were checked. That includes the reset
paths: re-opening a used, expired or revoked link (`reset-token-single-use`), and a reset unlocking the
account and revoking sessions and remembered devices. The buggy run has 231 more states. Every one is
locked with a remembered-device session that started after the lock, and none is reachable with the fix.

## Tests

[`test/example-auth-session.test.mjs`](../../test/example-auth-session.test.mjs) checks the 7-step
witness (exact steps) and its replay, and that the fixed service exhausts 2457 states with no
violation while locking, remembered-device sessions and every reset-link outcome stay reachable.
