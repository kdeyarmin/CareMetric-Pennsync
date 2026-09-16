FROM node:24.18.0-bookworm-slim
WORKDIR /runtime
COPY --chown=node:node services/integration-runtime/ ./
USER node
RUN node --test runtime.test.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
