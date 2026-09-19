FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
WORKDIR /service
# Dependencies install before the source is copied, so a source-only change does
# not re-resolve them, and from the lockfile only: a build never picks a version
# the repository has not committed.
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@11.9.0 --activate \
  && pnpm install --frozen-lockfile --ignore-workspace --ignore-scripts \
  && chown -R node:node /service
COPY --chown=node:node . ./
USER node
RUN node --test *.test.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
