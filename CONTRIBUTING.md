# Contributing to PennSync

PennSync is a frontend-only Vite + React SPA. Base44 authentication, data entities, and the Deno functions under `base44/functions/` run on the hosted Base44 platform, not from this repository.

## Local setup

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env`.
3. Set `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` for a real hosted Base44 app if you need authenticated routes.
4. Start Vite with `pnpm run dev`.

Without valid Base44 credentials, authenticated app routes may redirect to `/login` or show a blocking configuration state. Public capability-token routes such as `/signer` and `/join` can still be used for basic SPA rendering checks.

## Validation before opening a pull request

Run the same core checks that GitHub CI runs:

```bash
pnpm run lint:actions
pnpm run lint
pnpm test
pnpm run check:shared-helpers
pnpm run check:backend-transpile
pnpm run build
```

`pnpm run typecheck` and `pnpm run audit:prod` are useful informational baselines, but they are configured as non-blocking in CI.

### Base44 proxy note

The Base44 Vite plugin can print `Proxy not enabled (VITE_BASE44_APP_BASE_URL not set)` when the optional local dev proxy target is omitted. This is informational for local frontend-only builds. GitHub CI sets a harmless loopback value during `pnpm run build` so workflow logs stay focused on actionable failures.

## Pull request expectations

- Use the pull request template and include a concise summary plus exact tests/checks run.
- Add screenshots for visible UI changes when feasible.
- Keep backend helper snippets in sync by running `pnpm run check:shared-helpers` after shared helper edits.
- Do not add real secrets to `.env`, source files, screenshots, or pull request text.

## Stacked PRs and merging

This repository may use **GitHub Stacked PRs** (native stack metadata on the PR).

### Do not use the legacy merge API on stacked PRs

The classic REST merge endpoint (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`) and plain `gh pr merge` return:

```text
403 Merging stacked PRs via this API is not supported. Use the web interface instead.
```

Automation agents and scripts **must not** treat that as a transient failure or retry loop. It is permanent for stacked PRs on that API.

### How to merge correctly

| Method | Works for stacked PRs? |
|--------|-------------------------|
| GitHub UI → **Merge pull request** | Yes (preferred for humans) |
| `gh stack merge` / `gh stack merge <n>` | Yes |
| Async stack merge API (poll result) | Yes |
| Classic REST merge / `gh pr merge` | **No** |

CLI examples:

```bash
# Install once
gh extension install github/gh-stack

# Merge everything up through a given PR (squash if repo allows)
gh stack merge 107 --yes --squash

# After merge, refresh local stack state
gh stack sync
```

### Merge rules (short)

- Merging a stacked PR lands **that PR and every unmerged PR below it** (bottom-up).
- You cannot merge a mid-stack PR while leaving a lower unmerged PR behind.
- Required checks and reviews must pass for the PR **and** all PRs below it.
- `mergeable_state: unstable` usually means checks are still pending or not all green — wait, then merge via UI / `gh stack merge`.

### Agent / automation guidance

1. Push and open/update the PR as usual.
2. Wait for required CI (or report pending status to the human).
3. **Do not** call the legacy merge API when the response indicates stacked PRs.
4. Instruct the human to merge in the GitHub UI, or run `gh stack merge` where that CLI is available.
