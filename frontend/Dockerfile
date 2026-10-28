# =============================================================================
# Frontend Dockerfile
#
# Build context: repository root  (docker compose sets this via context: .)
# Both the frontend workspace and the root lock file are needed.
# =============================================================================

# =============================================================================
# Stage 1 — Build static assets
# =============================================================================
FROM artnexus.partdp.ir/node:22-alpine AS builder

WORKDIR /app

# Allow operators to point at an internal npm mirror at build time:
#   docker compose build --build-arg NPM_REGISTRY=https://npm.your-company.internal/
# Defaults to the public registry so builds work out of the box.
ARG NPM_REGISTRY=http://npm.partcorp.ir/

# Copy manifests first to leverage layer caching.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

# Install ALL frontend dependencies (including devDependencies such as Vite).
# The lock file may have "resolved" URLs pointing to an internal registry mirror.
# We rewrite those to the configured registry so the build is reproducible.
RUN sed -i \
      "s|http://npm\.partcorp\.ir/|${NPM_REGISTRY}|g; \
       s|https://npm\.partcorp\.ir/|${NPM_REGISTRY}|g" \
      package-lock.json \
    && npm ci --workspace frontend --ignore-scripts

# Copy the frontend source
COPY frontend/index.html            ./frontend/
COPY frontend/vite.config.js        ./frontend/
COPY frontend/src                   ./frontend/src/

# Build — Vite outputs the production bundle to frontend/dist/
# VITE_API_BASE_URL is intentionally left unset: the frontend uses the
# relative path "/api" which Nginx proxies to the backend container.
RUN npm run build --workspace frontend

# =============================================================================
# Stage 2 — Serve with Nginx
# =============================================================================
FROM artnexus.partdp.ir/nginx:1.27-alpine AS runtime

# Remove the default Nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom Nginx configuration
COPY frontend/nginx.conf /etc/nginx/conf.d/app.conf

# Copy the compiled static assets from the builder stage
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Nginx master process runs as root to bind port 80, but worker processes
# are spawned as the unprivileged "nginx" user (configured in nginx base image).
# For truly rootless deployments, swap to nginxinc/nginx-unprivileged and
# listen on port 8080 instead.
EXPOSE 80

# Nginx handles its own signals (SIGTERM → graceful drain) natively.
CMD ["nginx", "-g", "daemon off;"]
