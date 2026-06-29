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

# Install JS dependencies so linters, type-checks, tests, and builds work.
# Use `npm install` (not `npm ci`) so a partially-cached node_modules is
# reused on warm containers; it is idempotent and safe to re-run.
#
# SessionStart hook stdout is injected into the conversation context, so route
# all status and install logging to stderr (still captured in hook logs) to
# keep the model's context clean.
echo "[session-start] Installing npm dependencies..." >&2
npm install --no-audit --no-fund >&2

echo "[session-start] Dependencies installed." >&2
