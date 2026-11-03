# The verify agents' container, run on the agent host VM under gVisor
# (see run.mjs --sandboxed): Playwright's image (Node and Chromium, matching
# package-lock.json's playwright), opencode as in the agent sandbox, and
# Intopia's web accessibility skill (© Intopia, CC BY-NC-SA 4.0:
# https://github.com/Intopia/intopia-web-accessibility-skill), fetched here,
# not kept in this repository. The repository is mounted at /repo.
FROM mcr.microsoft.com/playwright:v1.59.1-noble

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
CMD ["sh", "-c", "mkdir -p $HOME/.cache/opencode && cp -n /opt/agent/models.json $HOME/.cache/opencode/models.json && npm ci --no-audit --no-fund --loglevel=error && exec node scripts/verify-adapters/run.mjs --agent --sandboxed --skills /opt/agent/skills --logs /repo/.verify-logs ${VERIFY_ARGS}"]
