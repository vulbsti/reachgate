# Blocked: needs the owner

## B2. Scrub private project names from git history before going public (force-push refused)

- **What:** older commits on the private remote mention the owner's private projects. The source game's
  short name and an earlier QA tool's name appear in docs and comments. The source game's character
  names appear in one `VERIFICATION.md` evidence command. The owner's own name and work domain appear
  in a `VERIFICATION.md` row quoting the account rules. **The current tree is clean:** only history is
  affected. The repo is private, so nothing has leaked.
- **Done:** a local branch `scrubbed-main` holds the same history rewritten with those terms removed. It
  was made with `git filter-branch` and a tree filter. Its final tree is identical to `main`, and
  `git grep -nIiwf <term list> $(git rev-list scrubbed-main)` finds nothing.
- **Refused:** `git push --force-with-lease origin main` was denied by this session's permission
  classifier ("Git Destructive"). It was not worked around. `main` was restored to the pushed history,
  so normal pushes continue.
- **To unblock (owner, before making the repo public):** from the repo root, rebuild the scrubbed
  branch from the latest `main`, then force-push. The scrub script (`reachgate-scrub.py`) and the term list
  (`reachgate-private-terms.txt`) are kept outside the repo, in the agent-session notes folder named in the
  session report; set `NOTES` to that folder:

  ```bash
  NOTES=/path/to/session-notes   # the folder named in the session report
  git checkout main && git branch -f scrubbed-main main
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --tree-filter "python3 $NOTES/reachgate-scrub.py" -- scrubbed-main
  git grep -nIiwf $NOTES/reachgate-private-terms.txt $(git rev-list scrubbed-main) | wc -l   # expect 0 (whole words)
  git grep -nIiF -f $NOTES/reachgate-private-paths.txt $(git rev-list scrubbed-main) | wc -l   # expect 0 (paths)
  git diff main scrubbed-main --stat | wc -l                                                  # expect 0
  git checkout -B main scrubbed-main
  GH_TOKEN=$(gh auth token -u vulbsti) git push --force-with-lease origin main
  git tag -f v0.1.0 main && GH_TOKEN=$(gh auth token -u vulbsti) git push --force origin v0.1.0
  ```

  Also close the Dependabot PRs (#1-#3). They were cut from the old history and fail CI on Node 22,
  because that history predates the `npm test` fix. Dependabot reopens them from the new `main`.

## Resolved

### B1. Creating and pushing the private GitHub repo (resolved 2026-11-05)
- The session's permission classifier refused `gh repo create vulbsti/reachgate --private --source . --push`
  ("Public Data-Sharing Upload"), even though the repo is private. The agent did not work around it.
- The owner approved it explicitly, and the private repo was created from the parent session:
  https://github.com/vulbsti/reachgate (private, `origin` over HTTPS). Later pushes use
  `GH_TOKEN=$(gh auth token -u vulbsti) git push`.

## Open for the owner (not blocking)

- **Dependabot PRs** #1-#3 (action version bumps) opened as soon as the repo existed. They were cut from
  an older commit and fail CI on Node 22 for that reason. Close them; Dependabot reopens them from the
  current `main` (see B2).
- **Going public / publishing**: see [RELEASE.md](RELEASE.md). Nothing has been made public or published.
