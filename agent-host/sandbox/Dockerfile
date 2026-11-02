# One account's sandbox: opencode 2.0.30 and a read-only copy of the toolkit
# (its code, docs and the ai4a11y-toolkit skill). The host starts it with
# gVisor, no capabilities, a read-only root, and a network that reaches only
# the host's sandbox port. Build context: the repository root.
#   docker build -f agent-host/sandbox/Dockerfile -t agent-sandbox .
FROM node:24-slim

ARG OPENCODE_VERSION=2.0.30
ARG OPENCODE_SHA256=b184222cb56e747dc1503ab6e1788f48975d6cdd7511de56464b5757d1fff586

# ripgrep: opencode's search tool would otherwise download it, and the sandbox has no internet.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-x64-baseline.tar.gz" -o /tmp/opencode.tgz \
 && echo "${OPENCODE_SHA256}  /tmp/opencode.tgz" | sha256sum -c - \
 && mkdir /tmp/opencode && tar -xzf /tmp/opencode.tgz -C /tmp/opencode \
 && install -m 0755 "$(find /tmp/opencode -type f -name opencode | head -1)" /usr/local/bin/opencode \
 && rm -rf /tmp/opencode /tmp/opencode.tgz \
 && opencode --version
# opencode waits forever without its model catalog, and cannot download it here.
RUN mkdir -p /opt/agent && curl -fsSL https://models.dev/api.json -o /opt/agent/models.json

COPY agent-host/sandbox/AGENTS.md agent-host/sandbox/start.sh /opt/agent/
COPY README.md CLAUDE.md /toolkit/
COPY .claude/skills/ /toolkit/.claude/skills/
COPY toolkit/ /toolkit/toolkit/
COPY tools/ /toolkit/tools/
COPY docs/ /toolkit/docs/
COPY extension/ /toolkit/extension/
COPY examples/ /toolkit/examples/
COPY controller/ /toolkit/controller/
RUN chmod -R a+rX /toolkit /opt/agent && chmod 0755 /opt/agent/start.sh

USER 1000:1000
WORKDIR /work
ENV HOME=/home/agent OPENCODE_CONFIG=/etc/agent/opencode.json
CMD ["/opt/agent/start.sh"]
