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

# NODE FIRST, because everything below runs under whatever `node` resolves to.
# This container ships Node 22 at /opt/node22/bin and puts it on PATH ahead of
# everything else, while `.nvmrc` and package.json engines pin ">=24.18.0 <25".
# Until this block existed, every remote session ran `corepack prepare` and both
# `pnpm install --frozen-lockfile` calls on Node 22 -- an unsupported engine
# resolving and building the dependency tree the rest of the session then tests
# against. pnpm prints one [WARN] line about it and carries on, which is exactly
# the kind of warning nobody reads.
#
# The version is READ FROM `.nvmrc` rather than written here, so this file
# cannot drift from the pin CI uses.
NODE_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/.nvmrc")"
if [ -z "$NODE_VERSION" ]; then
  echo "[session-start] .nvmrc is empty; refusing to guess a Node version." >&2
  exit 1
fi

# nvm.sh reads unset variables and returns non-zero in places, so `-u` and `-e`
# come off around it and go straight back on.
NVM_SH=""
for candidate in "${NVM_DIR:-}/nvm.sh" /opt/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do
  if [ -s "$candidate" ]; then NVM_SH="$candidate"; break; fi
done

if [ -n "$NVM_SH" ]; then
  echo "[session-start] Selecting Node $NODE_VERSION via nvm..." >&2
  set +eu
  # shellcheck disable=SC1090
  . "$NVM_SH"
  nvm install "$NODE_VERSION" >&2
  nvm use "$NODE_VERSION" >&2
  set -eu
  NODE_BIN="$(dirname "$(command -v node)")"
  export PATH="$NODE_BIN:$PATH"

  # The steps below run in THIS shell, but the agent's own tool calls are
  # separate non-interactive shells that never source ~/.bashrc and inherit a
  # PATH fixed at container start -- so a PATH export here reaches the installs
  # and nothing else. Linking into the first writable directory already on that
  # inherited PATH is what makes `node` mean $NODE_VERSION for the rest of the
  # session too. Skipped silently if that directory does not exist.
  LINK_DIR="$HOME/.local/bin"
  if [ -d "$LINK_DIR" ]; then
    # An `&&` list, not an `if`, would end the hook here under `set -e` the
    # moment one of these four is absent -- the same shape that broke the
    # hosted-store step twice.
    for binary in node npm npx corepack; do
      if [ -x "$NODE_BIN/$binary" ]; then
        ln -sfn "$NODE_BIN/$binary" "$LINK_DIR/$binary"
      fi
    done
    echo "[session-start] Linked node/npm/npx/corepack into $LINK_DIR." >&2
  fi
elif [ "$(node -v 2>/dev/null || true)" = "v$NODE_VERSION" ]; then
  # No nvm, but the container already ships the pinned version. Nothing is
  # wrong, so say nothing alarming: a warning that fires when the state is
  # correct is how people learn to skip warnings.
  echo "[session-start] nvm not found, and node is already v$NODE_VERSION." >&2
else
  # Not fatal: a container without nvm can still install and test, just on the
  # wrong engine. Say so loudly rather than failing the session.
  echo "[session-start] WARNING: nvm not found; staying on $(node -v 2>/dev/null || echo 'unknown node')," >&2
  echo "[session-start]          but this repository pins v$NODE_VERSION." >&2
fi
echo "[session-start] Node: $(node -v 2>/dev/null || echo unavailable)" >&2

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
