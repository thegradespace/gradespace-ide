# Syncing with T3 Code

Gradespace IDE takes T3 Code's work in once a week, on a branch, so `mine` only moves when John has tried the result. Upstream lands hundreds of commits a day; a week of drift merges in an hour, a month takes a day.

`origin` is `thegradespace/gradespace-ide`. `upstream` is `pingdotgg/t3code`, fetch only.

## Steps

1. `git fetch origin upstream`. If `upstream/main` is already in `origin/mine`, stop: there is nothing to sync.
2. Start `sync/upstream-<YYYY-MM-DD>` from `origin/mine`. If an earlier `sync/upstream-*` branch is not yet merged into `mine`, start from that branch instead, so its resolutions are not redone.
3. `git merge --no-commit --no-ff upstream/main`, then resolve.
4. `vp i`, then `vp run check:gs-wording`, `vp run typecheck`, `vp run lint` and `vp run fmt:check`. Run the tests beside the files you resolved by hand.
5. Commit, push the branch, and start **Gradespace CI** on it (`gh workflow run gradespace-ci.yml --ref <branch>`).
6. Report what came in, what you decided, and what was not verified. Merging into `mine` and building a release wait for John's go.

## Resolving conflicts

Where the two sides disagree, Gradespace's behaviour wins. [MY-CHANGES.md](../../MY-CHANGES.md) lists that behaviour and is the checklist for step 6.

- **Wording.** Text users read says "Gradespace IDE" or "GS", and the command is `gs`. `vp run check:gs-wording` fails on new T3 wording. Reword it, or run it with `--write` only when T3 means T3's own project or services.
- **Workflows.** T3's workflows live in `.github/t3-workflows`, where GitHub does not run them. Move any that upstream adds to `.github/workflows` there. Only `gradespace-ci.yml`, `release-gradespace.yml` and `windows-test-build.yml` run.
- **`pnpm-lock.yaml`.** Take upstream's, then `vp i`.
- **Upstream tests.** A new upstream test that asserts T3 names, or behaviour this fork changed on purpose, is changed to expect the fork's value. Remove a case only when the fork does not have the behaviour at all.
- **Both sides built it.** Keep the fork's version working and note the overlap in the report so one can be dropped later.

## Rolling back

Before merging a sync branch into `mine`, tag `mine` as `pre-sync-<YYYY-MM-DD>` and push the tag. Resetting `mine` to that tag undoes the sync.
