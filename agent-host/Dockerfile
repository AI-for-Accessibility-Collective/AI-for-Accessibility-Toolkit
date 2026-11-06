# The agent host: starts each account's sandbox through the VM's docker, and
# serves the sandbox port and the API port. Runs with --network host and the
# docker socket (see vm/setup.sh). Build context: the repository root.
#   docker build -f agent-host/Dockerfile -t agent-host .
FROM node:24-slim

# Docker's own CLI (signed apt repository): Debian's is too old for the VM's daemon.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY toolkit/protocol/ ./toolkit/protocol/
COPY agent-host/ ./agent-host/
# Where the GenA11y rubric text comes from, and the parts a review is split into, for the server's reviewers (src/checks.js).
COPY scripts/verify-adapters/intera11y-upstream.mjs scripts/verify-adapters/review-focus.mjs scripts/verify-adapters/check-report.mjs ./scripts/verify-adapters/
WORKDIR /app/agent-host
ENV NODE_ENV=production AGENT_RUNNER=docker AGENT_DATA_DIR=/srv/agent-host
CMD ["node", "index.js"]
