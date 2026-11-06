# Local CI replica

The same jobs as `.github/workflows/ci.yml` (lint, test, gate), run by `scripts/ci-local.sh` in clean `node:20` / `node:22` Docker containers on the committed tree. They complement the GitHub Actions runs cited in VERIFICATION.md (which also cover macOS).

Commit: "Third audit fixes: fresh-repo plan for the history scrub, private tool…", run 2026-11-06T01:26Z.

```
=== node 20 ===
--- lint
check-python: py_compile ok (4 files)
All checks passed!
check-python: ruff check ok
--- test
# tests 23
# pass 23
# fail 0
--- gate
fixed: exit 0
buggy: exit 1
=== node 22 ===
--- lint
check-python: py_compile ok (4 files)
All checks passed!
check-python: ruff check ok
--- test
# tests 23
# pass 23
# fail 0
--- gate
fixed: exit 0
buggy: exit 1
```
