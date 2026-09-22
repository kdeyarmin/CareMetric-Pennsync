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

# The PATH the agent's own tool calls inherit, captured BEFORE nvm prepends
# anything to it. The link further down has to land in a directory those shells
# already search, and nvm's own bin directory is not one of them.
INHERITED_PATH="$PATH"

NVM_SH=""
for candidate in "${NVM_DIR:-}/nvm.sh" /opt/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do
  if [ -s "$candidate" ]; then NVM_SH="$candidate"; break; fi
done

if [ -n "$NVM_SH" ]; then
  echo "[session-start] Selecting Node $NODE_VERSION via nvm..." >&2
  # nvm.sh reads unset variables and returns non-zero in places, so `-u` and
  # `-e` come off around it -- but its EXIT STATUS is CAPTURED rather than
  # dropped. Letting it fall on the floor is how an unavailable download ends
  # with both installs running on the very engine this block exists to replace,
  # reported as though it had worked.
  nvm_status=0
  set +eu
  # shellcheck disable=SC1090
  . "$NVM_SH"
  nvm install "$NODE_VERSION" >&2 || nvm_status=$?
  if [ "$nvm_status" -eq 0 ]; then
    nvm use "$NODE_VERSION" >&2 || nvm_status=$?
  fi
  set -eu
  if [ "$nvm_status" -ne 0 ]; then
    echo "[session-start] nvm could not provide v$NODE_VERSION (status $nvm_status)." >&2
  fi
fi

# ONE place decides whether the engine is right, whatever happened above,
# because a zero status that left the wrong node on PATH is still the wrong
# node. Ask the runtime rather than trusting the installer.
if [ "$(node -v 2>/dev/null || true)" = "v$NODE_VERSION" ]; then
  NODE_BIN="$(dirname "$(command -v node)")"
  export PATH="$NODE_BIN:$PATH"

  # That export reaches this hook's own steps and nothing else: the agent's
  # tool calls are separate non-interactive shells that never source ~/.bashrc
  # and inherit a PATH fixed at container start. Linking into a directory that
  # PATH ALREADY SEARCHES is what makes `node` mean $NODE_VERSION for the rest
  # of the session -- so the directory is FOUND by walking the inherited PATH
  # rather than assumed, because a link somewhere nobody searches is worse than
  # no link at all: it reports success and changes nothing.
  saved_ifs="$IFS"
  IFS=:
  # shellcheck disable=SC2086  # deliberate split on PATH's own separator
  set -- $INHERITED_PATH
  IFS="$saved_ifs"
  # A user-owned directory is preferred when the inherited PATH actually
  # contains one, so the links do not shadow a system binary in /usr/bin. Any
  # writable entry will do if it does not, since a link nothing searches is the
  # case this loop exists to avoid.
  PREFERRED_LINK_DIR="$HOME/.local/bin"
  LINK_DIR=""
  FIRST_WRITABLE=""
  for dir in "$@"; do
    if [ -n "$dir" ] && [ "$dir" != "$NODE_BIN" ] && [ -d "$dir" ] && [ -w "$dir" ]; then
      if [ "$dir" = "$PREFERRED_LINK_DIR" ]; then
        LINK_DIR="$dir"
        break
      fi
      if [ -z "$FIRST_WRITABLE" ]; then FIRST_WRITABLE="$dir"; fi
    fi
  done
  if [ -z "$LINK_DIR" ]; then LINK_DIR="$FIRST_WRITABLE"; fi

  if [ "$(PATH="$INHERITED_PATH" node -v 2>/dev/null || true)" = "v$NODE_VERSION" ]; then
    # Ask the question that actually matters -- do the agent's own shells
    # already get the pinned engine? -- rather than comparing directories. A
    # previous run of this hook, or a container that ships the pin, lands here,
    # and linking again would only scatter symlinks through another directory.
    echo "[session-start] Inherited PATH already resolves v$NODE_VERSION." >&2
  elif [ -n "$LINK_DIR" ]; then
    # An `&&` list, not an `if`, would end the hook here under `set -e` the
    # moment one of these four is absent -- the same shape that broke the
    # hosted-store step twice.
    for binary in node npm npx corepack; do
      if [ -x "$NODE_BIN/$binary" ]; then
        ln -sfn "$NODE_BIN/$binary" "$LINK_DIR/$binary"
      fi
    done
    echo "[session-start] Linked node/npm/npx/corepack into $LINK_DIR." >&2
  else
    echo "[session-start] WARNING: no writable directory on the inherited PATH, so" >&2
    echo "[session-start]          later shells in this session still resolve" >&2
    echo "[session-start]          $(PATH="$INHERITED_PATH" command -v node 2>/dev/null || echo 'no node')." >&2
  fi
else
  # Not fatal: a container that cannot switch can still install and test, just
  # on the wrong engine. Say so loudly rather than failing the session.
  echo "[session-start] WARNING: running on $(node -v 2>/dev/null || echo 'unknown node')," >&2
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
