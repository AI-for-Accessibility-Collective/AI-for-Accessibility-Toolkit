# The agent host: starts each account's sandbox through the VM's docker, and
# serves the sandbox port and the API port. Runs with --network host and the
# docker socket (see vm/setup.sh). Build context: the repository root.
#   docker build -f agent-host/Dockerfile -t agent-host .
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY toolkit/protocol/ ./toolkit/protocol/
COPY agent-host/ ./agent-host/
WORKDIR /app/agent-host
ENV NODE_ENV=production AGENT_RUNNER=docker AGENT_DATA_DIR=/srv/agent-host
CMD ["node", "index.js"]
