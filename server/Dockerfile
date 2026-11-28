FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssh-client openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/baton
COPY --chmod=0644 package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chmod=0755 server/ ./server/
COPY --chmod=0755 client/ ./client/
COPY --chmod=0755 web/ ./web/
COPY --chmod=0755 cli/ ./cli/
COPY --chmod=0755 relay/wire.mjs ./relay/wire.mjs
ENV HOME=/home/node
USER node
EXPOSE 9443
ENTRYPOINT ["node", "server/workspace-admin.mjs"]
CMD ["serve", "/home/node/.baton"]
