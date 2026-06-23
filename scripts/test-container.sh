#!/usr/bin/env bash
# test-container.sh — Run backend tests inside a container.
# No npm install needed on the workstation.
#
# Usage: ./scripts/test-container.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_IMAGE="registry.access.redhat.com/ubi9/nodejs-20:latest"

echo "Running backend tests in container..."
echo "  image: ${NODE_IMAGE}"
echo ""

podman run --rm \
  -v "${REPO_DIR}/backend:/src:ro,z" \
  -e DATA_DIR=/tmp/dcm-site-ui-test \
  -e NODE_ENV=test \
  "${NODE_IMAGE}" \
  sh -c "cp -r /src /tmp/work && cd /tmp/work && npm ci --include=dev && node --test test/"
