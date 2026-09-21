#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions, where the container
# starts with a fresh checkout and no installed dependencies.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Resolve the repo root: prefer CLAUDE_PROJECT_DIR, otherwise derive it from
# this script's own location (.claude/hooks/session-start.sh -> repo root) so
# we never silently install into an unexpected working directory.
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_ROOT"

# SessionStart hook stdout is injected into the conversation context, so route
# all status and install logging to stderr (still captured in hook logs) to
# keep the model's context clean.

# pnpm through Corepack, never npm: the repository pins pnpm 11.9.0 and commits
# `pnpm-lock.yaml`, and AGENTS.md says so in as many words. `npm install` here
# resolved a different tree from the committed lockfile and left a stray
# `package-lock.json` behind.
echo "[session-start] Enabling Corepack and pnpm..." >&2
corepack enable >&2
corepack prepare pnpm@11.9.0 --activate >&2

echo "[session-start] Installing root dependencies..." >&2
pnpm install --frozen-lockfile >&2

# `services/authority-store` is NOT a member of the root workspace — the root
# `pnpm-workspace.yaml` declares no `packages`, so a root install leaves that
# directory empty. Its devDependencies (`@electric-sql/pglite`, `pg`) are what
# the authority, record-store, broker and every contract suite import, so
# without this `pnpm test` dies at load with
# `Cannot find package '@electric-sql/pglite'` before a single assertion runs
# — 56 tests reported as failures that are really an uninstalled workspace.
# `--ignore-workspace` is required: without it pnpm resolves the root workspace
# and installs nothing here.
echo "[session-start] Installing isolated authority-store dependencies..." >&2
pnpm --dir services/authority-store install --frozen-lockfile --ignore-workspace >&2

echo "[session-start] Dependencies installed." >&2
