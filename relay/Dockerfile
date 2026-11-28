FROM node:24-bookworm-slim
WORKDIR /opt/baton-relay
COPY --chmod=0644 server.mjs wire.mjs ./
USER node
EXPOSE 8443
ENTRYPOINT ["node", "server.mjs"]
CMD ["/etc/baton-relay/relay.json"]
