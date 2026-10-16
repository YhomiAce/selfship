#!/usr/bin/env bash
# Selfship server bootstrap. Idempotent: safe to run again at any time.
# Installs Docker (>= 23), adds swap on small servers, opens the firewall
# for SSH/HTTP/HTTPS, enables automatic security updates, and runs Traefik
# with automatic Let's Encrypt.
#
# Inputs (environment): SSH_PORT, ACME_EMAIL (optional), ACME_STAGING (0/1)
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

SELFSHIP_DIR=/opt/selfship
SSH_PORT="${SSH_PORT:-22}"
ACME_EMAIL="${ACME_EMAIL:-}"
ACME_STAGING="${ACME_STAGING:-0}"
# Pinned major+minor so an upstream release can't change behaviour unexpectedly.
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.7}"

log() { echo "[bootstrap] $*"; }

# ── 1. Docker ────────────────────────────────────────────────────────────────
docker_major() { docker version -f '{{.Server.Version}}' 2>/dev/null | cut -d. -f1; }
if command -v docker >/dev/null 2>&1 && [ "$(docker_major || echo 0)" -ge 23 ]; then
  log "Docker $(docker version -f '{{.Server.Version}}') already installed"
else
  log "Installing Docker (official convenience script)"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git >/dev/null
  curl -fsSL https://get.docker.com | sh >/dev/null
  log "Docker $(docker version -f '{{.Server.Version}}') installed"
fi
systemctl enable --now docker >/dev/null 2>&1
command -v git >/dev/null 2>&1 || apt-get install -y -qq git >/dev/null

# ── 2. Swap on small servers (builds need headroom) ──────────────────────────
mem_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 2000 ] && [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
  log "Adding 2 GB swap (RAM is ${mem_mb} MB)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-selfship-swap.conf
else
  log "Swap: $(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo) MB (RAM ${mem_mb} MB)"
fi

# ── 3. Firewall (SSH port first, so we can't lock ourselves out) ─────────────
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${SSH_PORT}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  log "Firewall: allowing ${SSH_PORT}, 80, 443"
fi

# ── 4. Automatic security updates ────────────────────────────────────────────
if command -v apt-get >/dev/null 2>&1; then
  dpkg -s unattended-upgrades >/dev/null 2>&1 || apt-get install -y -qq unattended-upgrades >/dev/null
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
  log "Automatic security updates enabled"
fi

# ── 5. Shared network + Traefik ──────────────────────────────────────────────
docker network inspect selfship >/dev/null 2>&1 || { docker network create selfship >/dev/null; log "Created network selfship"; }
install -d -m 700 "$SELFSHIP_DIR/traefik"
[ -f "$SELFSHIP_DIR/traefik/acme.json" ] || install -m 600 /dev/null "$SELFSHIP_DIR/traefik/acme.json"

args=(
  --providers.docker=true
  --providers.docker.exposedbydefault=false
  --providers.docker.network=selfship
  --entrypoints.web.address=:80
  --entrypoints.websecure.address=:443
  --entrypoints.web.http.redirections.entrypoint.to=websecure
  --entrypoints.web.http.redirections.entrypoint.scheme=https
  --certificatesresolvers.le.acme.storage=/acme.json
  --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
  --ping=true
  --log.level=INFO
)
[ -n "$ACME_EMAIL" ] && args+=(--certificatesresolvers.le.acme.email="$ACME_EMAIL")
[ "$ACME_STAGING" = "1" ] && args+=(--certificatesresolvers.le.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory)

# Recreate Traefik only when its configuration changed.
config_hash=$(printf '%s\n' "$TRAEFIK_IMAGE" "${args[@]}" | sha256sum | cut -c1-16)
current_hash=$(docker inspect -f '{{ index .Config.Labels "selfship.config-hash" }}' selfship-traefik 2>/dev/null || true)
if [ "$current_hash" = "$config_hash" ] && [ "$(docker inspect -f '{{.State.Running}}' selfship-traefik 2>/dev/null)" = "true" ]; then
  log "Traefik already running with this configuration"
else
  docker pull -q "$TRAEFIK_IMAGE" >/dev/null
  docker rm -f selfship-traefik >/dev/null 2>&1 || true
  docker run -d --name selfship-traefik --restart unless-stopped \
    --network selfship -p 80:80 -p 443:443 \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v "$SELFSHIP_DIR/traefik/acme.json:/acme.json" \
    --label "selfship.config-hash=$config_hash" \
    "$TRAEFIK_IMAGE" "${args[@]}" >/dev/null
  log "Traefik started ($(docker inspect -f '{{.Config.Image}}' selfship-traefik))"
fi

# Wait until Traefik answers its health check.
for _ in $(seq 1 30); do
  if docker exec selfship-traefik traefik healthcheck --ping >/dev/null 2>&1; then log "Traefik is healthy"; exit 0; fi
  sleep 1
done
log "Traefik did not become healthy; recent logs:"
docker logs --tail 30 selfship-traefik
exit 1
