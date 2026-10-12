# Project conventions

## Workflow rules

- Run `git pull` on main before starting any task.
- Never commit to `main`.
- Use one branch per task.
- Run the build and tests before pushing.
- Open a pull request and let CI pass before merging.
- Do not deploy from a branch, and do not treat a merge to `main` as a deploy of every service. The models differ:
  - `pennsync-integrations` redeploys when `services/integration-runtime/**` changes on `main`, and that deploy does not wait for CI.
  - `pennsync-api` deploys only after a release-variable write, not when `main` moves.
  - Read that service's source before assuming a merge is live. See `services/integration-runtime/README.md` and `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md`.
