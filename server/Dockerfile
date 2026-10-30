# Build context is the REPO ROOT (server/ imports ../toolkit/**, so both
# trees must be in the image, plus the skill it serves):
#   docker build -f server/Dockerfile -t toolkit-service .
FROM node:24-slim

WORKDIR /app

# server/ has zero npm dependencies (plain node:http, node:crypto, ES
# modules) and toolkit/ is consumed as source, not as an installed package —
# no `npm install` step needed for either.
COPY toolkit/ ./toolkit/
COPY server/ ./server/
# The coding-agent skill, served at /skill/ai4a11y-toolkit/ (sdk-assets.js).
COPY .claude/skills/ai4a11y-toolkit/ ./.claude/skills/ai4a11y-toolkit/

WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
