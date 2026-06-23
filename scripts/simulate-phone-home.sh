#!/usr/bin/env bash
# simulate-phone-home.sh — POST all test fixtures to a running dcm-site-ui backend.
# Simulates nodes booting the discovery ISO and phoning home.
#
# Usage: ./scripts/simulate-phone-home.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:9090
#
# Each fixture is posted with a 2-second delay to simulate staggered boot times.
set -euo pipefail

BASE_URL="${1:-http://localhost:9090}"
FIXTURES_DIR="$(cd "$(dirname "$0")/../test/fixtures" && pwd)"
DELAY="${PHONE_HOME_DELAY:-2}"

echo "dcm-site-ui — simulating node phone-home"
echo "  target: ${BASE_URL}/api/discovery/report"
echo "  fixtures: ${FIXTURES_DIR}"
echo ""

success=0
failure=0

for fixture in "${FIXTURES_DIR}"/node-*.json; do
  name="$(basename "${fixture}" .json)"
  serial=$(python3 -c "import sys,json; print(json.load(open('${fixture}'))['serial'])")

  printf "  %-40s ... " "${name} (${serial})"

  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    --connect-timeout 5 \
    -d "@${fixture}" \
    "${BASE_URL}/api/discovery/report" 2>&1)

  http_code=$(printf '%s' "${response}" | tail -1)
  body=$(printf '%s' "${response}" | head -n -1)

  if [ "${http_code}" = "200" ]; then
    printf "OK\n"
    (( success++ )) || true
  else
    printf "FAILED (HTTP %s): %s\n" "${http_code}" "${body}"
    (( failure++ )) || true
  fi

  sleep "${DELAY}"
done

echo ""
echo "  posted: ${success} ok, ${failure} failed"
echo ""
echo "  nodes: ${BASE_URL}/api/discovery/nodes"
echo "  drain: ${BASE_URL}/api/discovery/drain"
