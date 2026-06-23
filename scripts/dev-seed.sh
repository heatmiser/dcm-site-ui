#!/usr/bin/env bash
# dev-seed.sh — Seed all test fixtures and optionally auto-classify for UI development.
#
# Usage:
#   ./scripts/dev-seed.sh [BASE_URL] [--classify]
#
#   BASE_URL defaults to http://localhost:9090
#   --classify assigns roles: first 3 nodes → control-plane, rest → worker
#
# Examples:
#   ./scripts/dev-seed.sh                           # seed only
#   ./scripts/dev-seed.sh http://localhost:9090 --classify  # seed + auto-classify
set -euo pipefail

BASE_URL="${1:-http://localhost:9090}"
CLASSIFY=false

for arg in "$@"; do
  [ "${arg}" = "--classify" ] && CLASSIFY=true
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Step 1: post all fixtures with no delay in seed mode
PHONE_HOME_DELAY=0 "${SCRIPT_DIR}/simulate-phone-home.sh" "${BASE_URL}"

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
