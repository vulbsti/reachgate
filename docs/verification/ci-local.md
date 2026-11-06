# Local CI replica

GitHub Actions can't run until the repo is pushed (BLOCKED.md B1), so `scripts/ci-local.sh` runs the same jobs (lint, test, gate) in clean `node:20` / `node:22` Docker containers on the committed tree. macOS isn't covered locally.

Run 2026-11-05T17:08Z.

```
=== node 20 ===
--- lint
check-python: py_compile ok (4 files)
All checks passed!
check-python: ruff check ok
--- test
# tests 21
# pass 21
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
# tests 21
# pass 21
# fail 0
--- gate
fixed: exit 0
buggy: exit 1
```
