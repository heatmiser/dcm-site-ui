#!/usr/bin/env bash
# dev-run.sh — Build and run the production container locally.
# No npm install needed on the workstation — everything runs inside the container.
#
# Usage: ./scripts/dev-run.sh [--rebuild] [--clean]
#   --rebuild  Force a fresh image build even if one already exists
#   --clean    Drop the persistent data volume before starting (fresh DB)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="dcm-site-ui:dev"
CONTAINER="dcm-site-ui-dev"
VOLUME="dcm-site-ui-dev-data"
PORT=9090

REBUILD=false
CLEAN=false
for arg in "$@"; do
  [ "${arg}" = "--rebuild" ] && REBUILD=true
  [ "${arg}" = "--clean" ] && CLEAN=true
done

# Remove any existing dev container
if podman container exists "${CONTAINER}" 2>/dev/null; then
  echo "Stopping and removing existing container: ${CONTAINER}"
  podman rm -f "${CONTAINER}"
fi

# Drop persistent data volume if --clean was requested
if [ "${CLEAN}" = "true" ]; then
  if podman volume exists "${VOLUME}" 2>/dev/null; then
    echo "Removing data volume: ${VOLUME} (--clean)"
    podman volume rm "${VOLUME}"
  fi
fi

# Build image if needed
if [ "${REBUILD}" = "true" ] || ! podman image exists "${IMAGE}" 2>/dev/null; then
  echo "Building production image: ${IMAGE}"
  podman build -t "${IMAGE}" "${REPO_DIR}"
else
  echo "Using existing image: ${IMAGE}  (pass --rebuild to force rebuild)"
fi

# Ensure persistent volume exists
podman volume exists "${VOLUME}" 2>/dev/null || podman volume create "${VOLUME}"

echo ""
echo "Starting dcm-site-ui on port ${PORT}..."
# /tmp/laceup is the host-side laceup socket directory. The laceupPoller in
# the container reads /run/laceup/topology.sock (default LACEUP_SOCKET_PATH).
# When the socket is absent the poller is a no-op; mount is always present.
mkdir -p /tmp/laceup
podman run -d \
  --name "${CONTAINER}" \
  -p "${PORT}:9090" \
  -v "${VOLUME}:/var/lib/dcm-site-ui/data:Z" \
  -v "/tmp/laceup:/run/laceup:z" \
  --security-opt label=disable \
  "${IMAGE}"

echo ""
echo "Waiting for healthz..."
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "  ready"
    break
  fi
  sleep 1
done

echo ""
curl -s "http://127.0.0.1:${PORT}/healthz" | python3 -m json.tool
echo ""
echo "  UI:     http://127.0.0.1:${PORT}"
echo "  nodes:  http://127.0.0.1:${PORT}/api/discovery/nodes"
echo "  logs:   podman logs -f ${CONTAINER}"
echo "  stop:   podman rm -f ${CONTAINER}"
echo ""
echo "Seed via HTTP (legacy phone-home path):"
echo "  ./scripts/dev-seed.sh --fixture-set lab --classify"
echo ""
echo "Seed via laceup socket (L2 mesh path, poller runs every 10s):"
echo "  python3 ./scripts/mock-laceup-socket.py"
