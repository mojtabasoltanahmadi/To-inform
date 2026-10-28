# Notify — Production Deployment Guide

Target platform: **Debian 13 (Trixie)** virtual machine, Docker Engine + Compose plugin.

---

## 1. Prerequisites

### 1.1 Docker Engine

```bash
# Remove legacy packages if present
sudo apt-get remove -y docker docker-engine docker.io containerd runc

# Install required packages
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key and repository
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
     docker-buildx-plugin docker-compose-plugin
```

Verify:

```bash
docker version
docker compose version
```

### 1.2 Add your user to the docker group (optional — avoids `sudo`)

```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Enterprise Network / Registry Mirrors

If the VM sits behind a corporate proxy or firewall that blocks Docker Hub or npm:

### Docker registry mirror

Create `/etc/docker/daemon.json`:

```json
{
  "registry-mirrors": ["https://<your-internal-mirror>"]
}
```

Then restart:

```bash
sudo systemctl restart docker
```

### npm registry mirror (used only at build time)

The `package-lock.json` in this repo was generated against an internal npm
mirror (`npm.partcorp.ir`). The Dockerfiles automatically rewrite those
resolved URLs to `https://registry.npmjs.org/` at build time, so public builds
work out of the box.

If your Debian VM has access to a **different** internal mirror, override it:

```bash
docker compose build \
  --build-arg NPM_REGISTRY=https://npm.your-company.internal/
```

The trailing slash is required.

---

## 3. Clone the Repository

```bash
git clone https://your-repo-url/notify.git
cd notify
```

---

## 4. Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in all required values:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **Yes** | Random secret ≥ 32 chars. Generate: `openssl rand -hex 32` |
| `NODE_ENV` | Yes | Set to `production` |
| `REDIS_URL` | Yes | `redis://redis:6379` (use service name) |
| `PORT` | No | Defaults to `3000` |
| `CORS_ORIGINS` | No | Public frontend origin(s) if API is on a different domain |
| `VITE_API_BASE_URL` | No | Leave blank — Nginx proxies `/api` to backend |

> **Security:** `.env` is listed in `.gitignore`. Never commit it. On CI/CD
> systems inject secrets via vault, secret manager, or pipeline secret variables.

---

## 5. Build and Start

```bash
docker compose up -d --build
```

This will:

1. Build the backend image (Node 22 Alpine, production deps only).
2. Build the frontend image (Vite build → Nginx Alpine serving static assets).
3. Pull Redis 7 Alpine.
4. Start all three containers on the isolated `notify_net` bridge network.
5. Expose **port 80** on the host for the frontend.

First build takes 2–4 minutes depending on network speed. Subsequent builds are
much faster due to Docker layer caching.

---

## 6. Verification

### Check running containers

```bash
docker compose ps
```

All three services (`redis`, `backend`, `frontend`) should show status **healthy** or **running**.

### View logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f redis
```

### Test the API health endpoint

```bash
curl -s http://localhost/api/health | python3 -m json.tool
# Expected: {"status":"ok","redis":"connected"}
```

### Open the app

Navigate to `http://<VM-IP-ADDRESS>` in a browser.

---

## 7. Operations

### Stop all services (keep volumes)

```bash
docker compose down
```

### Stop and destroy volumes (⚠️ deletes all Redis data)

```bash
docker compose down -v
```

### Restart a single service

```bash
docker compose restart backend
```

### Redeploy after a code change

```bash
git pull
docker compose up -d --build
```

Docker Compose will only rebuild changed images and replace affected containers.

### View resource usage

```bash
docker stats
```

---

## 8. Troubleshooting

### Port 80 is already in use

```
Error: Ports are not available: listen tcp 0.0.0.0:80: bind: address already in use
```

Find and stop the conflicting process:

```bash
sudo ss -tlnp | grep :80
sudo systemctl stop nginx   # if system Nginx is running
```

Or change the host port in `docker-compose.yml`:

```yaml
ports:
  - "8080:80"   # expose on host port 8080 instead
```

### CORS errors in browser

If the frontend is served from a different origin than expected, set `CORS_ORIGINS`
in `.env` to the exact scheme+host+port the browser uses, e.g.:

```
CORS_ORIGINS=https://notify.your-company.com
```

Because Nginx proxies `/api` calls from the same origin as the SPA, CORS is
only needed when the API is accessed directly (e.g., from a mobile app or
third-party client).

### Backend container unhealthy / keeps restarting

1. Check backend logs: `docker compose logs backend`
2. The most common cause is Redis not being ready yet — the `depends_on` +
   healthcheck should prevent this, but if Redis is slow, increase
   `start_period` in the backend healthcheck in `docker-compose.yml`.
3. Verify `JWT_SECRET` is set and is ≥ 32 characters (the app throws on startup
   if this check fails in production mode).

### Redis connection errors

```
Redis connection error: connect ECONNREFUSED 127.0.0.1:6379
```

This means the backend is trying to reach Redis on `localhost` instead of the
`redis` service hostname. Confirm `REDIS_URL=redis://redis:6379` is set in `.env`.

### Healthcheck keeps timing out

```bash
# Manually exec into the container to debug
docker compose exec backend wget -qO- http://localhost:3000/api/health
docker compose exec redis redis-cli ping
```

Increase `start_period` in the relevant service's healthcheck if the
container simply needs more warm-up time.

### "Cannot find module" at backend startup

The backend uses ESM (`"type": "module"`). If you see import errors, confirm
the Node version inside the container:

```bash
docker compose exec backend node --version  # should print v22.x.x
```

---

## 9. Adding TLS (HTTPS)

For production traffic add a TLS terminator in front of the `frontend` container.
Options:

- **Caddy** (recommended for simplicity): Add a `caddy` service to `docker-compose.yml`
  that reverse-proxies to `frontend:80` and handles Let's Encrypt certificates
  automatically.
- **Nginx Proxy Manager**: GUI-based TLS reverse proxy, runs as a separate container.
- **Cloud load balancer**: Offload TLS at the infrastructure layer and point it
  at port 80 of this VM.

Change the `frontend` service `ports` mapping to only listen on localhost in
that case:

```yaml
ports:
  - "127.0.0.1:80:80"
```

---

## 10. File Structure Reference

```
.
├── .env.example          ← template — copy to .env and fill in secrets
├── .dockerignore         ← root-level ignore for compose build context
├── docker-compose.yml    ← orchestrates backend, frontend, redis
├── DEPLOY.md             ← this file
├── backend/
│   ├── Dockerfile        ← multi-stage Node 22 Alpine build
│   ├── .dockerignore
│   └── src/
│       └── config.js     ← reads PORT, REDIS_URL, JWT_SECRET, CORS_ORIGINS
└── frontend/
    ├── Dockerfile        ← Node 22 builder → Nginx 1.27 Alpine runtime
    ├── .dockerignore
    └── nginx.conf        ← SPA fallback, /api proxy, caching headers
```
