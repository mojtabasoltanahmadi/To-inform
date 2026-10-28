# =============================================================================
# Backend Dockerfile
#
# Build context: repository root  (docker compose sets this via context: .)
# This is required because the lock file (package-lock.json) lives at the
# workspace root, not inside backend/.
# =============================================================================

# =============================================================================
# Stage 1 — Install dependencies
# =============================================================================
FROM node:22-alpine AS deps

# dumb-init provides proper PID-1 signal forwarding and zombie-process reaping.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Allow operators to point at an internal npm mirror at build time:
#   docker compose build --build-arg NPM_REGISTRY=https://npm.your-company.internal/
# Defaults to the public registry so builds work out of the box.
ARG NPM_REGISTRY=https://registry.npmjs.org/

# Copy workspace manifests so Docker can cache the install layer separately
# from any source code changes.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install only the backend's production dependencies.
# The lock file may have "resolved" URLs pointing to an internal registry mirror
# (e.g. npm.partcorp.ir). We rewrite those to the configured registry so the
# build is reproducible in any network environment.
# --ignore-scripts prevents potentially unsafe lifecycle hooks from running.
RUN sed -i \
      "s|http://npm\.partcorp\.ir/|${NPM_REGISTRY}|g; \
       s|https://npm\.partcorp\.ir/|${NPM_REGISTRY}|g" \
      package-lock.json \
    && npm ci --workspace backend --omit=dev --ignore-scripts

# =============================================================================
# Stage 2 — Lean production runtime
# =============================================================================
FROM node:22-alpine AS runtime

# Never run as root in production.
USER node

WORKDIR /app

# Pull dumb-init from the deps stage
COPY --from=deps /usr/bin/dumb-init /usr/bin/dumb-init

# Copy the installed workspace node_modules.
# npm workspaces hoists shared deps to the root node_modules; the backend
# package has no private node_modules of its own, so we only need the root one.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# Copy the backend source files
COPY --chown=node:node backend/src  ./src
COPY --chown=node:node backend/package.json ./

# Expose the port the app listens on (Compose maps this internally).
EXPOSE 3000

# dumb-init as PID 1 ensures SIGTERM reaches Node and orphaned child processes
# are reaped correctly.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]
