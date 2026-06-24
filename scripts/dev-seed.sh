#!/usr/bin/env bash
# dev-seed.sh — Seed all test fixtures and optionally auto-classify for UI development.
#
# Usage:
#   ./scripts/dev-seed.sh [--fixture-set <name>] [BASE_URL] [--classify]
#
#   --fixture-set  subdirectory under test/fixtures/ to use (default: standard)
#   BASE_URL       defaults to http://localhost:9090
#   --classify     assigns roles: first 3 nodes → control-plane, rest → worker
#
# Examples:
#   ./scripts/dev-seed.sh                                       # seed standard fixtures
#   ./scripts/dev-seed.sh --fixture-set lab                     # seed lab fixtures
#   ./scripts/dev-seed.sh --fixture-set lab --classify          # seed lab + auto-classify
#   ./scripts/dev-seed.sh http://localhost:9090 --classify      # seed standard + classify
set -euo pipefail

FIXTURE_SET="standard"
BASE_URL="http://localhost:9090"
CLASSIFY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture-set)
      FIXTURE_SET="$2"
      shift 2
      ;;
    --classify)
      CLASSIFY=true
      shift
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Step 1: post all fixtures with no delay in seed mode
PHONE_HOME_DELAY=0 "${SCRIPT_DIR}/simulate-phone-home.sh" --fixture-set "${FIXTURE_SET}" "${BASE_URL}"

[ "${CLASSIFY}" = "false" ] && exit 0

echo ""
echo "Auto-classifying nodes (first 3 → control-plane, rest → worker)..."
echo ""

export NODES_JSON
NODES_JSON=$(curl -s "${BASE_URL}/api/discovery/nodes")

CLASSIFY_PAYLOAD=$(python3 - <<'PYEOF'
import json, os

data = json.loads(os.environ.get('NODES_JSON', '{"nodes":[]}'))
nodes = data.get('nodes', [])
result = []

for i, node in enumerate(nodes):
    if i < 3:
        role = 'control-plane'
        hostname = f"cp{i+1}.cluster.example.com"
    else:
        role = 'worker'
        hostname = f"worker{i-2}.cluster.example.com"

    iface = next(
        (ifc['name'] for ifc in node['manifest'].get('interfaces', []) if ifc.get('state') == 'up'),
        node['manifest']['interfaces'][0]['name'] if node['manifest'].get('interfaces') else None
    )
    disk = node['manifest']['disks'][0]['by_path'] if node['manifest'].get('disks') else None

    result.append({
        'id': node['id'],
        'role': role,
        'hostname': hostname,
        'interface_selected': iface,
        'disk_selected': disk,
    })

print(json.dumps({'nodes': result}))
PYEOF
)

curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "${CLASSIFY_PAYLOAD}" \
  "${BASE_URL}/api/discovery/classify" | python3 -m json.tool

echo ""
echo "Done. UI: ${BASE_URL}"
