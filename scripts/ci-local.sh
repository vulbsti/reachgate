#!/usr/bin/env bash
# Run the CI jobs (.github/workflows/ci.yml) locally in clean Docker containers, for each Node version.
# Usage: scripts/ci-local.sh [20 22 ...]   (default: 20 22)
set -euo pipefail
cd "$(dirname "$0")/.."
versions=("$@")
[ $# -eq 0 ] && versions=(20 22)
# CI tests what is committed: export HEAD (under $HOME, since some Docker setups can't mount /tmp).
mkdir -p "$HOME/.cache"
src=$(mktemp -d "$HOME/.cache/reachgate-ci.XXXXXX")
git archive HEAD | tar -x -C "$src"
for v in "${versions[@]}"; do
  echo "=== node $v ==="
  docker run --rm -v "$src:/src:ro" "node:$v-bookworm-slim" bash -euc '
    apt-get update -qq >/dev/null && apt-get install -y -qq python3 python3-venv >/dev/null
    python3 -m venv /tmp/py >/dev/null && /tmp/py/bin/pip install -q ruff >/dev/null && export PATH=/tmp/py/bin:$PATH
    cp -r /src /w && cd /w
    npm ci --no-audit --no-fund --loglevel=error
    echo "--- lint";  npm run -s lint
    echo "--- test";  npm test 2>&1 | grep -E "^# (tests|pass|fail)"
    echo "--- gate"
    node bin/reachgate.mjs explore examples/dungeon/target.mjs#fixed --quiet --out /tmp/o1 >/dev/null && echo "fixed: exit 0"
    code=0; node bin/reachgate.mjs explore examples/dungeon/target.mjs --quiet --out /tmp/o2 >/dev/null || code=$?
    echo "buggy: exit $code"; test "$code" -eq 1
  '
done
