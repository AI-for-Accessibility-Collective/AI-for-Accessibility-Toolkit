# The verify agents' container, run on the agent host VM under gVisor
# (see run.mjs --sandboxed): Playwright's image (Node and Chromium, matching
# package-lock.json's playwright), opencode as in the agent sandbox, and
# Intopia's web accessibility skill (© Intopia, CC BY-NC-SA 4.0:
# https://github.com/Intopia/intopia-web-accessibility-skill), fetched here,
# not kept in this repository. The repository is mounted at /repo.
#
# Two images from this file (build context: the repository root):
#   docker build -f scripts/verify-adapters/Dockerfile -t verify-adapters .
#     the agent runs (run.mjs --agent), with a copy of the repository mounted at /repo
#   docker build -f scripts/verify-adapters/Dockerfile --target check -t verify-check .
#     the agent host's server checks (agent-host/src/checks.js): the code the
#     verifier needs and its packages baked in, so a check runs with no
#     network. Only the folders named below are copied: never .env, data or git.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS base

ARG OPENCODE_VERSION=2.0.30
ARG OPENCODE_SHA256=b184222cb56e747dc1503ab6e1788f48975d6cdd7511de56464b5757d1fff586
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-x64-baseline.tar.gz" -o /tmp/opencode.tgz \
 && echo "${OPENCODE_SHA256}  /tmp/opencode.tgz" | sha256sum -c - \
 && mkdir /tmp/opencode && tar -xzf /tmp/opencode.tgz -C /tmp/opencode \
 && install -m 0755 "$(find /tmp/opencode -type f -name opencode | head -1)" /usr/local/bin/opencode \
 && rm -rf /tmp/opencode /tmp/opencode.tgz \
 && opencode --version
RUN mkdir -p /opt/agent && curl -fsSL https://models.dev/api.json -o /opt/agent/models.json

ARG INTOPIA_SKILL_COMMIT=74b3944ee3e562c45dd88218afc5f7eb1c1fd060
RUN mkdir -p /opt/agent/skills/intopia-web-accessibility && cd /opt/agent/skills/intopia-web-accessibility \
 && git init -q && git remote add origin https://github.com/Intopia/intopia-web-accessibility-skill.git \
 && git fetch -q --depth 1 origin "${INTOPIA_SKILL_COMMIT}" && git checkout -q FETCH_HEAD && rm -rf .git \
 && test -f SKILL.md && test -f LICENSE && chmod -R a+rX /opt/agent

USER pwuser
ENV HOME=/home/pwuser
WORKDIR /repo

FROM base AS check
COPY --chown=pwuser:pwuser package.json package-lock.json /repo/
RUN npm ci --no-audit --no-fund --loglevel=error
COPY --chown=pwuser:pwuser scripts/verify-adapters/ /repo/scripts/verify-adapters/
COPY --chown=pwuser:pwuser toolkit/ /repo/toolkit/
COPY --chown=pwuser:pwuser tools/ /repo/tools/
COPY --chown=pwuser:pwuser extension/ /repo/extension/
COPY --chown=pwuser:pwuser cli/axe-core.min.js /repo/cli/
COPY --chown=pwuser:pwuser server/src/ /repo/server/src/
COPY --chown=pwuser:pwuser agent-host/src/ /repo/agent-host/src/
COPY --chown=pwuser:pwuser agent-host/sandbox/AGENTS.md /repo/agent-host/sandbox/
COPY --chown=pwuser:pwuser .claude/skills/ /repo/.claude/skills/
COPY --chown=pwuser:pwuser docs/verification.md /repo/docs/
# The adapter's copy (run.mjs) and the reviewer's specs are written here, in the container's own layer.
RUN mkdir -p /repo/tools/core-adapters/.check && node --check scripts/verify-adapters/run.mjs
CMD ["node", "scripts/verify-adapters/run.mjs"]

FROM base AS verify
CMD ["sh", "-c", "mkdir -p $HOME/.cache/opencode && cp -n /opt/agent/models.json $HOME/.cache/opencode/models.json && npm ci --no-audit --no-fund --loglevel=error && exec node scripts/verify-adapters/run.mjs --agent --sandboxed --skills /opt/agent/skills ${VERIFY_ARGS:---logs /repo/.verify-logs}"]
