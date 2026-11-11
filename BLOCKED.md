# Blocked: needs the owner

## Resolved

### B2. Publish a scrubbed history in a fresh repo (resolved 2026-11-12)
- The full history was rewritten with the out-of-repo term and path lists, and the owner's broader private-terms list finds nothing in any commit. The old repository was deleted on 2026-11-12, and a fresh private `vulbsti/reachgate` was created from the scrubbed history. It has no `refs/pull/*` refs. `v0.1.0` was re-created on the rewritten release commit (same tree).
- Commit SHAs and CI run links from before this date belonged to the deleted pre-release repository. Evidence cites commits by subject.

### B1. Creating and pushing the private GitHub repo (resolved 2026-11-05)
- The session's permission classifier refused `gh repo create vulbsti/reachgate --private --source . --push`
  ("Public Data-Sharing Upload"), even though the repo is private. The agent did not work around it.
- The owner approved it explicitly, and the private repo was created from the parent session:
  https://github.com/vulbsti/reachgate (private, `origin` over HTTPS). Later pushes use
  `GH_TOKEN=$(gh auth token -u vulbsti) git push`.

## Open for the owner (not blocking)

- **Dependabot PRs** #1-#3 (action version bumps) were cut from an older commit and fail CI on Node 22
  for that reason. They were deleted with the old repo; Dependabot opened fresh ones on the new repo.
- **Going public / publishing**: see [RELEASE.md](RELEASE.md). Nothing has been made public or published.
