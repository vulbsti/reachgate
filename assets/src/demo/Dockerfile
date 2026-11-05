# VHS (terminal recorder) plus Node 22, for recording the README demo of the real CLI.
# Build: docker build -t reachgate-vhs assets/src/demo
FROM node:22-bookworm-slim AS node
FROM ghcr.io/charmbracelet/vhs:v0.10.0
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN ln -s /usr/local/bin/node /usr/local/bin/nodejs \
 && printf '#!/bin/sh\nexec node /repo/bin/reachgate.mjs "$@"\n' > /usr/local/bin/reachgate && chmod +x /usr/local/bin/reachgate
