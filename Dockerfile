# OSRS Quest Pathfinder — production image
# Build stage uses bun (matches bun.lock); runtime is plain Node.js.
# Multi-arch note: this builds INSIDE the container, so it works on
# x86_64 and ARM64 hosts alike.

# ---------- build stage ----------
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source (quest datasets live in src/data, bundled at build time)
COPY src ./src
COPY public ./public
COPY next.config.ts tailwind.config.ts postcss.config.mjs tsconfig.json components.json ./

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# package.json "build" = next build + copy static/public into standalone/
RUN bun run build

# ---------- runtime stage ----------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup -S app && adduser -S app -G app

# Next.js standalone output is self-contained (all traced deps bundled)
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/public ./public
COPY --chown=app:app healthcheck.js ./healthcheck.js

USER app
EXPOSE 3000

# Built-in container healthcheck (visible in `docker ps`, used by setup.sh)
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD ["node", "/app/healthcheck.js"]

CMD ["node", "server.js"]
