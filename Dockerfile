# ---- build stage: has the compiler tools better-sqlite3 needs if no prebuilt binary is available
FROM node:22-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime stage: small image, no compilers
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY . .

# files and the SQLite database live here; mount a volume so they survive restarts
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node

EXPOSE 3000
CMD ["node", "server.js"]
