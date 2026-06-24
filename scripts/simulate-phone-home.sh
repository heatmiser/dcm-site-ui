#!/usr/bin/env bash
# simulate-phone-home.sh — POST all test fixtures to a running dcm-site-ui backend.
# Simulates nodes booting the discovery ISO and phoning home.
#
# Usage: ./scripts/simulate-phone-home.sh [--fixture-set <name>] [BASE_URL]
#   --fixture-set  subdirectory under test/fixtures/ to use (default: standard)
#   BASE_URL       defaults to http://localhost:9090
#
# Each fixture is posted with a 2-second delay to simulate staggered boot times.
set -euo pipefail

FIXTURE_SET="standard"
BASE_URL="http://localhost:9090"
DELAY="${PHONE_HOME_DELAY:-2}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture-set)
      FIXTURE_SET="$2"
      shift 2
      ;;
    http://*|https://*)
      BASE_URL="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

FIXTURES_DIR="$(cd "$(dirname "$0")/../test/fixtures/${FIXTURE_SET}" && pwd)"

if [[ ! -d "${FIXTURES_DIR}" ]]; then
  echo "Fixture set not found: ${FIXTURES_DIR}" >&2
  exit 1
fi

echo "dcm-site-ui — simulating node phone-home"
echo "  target:      ${BASE_URL}/api/discovery/report"
echo "  fixture-set: ${FIXTURE_SET}"
echo "  fixtures:    ${FIXTURES_DIR}"
echo ""

success=0
failure=0

for fixture in "${FIXTURES_DIR}"/node-*.json; do
  name="$(basename "${fixture}" .json)"
  serial=$(python3 -c "import sys,json; print(json.load(open('${fixture}'))['serial'])")

  printf "  %-45s ... " "${name} (${serial})"

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
