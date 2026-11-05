# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |
| < 0.1   | no        |

Only the latest 0.1.x release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub's private vulnerability reporting:
go to the repository's **Security** tab and choose **Report a vulnerability**
(<https://github.com/vulbsti/reachgate/security/advisories/new>).

Please include the reachgate version, Node.js version, OS, a minimal reproduction
(target file, config, command), and what an attacker could achieve. You should get
an acknowledgement within 7 days. We will agree a disclosure date with you once a
fix is ready, and credit you in the advisory unless you prefer otherwise.

## Threat model

reachgate is a developer tool that **runs code**. Keep these properties in mind:

- **It executes the target you point it at, with your permissions.** An in-process
  JavaScript target is `import()`ed into the reachgate process. A Python or `--cmd`
  target is started as a child process. Either way the target can do anything your
  user account can do (read files, use the network, spawn processes).
- **`reachgate.config.json` is code-equivalent.** It names the target and can name
  an adapter command that reachgate will run. Never run reachgate in a checkout whose
  config, target, or adapter you have not reviewed, for example an untrusted pull
  request, without a sandbox (a throwaway container or VM with no secrets).
- **The adapter protocol trusts the adapter process.** reachgate stops with exit
  code 3 when an adapter writes a line that is not JSON, speaks the wrong protocol
  version, returns an error, times out or exits, so a broken adapter fails cleanly.
  It does not treat the adapter as an adversary. A malicious adapter can lie
  about states, invariants and labels, and so make a gate pass or fail.
- **Baselines and witness files are inputs too.** A tampered
  `reachgate.baseline.json` or witness file can change what the gate accepts.
  Review changes to them like code.

In scope: bugs where reachgate itself does something the user did not ask for, for
example writing outside the `--out` directory, running a command other than the
configured one, or a crafted report, baseline or witness file causing code execution
when it is read.

Out of scope: anything a target, adapter, or config you chose to run does with your
permissions.
