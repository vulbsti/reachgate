# Release: going public (for the owner)

The repository was created **private** and nothing has been published. These are the exact commands to
run when you decide to go public. Each step is independent: you can make the repo public without
publishing to npm, for example.

Run them from the repo root.

## 0. Final checks

```bash
git status                       # clean
npm ci && npm test && npm run lint
docker run --rm -v "$PWD:/r" zricethezav/gitleaks git /r     # expect "no leaks found"
git log --format='%an <%ae>' | sort -u                        # expect only the GitHub noreply address
```

## 0b. Required before going public: scrub history

Follow [BLOCKED.md](BLOCKED.md) B2 (rewrite history to drop private project names, then force-push).
Do not make the repo public until that is done.

## 1. Make the GitHub repository public

```bash
GH_TOKEN=$(gh auth token -u vulbsti) gh repo edit vulbsti/reachgate --visibility public --accept-visibility-change-consequences
GH_TOKEN=$(gh auth token -u vulbsti) gh repo edit vulbsti/reachgate \
  --description "Explore your real code's reachable states, get shortest replayable witnesses for invariant violations, and gate changes on a behavioural baseline. Built for coding agents." \
  --add-topic model-checking --add-topic invariants --add-topic go-explore --add-topic coding-agents --add-topic regression-testing --add-topic state-machine
GH_TOKEN=$(gh auth token -u vulbsti) gh api repos/vulbsti/reachgate/private-vulnerability-reporting -X PUT   # SECURITY.md points here
```

## 2. Publish a GitHub release for v0.1.0

The tag `v0.1.0` already exists on the remote.

```bash
GH_TOKEN=$(gh auth token -u vulbsti) gh release create v0.1.0 --title "reachgate 0.1.0" --notes-file <(sed -n '/## \[0.1.0\]/,/^## \[/p' CHANGELOG.md | sed '$d')
```

## 3. Publish to npm

The name `reachgate` was free on 2026-11-05. Check it again first: `npm view reachgate` should 404.

```bash
npm login                        # your npm account (needs 2FA)
npm pack --dry-run               # check the file list: bin, src, templates, adapters, skills, index.d.ts, docs not included
npm publish --access public
```

Then `npm install -g reachgate` and `npx reachgate` (the README's install line) work for everyone.

## 4. Claude Code plugin

Once the repo is public, anyone can install the skill with:

```
/plugin marketplace add vulbsti/reachgate
/plugin install reachgate@reachgate
```

No submission is needed for that. Submitting to Anthropic's plugin directory is optional. Run
`claude plugin validate . --profile directory` first.

## 5. PyPI

Not needed: the Python helper is a single file that `reachgate init --lang python` copies into a project.
The name `reachgate` was also free on PyPI on 2026-11-05, if you want to reserve it.

## Later releases

See CONTRIBUTING.md ("Release steps"): bump `package.json` and `.claude-plugin/plugin.json`, add a
CHANGELOG entry, tag `vX.Y.Z`, push the tag, then `npm publish`.
