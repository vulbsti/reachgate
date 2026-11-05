# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-05

### Added

- CLI commands `explore`, `baseline`, `check`, `replay`, `inspect` and `init`.
- Exploration strategies: breadth-first search (default) and Go-Explore, with step,
  state, wall-clock time and depth budgets.
- Replayable witness traces for every invariant violation: shortest for BFS,
  1-minimal (delta-debugging shrunk) for Go-Explore, each verified by replaying it twice.
- JSON and Markdown reports in `.reachgate/`, and CI exit codes: 0 pass, 1 fail,
  2 usage or config error, 3 could not measure.
- Baseline gate: `baseline` records the reachable-behaviour signature and `check` diffs
  against it, replaying the old witness before declaring a label lost.
- JSON-over-stdio adapter protocol v1 and a zero-dependency Python helper
  (`adapters/python/reachgate_adapter.py`).
- Examples: dungeon game, todo reducer, auth session, Python checkout.
- Agent skill for coding agents.

[Unreleased]: https://github.com/vulbsti/reachgate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vulbsti/reachgate/releases/tag/v0.1.0
