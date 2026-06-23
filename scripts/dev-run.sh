#!/usr/bin/env bash
# dev-run.sh — Build and run the production container locally.
# No npm install needed on the workstation — everything runs inside the container.
#
# Usage: ./scripts/dev-run.sh [--rebuild]
#   --rebuild  Force a fresh image build even if one already exists
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="dcm-site-ui:dev"
CONTAINER="dcm-site-ui-dev"
VOLUME="dcm-site-ui-dev-data"
PORT=9090

REBUILD=false
for arg in "$@"; do
  [ "${arg}" = "--rebuild" ] && REBUILD=true
done

# Remove any existing dev container
if podman container exists "${CONTAINER}" 2>/dev/null; then
  echo "Stopping and removing existing container: ${CONTAINER}"
  podman rm -f "${CONTAINER}"
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
podman run -d \
  --name "${CONTAINER}" \
  -p "${PORT}:9090" \
  -v "${VOLUME}:/var/lib/dcm-site-ui/data:Z" \
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
echo "Simulate phone-home:"
echo "  ./scripts/simulate-phone-home.sh http://127.0.0.1:${PORT}"
