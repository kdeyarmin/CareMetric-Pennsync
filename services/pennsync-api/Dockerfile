FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
WORKDIR /service
COPY --chown=node:node . ./
USER node
RUN node --test *.test.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
