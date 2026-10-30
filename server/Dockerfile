# Build context is the REPO ROOT (server/ imports ../toolkit/**, so both
# trees must be in the image):
#   docker build -f server/Dockerfile -t toolkit-service .
FROM node:24-slim

WORKDIR /app

# server/ has zero npm dependencies (plain node:http, node:crypto, ES
# modules) and toolkit/ is consumed as source, not as an installed package —
# no `npm install` step needed for either.
COPY toolkit/ ./toolkit/
COPY server/ ./server/

WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
