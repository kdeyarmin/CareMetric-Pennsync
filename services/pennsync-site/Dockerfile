# Build context is the REPOSITORY ROOT, as `services/pennsync-api/Dockerfile`
# already is: the frontend build needs the whole workspace and the lockfile.
#
# The three build arguments with no default are refused when empty rather than
# defaulted. Each one changes what the published bundle talks to or what its
# assets are named, so a build that guessed at one would publish a site nobody
# could verify against a local build.
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app

ARG VITE_BASE44_APP_ID
ARG VITE_BASE44_BACKEND_URL
# `vite.config.js` falls back to a git revision and then to a TIMESTAMP when
# this is absent. A timestamp puts the clock in every asset filename, so the
# same commit built twice emits different names and
# `tools-live-frontend-sync.mjs` can no longer compare the published site with a
# local build. Requiring it is what keeps the publication verifiable.
ARG PENNSYNC_ASSET_REVISION
ARG VITE_DEPLOY_ENV=production
ARG VITE_CENTRAL_HELP_ENABLED=true
ARG VITE_SUPER_ADMIN_EMAIL=
# Matches the empty value `publish-production-frontend.yml` builds with: a
# floating function-revision alias is rejected by the frontend, and an exact pin
# belongs to a release decision rather than to an image default.
ARG VITE_BASE44_FUNCTIONS_VERSION=
RUN for required in VITE_BASE44_APP_ID VITE_BASE44_BACKEND_URL PENNSYNC_ASSET_REVISION; do \
      eval "value=\${$required}"; \
      if [ -z "$value" ]; then \
        echo "PENNSYNC_SITE_BUILD_ARGUMENT_MISSING: $required" >&2; exit 2; \
      fi; \
    done

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@11.9.0 --activate \
  && pnpm install --frozen-lockfile --ignore-scripts
COPY --chown=node:node . ./
RUN pnpm run build

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
WORKDIR /site
# The runtime stage carries no workspace, no lockfile and no node_modules: the
# server has no dependency beyond Node itself, so there is nothing here to
# audit, update or exploit beyond the built site and one file.
COPY --chown=node:node services/pennsync-site/server.mjs services/pennsync-site/site.test.mjs ./
COPY --from=build --chown=node:node /app/dist ./dist
USER node
# Same posture as the other two services: a red suite fails the build, so a
# broken server never reaches a deployment. The fixtures are built in a temp
# directory and never read ./dist.
RUN node --test *.test.mjs
# Proves the real build this image carries also satisfies the boot walk — an
# unknown file type, a sourcemap or a stray dotfile in `dist` fails here rather
# than at the first request.
RUN node -e "import('./server.mjs').then(m=>{const i=m.createSiteInventory('dist');process.stdout.write('site inventory ok: '+i.files.size+' files\n')})"
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
