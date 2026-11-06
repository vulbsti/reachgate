# Blocked: needs the owner

## B2. Publish a scrubbed history in a fresh repo before going public (needs the owner)

- **What:** older commits on the private remote mention the owner's private projects. The source game's
  short name and character names, an earlier QA tool's name, a private tool's name, local paths and
  the owner's own name all appear in old docs, comments and `VERIFICATION.md` rows. **The current tree
  is clean.** The repo is private, so nothing has leaked.
- **Why a force-push isn't enough:** GitHub keeps old commits reachable after a force-push, through PR
  refs (`refs/pull/1..3/head` from the Dependabot PRs) and Actions run pages. The clean history has to
  go into a **fresh repository**.
- **Done:** the local branch `scrubbed-main` holds the full history rewritten with those terms and paths
  removed (`git filter-branch` with a tree filter). Its final tree is identical to `main`, and the
  out-of-repo term and path lists find nothing anywhere in its history. A force-push of the rewrite
  was also refused by this session's permission check ("Git Destructive") and not worked around.
- **To do (owner, before going public), from the repo root:** set `NOTES` to the agent-session notes
  folder named in the session report. It holds `reachgate-scrub.py` and the term and path lists, which
  are kept outside the repo on purpose.

  ```bash
  NOTES=/path/to/session-notes
  # 1. rebuild the scrubbed branch from the latest main, and check it
  git checkout main && git branch -f scrubbed-main main
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --tree-filter "python3 $NOTES/reachgate-scrub.py" -- scrubbed-main
  git grep -nIiwf $NOTES/reachgate-private-terms.txt $(git rev-list scrubbed-main) | wc -l   # expect 0
  git grep -nIiF -f $NOTES/reachgate-private-paths.txt $(git rev-list scrubbed-main) | wc -l   # expect 0
  git diff main scrubbed-main --stat | wc -l                                                  # expect 0
  # 2. keep the current repo as a private archive under another name
  GH_TOKEN=$(gh auth token -u vulbsti) gh repo rename reachgate-private-history -R vulbsti/reachgate --yes
  # 3. create a fresh private repo and push only the scrubbed history
  GH_TOKEN=$(gh auth token -u vulbsti) gh repo create vulbsti/reachgate --private
  git remote set-url origin https://github.com/vulbsti/reachgate.git
  git checkout -B main scrubbed-main
  git tag -f v0.1.0 main
  GH_TOKEN=$(gh auth token -u vulbsti) git push -u origin main && GH_TOKEN=$(gh auth token -u vulbsti) git push origin v0.1.0
  # 4. wait for CI to go green on the new repo, then follow RELEASE.md from step 1
  ```

  After step 3, the commit SHAs and CI run links cited in `VERIFICATION.md` point into the archived repo.
  Re-cite the new repo's first green CI run if you want the links to stay public.

## Resolved

### B1. Creating and pushing the private GitHub repo (resolved 2026-11-05)
- The session's permission classifier refused `gh repo create vulbsti/reachgate --private --source . --push`
  ("Public Data-Sharing Upload"), even though the repo is private. The agent did not work around it.
- The owner approved it explicitly, and the private repo was created from the parent session:
  https://github.com/vulbsti/reachgate (private, `origin` over HTTPS). Later pushes use
  `GH_TOKEN=$(gh auth token -u vulbsti) git push`.

## Open for the owner (not blocking)

- **Dependabot PRs** #1-#3 (action version bumps) were cut from an older commit and fail CI on Node 22
  for that reason. They stay behind in the archived repo after B2; Dependabot opens fresh ones on the
  new repo.
- **Going public / publishing**: see [RELEASE.md](RELEASE.md). Nothing has been made public or published.
