#!/usr/bin/env python3
"""
Mock laceup topology socket server for dcm-site-ui development.

Emits a synthetic wiring payload in laceup InternalIPC format — the same
JSON-over-Unix-socket protocol that laceup-daemon uses for its secondary
--export-topology exporter.

The dcm-site-ui laceupPoller reads this socket every 10 seconds (default)
and upserts the non-local nodes into discovered_nodes.

Usage:
  python3 ./scripts/mock-laceup-socket.py [options]

Options:
  --socket-path PATH   Unix socket path (default: /tmp/laceup/topology.sock)
  --once               Serve one connection then exit (for scripting)
  -v, --verbose        Print payload on each connection

Workflow:
  Terminal 1:  python3 ./scripts/mock-laceup-socket.py
  Terminal 2:  ./scripts/dev-run.sh --rebuild
  Browser:     http://localhost:9090  (nodes appear within 10 seconds)

The mock nodes use LACEUP- prefixed chassis serials so they do not collide
with HTTP-seeded fixtures. You can use both paths simultaneously.

Node inventory (8 non-local nodes):
  r640-laceup-cp{1,2,3}  — Dell R640: 40c/256G/4×SAS-HDD/4-NIC (control-plane)
  r750-laceup-w{1,2,3}   — Dell R750: 64c/512G/2×NVMe/4-NIC  (worker)
  a100-laceup-g{1,2}     — AMD EPYC:  96c/512G/2×NVMe-1.92T/2× NVIDIA A100 (GPU)
"""

import argparse
import json
import os
import signal
import socket
import sys
import time

# Bootstrap host (is_local=True — poller skips it)
BOOTSTRAP_HOSTNAME = "dcm-bootstrap"

# ── Synthetic node definitions ────────────────────────────────────────────────
# Each entry is in laceup wiring payload format:
#   node_details  — output of HardwareLib.gather_inventory()
#   interfaces    — dict of {iface_name: {mac, carrier, bond_state, edges}}

NODES = {
    # ── Control-plane nodes: Dell R640 (40c/256G/4×SAS-HDD) ──────────────────

    "r640-laceup-cp1": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Dell Inc.", "model": "PowerEdge R640"},
            "cpu": {
                "model_name": "Intel(R) Xeon(R) Silver 4316 CPU @ 2.30GHz",
                "architecture": "x86_64",
                "total_logical_cpus": 40,
                "sockets_count": 2,
                "cores_per_socket": 10,
                "threads_per_core": 2,
                "total_physical_cores": 20,
            },
            "memory": {"total_kb": 268435456, "total_gib": 256.0},
            "storage": {
                "total_disks_count": 4,
                "total_capacity_gib": 7276.0,
                "devices": [
                    {"device_name": "/dev/sda", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900ca0000", "wwn": "0x64cd98f2003e2ca0", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdb", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900ca0001", "wwn": "0x64cd98f2003e2ca1", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdc", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900ca0002", "wwn": "0x64cd98f2003e2ca2", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdd", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900ca0003", "wwn": "0x64cd98f2003e2ca3", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-R640-CP1",
                "board_serial": "LACEUP-BD-R640-CP1",
            },
            "gpus": [],
        },
        "interfaces": {
            "eno1":  {"mac": "24:6e:96:a1:10:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "eno2":  {"mac": "24:6e:96:a1:10:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens1f0":{"mac": "24:6e:96:a1:10:03", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens1f1":{"mac": "24:6e:96:a1:10:04", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    "r640-laceup-cp2": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Dell Inc.", "model": "PowerEdge R640"},
            "cpu": {
                "model_name": "Intel(R) Xeon(R) Silver 4316 CPU @ 2.30GHz",
                "architecture": "x86_64",
                "total_logical_cpus": 40,
                "sockets_count": 2,
                "cores_per_socket": 10,
                "threads_per_core": 2,
                "total_physical_cores": 20,
            },
            "memory": {"total_kb": 268435456, "total_gib": 256.0},
            "storage": {
                "total_disks_count": 4,
                "total_capacity_gib": 7276.0,
                "devices": [
                    {"device_name": "/dev/sda", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cb0000", "wwn": "0x64cd98f2003e2cb0", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdb", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cb0001", "wwn": "0x64cd98f2003e2cb1", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdc", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cb0002", "wwn": "0x64cd98f2003e2cb2", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdd", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cb0003", "wwn": "0x64cd98f2003e2cb3", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-R640-CP2",
                "board_serial": "LACEUP-BD-R640-CP2",
            },
            "gpus": [],
        },
        "interfaces": {
            "eno1":  {"mac": "24:6e:96:a2:20:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "eno2":  {"mac": "24:6e:96:a2:20:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens1f0":{"mac": "24:6e:96:a2:20:03", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens1f1":{"mac": "24:6e:96:a2:20:04", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    "r640-laceup-cp3": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Dell Inc.", "model": "PowerEdge R640"},
            "cpu": {
                "model_name": "Intel(R) Xeon(R) Silver 4316 CPU @ 2.30GHz",
                "architecture": "x86_64",
                "total_logical_cpus": 40,
                "sockets_count": 2,
                "cores_per_socket": 10,
                "threads_per_core": 2,
                "total_physical_cores": 20,
            },
            "memory": {"total_kb": 268435456, "total_gib": 256.0},
            "storage": {
                "total_disks_count": 4,
                "total_capacity_gib": 7276.0,
                "devices": [
                    {"device_name": "/dev/sda", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cc0000", "wwn": "0x64cd98f2003e2cc0", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdb", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cc0001", "wwn": "0x64cd98f2003e2cc1", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdc", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cc0002", "wwn": "0x64cd98f2003e2cc2", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                    {"device_name": "/dev/sdd", "model": "DELL PERC H755", "serial": "64cd98f2003e2a900023e5b900cc0003", "wwn": "0x64cd98f2003e2cc3", "transport": "sas", "media_type": "HDD (Rotational)", "size_bytes": 1999844147200, "size_gib": 1862.0},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-R640-CP3",
                "board_serial": "LACEUP-BD-R640-CP3",
            },
            "gpus": [],
        },
        "interfaces": {
            "eno1":  {"mac": "24:6e:96:a3:30:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "eno2":  {"mac": "24:6e:96:a3:30:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens1f0":{"mac": "24:6e:96:a3:30:03", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens1f1":{"mac": "24:6e:96:a3:30:04", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    # ── Worker nodes: Dell R750 (64c/512G/2×NVMe) ────────────────────────────

    "r750-laceup-w1": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Dell Inc.", "model": "PowerEdge R750"},
            "cpu": {
                "model_name": "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz",
                "architecture": "x86_64",
                "total_logical_cpus": 64,
                "sockets_count": 2,
                "cores_per_socket": 16,
                "threads_per_core": 2,
                "total_physical_cores": 32,
            },
            "memory": {"total_kb": 536870912, "total_gib": 512.0},
            "storage": {
                "total_disks_count": 2,
                "total_capacity_gib": 960.0,
                "devices": [
                    {"device_name": "/dev/nvme0n1", "model": "Samsung PM9A3 480GB", "serial": "S64GNXA083001", "wwn": "0x0025385b21a4e8a1", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 480103981056, "size_gib": 447.13},
                    {"device_name": "/dev/nvme1n1", "model": "Samsung PM9A3 480GB", "serial": "S64GNXA083002", "wwn": "0x0025385b21a4e8a2", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 480103981056, "size_gib": 447.13},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-R750-W1",
                "board_serial": "LACEUP-BD-R750-W1",
            },
            "gpus": [],
        },
        "interfaces": {
            "eno1":  {"mac": "b4:96:91:d1:10:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "eno2":  {"mac": "b4:96:91:d1:10:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens3f0":{"mac": "b4:96:91:d1:10:03", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens3f1":{"mac": "b4:96:91:d1:10:04", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    "r750-laceup-w2": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Dell Inc.", "model": "PowerEdge R750"},
            "cpu": {
                "model_name": "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz",
                "architecture": "x86_64",
                "total_logical_cpus": 64,
                "sockets_count": 2,
                "cores_per_socket": 16,
                "threads_per_core": 2,
                "total_physical_cores": 32,
            },
            "memory": {"total_kb": 536870912, "total_gib": 512.0},
            "storage": {
                "total_disks_count": 2,
                "total_capacity_gib": 960.0,
                "devices": [
                    {"device_name": "/dev/nvme0n1", "model": "Samsung PM9A3 480GB", "serial": "S64GNXA083003", "wwn": "0x0025385b21a4e8a3", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 480103981056, "size_gib": 447.13},
                    {"device_name": "/dev/nvme1n1", "model": "Samsung PM9A3 480GB", "serial": "S64GNXA083004", "wwn": "0x0025385b21a4e8a4", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 480103981056, "size_gib": 447.13},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-R750-W2",
                "board_serial": "LACEUP-BD-R750-W2",
            },
            "gpus": [],
        },
        "interfaces": {
            "eno1":  {"mac": "b4:96:91:d2:20:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "eno2":  {"mac": "b4:96:91:d2:20:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens3f0":{"mac": "b4:96:91:d2:20:03", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens3f1":{"mac": "b4:96:91:d2:20:04", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    "r750-laceup-w3": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Dell Inc.", "model": "PowerEdge R750"},
            "cpu": {
                "model_name": "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz",
                "architecture": "x86_64",
                "total_logical_cpus": 64,
                "sockets_count": 2,
                "cores_per_socket": 16,
                "threads_per_core": 2,
                "total_physical_cores": 32,
            },
            "memory": {"total_kb": 536870912, "total_gib": 512.0},
            "storage": {
                "total_disks_count": 2,
                "total_capacity_gib": 960.0,
                "devices": [
                    {"device_name": "/dev/nvme0n1", "model": "Samsung PM9A3 480GB", "serial": "S64GNXA083005", "wwn": "0x0025385b21a4e8a5", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 480103981056, "size_gib": 447.13},
                    {"device_name": "/dev/nvme1n1", "model": "Samsung PM9A3 480GB", "serial": "S64GNXA083006", "wwn": "0x0025385b21a4e8a6", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 480103981056, "size_gib": 447.13},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-R750-W3",
                "board_serial": "LACEUP-BD-R750-W3",
            },
            "gpus": [],
        },
        "interfaces": {
            "eno1":  {"mac": "b4:96:91:d3:30:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "eno2":  {"mac": "b4:96:91:d3:30:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens3f0":{"mac": "b4:96:91:d3:30:03", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
            "ens3f1":{"mac": "b4:96:91:d3:30:04", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    # ── GPU nodes: AMD EPYC + 2× NVIDIA A100 (96c/512G/2×NVMe-1.92TB) ───────

    "a100-laceup-g1": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Supermicro", "model": "AS-4124GS-TNR"},
            "cpu": {
                "model_name": "AMD EPYC 7413 24-Core Processor",
                "architecture": "x86_64",
                "total_logical_cpus": 96,
                "sockets_count": 2,
                "cores_per_socket": 24,
                "threads_per_core": 2,
                "total_physical_cores": 48,
            },
            "memory": {"total_kb": 536870912, "total_gib": 512.0},
            "storage": {
                "total_disks_count": 2,
                "total_capacity_gib": 3724.0,
                "devices": [
                    {"device_name": "/dev/nvme0n1", "model": "Samsung PM9A3 1.92TB", "serial": "S64GNE0T123801", "wwn": "0x0025385b21b4c9d1", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 1920383410176, "size_gib": 1789.0},
                    {"device_name": "/dev/nvme1n1", "model": "Samsung PM9A3 1.92TB", "serial": "S64GNE0T123802", "wwn": "0x0025385b21b4c9d2", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 1920383410176, "size_gib": 1789.0},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-A100-G1",
                "board_serial": "LACEUP-BD-A100-G1",
            },
            "gpus": [
                {"vendor": "NVIDIA", "detection_source": "nvidia-smi", "uuid": "GPU-a3f14b22-1234-5678-abcd-000000000001", "pci_bus_id": "0000:61:00.0", "vram_total_gib": 40.0},
                {"vendor": "NVIDIA", "detection_source": "nvidia-smi", "uuid": "GPU-a3f14b22-1234-5678-abcd-000000000002", "pci_bus_id": "0000:81:00.0", "vram_total_gib": 40.0},
            ],
        },
        "interfaces": {
            "ens3f0": {"mac": "94:6d:ae:a0:30:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "ens3f1": {"mac": "94:6d:ae:a0:30:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },

    "a100-laceup-g2": {
        "is_local": False,
        "node_details": {
            "system": {"virtualization": "None (Bare Metal)", "manufacturer": "Supermicro", "model": "AS-4124GS-TNR"},
            "cpu": {
                "model_name": "AMD EPYC 7413 24-Core Processor",
                "architecture": "x86_64",
                "total_logical_cpus": 96,
                "sockets_count": 2,
                "cores_per_socket": 24,
                "threads_per_core": 2,
                "total_physical_cores": 48,
            },
            "memory": {"total_kb": 536870912, "total_gib": 512.0},
            "storage": {
                "total_disks_count": 2,
                "total_capacity_gib": 3724.0,
                "devices": [
                    {"device_name": "/dev/nvme0n1", "model": "Samsung PM9A3 1.92TB", "serial": "S64GNE0T123803", "wwn": "0x0025385b21b4c9d3", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 1920383410176, "size_gib": 1789.0},
                    {"device_name": "/dev/nvme1n1", "model": "Samsung PM9A3 1.92TB", "serial": "S64GNE0T123804", "wwn": "0x0025385b21b4c9d4", "transport": "nvme", "media_type": "SSD (Non-Rotational)", "size_bytes": 1920383410176, "size_gib": 1789.0},
                ],
            },
            "unique_identifiers": {
                "chassis_serial": "LACEUP-A100-G2",
                "board_serial": "LACEUP-BD-A100-G2",
            },
            "gpus": [
                {"vendor": "NVIDIA", "detection_source": "nvidia-smi", "uuid": "GPU-b7e25c33-2345-6789-bcde-000000000003", "pci_bus_id": "0000:61:00.0", "vram_total_gib": 40.0},
                {"vendor": "NVIDIA", "detection_source": "nvidia-smi", "uuid": "GPU-b7e25c33-2345-6789-bcde-000000000004", "pci_bus_id": "0000:81:00.0", "vram_total_gib": 40.0},
            ],
        },
        "interfaces": {
            "ens3f0": {"mac": "94:6d:ae:b0:40:01", "carrier": "UP",   "bond_state": "Standalone", "edges": []},
            "ens3f1": {"mac": "94:6d:ae:b0:40:02", "carrier": "DOWN", "bond_state": "Standalone", "edges": []},
        },
        "top_of_rack_switches": {},
    },
}

# Bootstrap host entry (poller skips is_local=True)
BOOTSTRAP_NODE = {
    "is_local": True,
    "node_details": {
        "system": {"virtualization": "None (Bare Metal)"},
        "cpu": {
            "model_name": "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz",
            "architecture": "x86_64",
            "total_logical_cpus": 64,
            "sockets_count": 2,
            "cores_per_socket": 16,
            "threads_per_core": 2,
            "total_physical_cores": 32,
        },
        "memory": {"total_kb": 536870912, "total_gib": 512.0},
        "storage": {"total_disks_count": 0, "total_capacity_gib": 0, "devices": []},
        "unique_identifiers": {"chassis_serial": "LACEUP-BOOTSTRAP", "board_serial": "LACEUP-BD-BOOTSTRAP"},
        "gpus": [],
    },
    "interfaces": {
        "eno1": {"mac": "b4:96:91:00:00:01", "carrier": "UP", "bond_state": "Standalone", "edges": []},
    },
    "top_of_rack_switches": {},
}


def build_payload():
    return {
        "timestamp": time.time(),
        "cluster_id": 4711,
        "local_hostname": BOOTSTRAP_HOSTNAME,
        "nodes": {
            BOOTSTRAP_HOSTNAME: BOOTSTRAP_NODE,
            **NODES,
        },
    }


def serve(socket_path, once=False, verbose=False):
    sock_dir = os.path.dirname(socket_path)
    if sock_dir:
        os.makedirs(sock_dir, exist_ok=True)

    if os.path.exists(socket_path):
        os.unlink(socket_path)

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(socket_path)
    os.chmod(socket_path, 0o777)  # allow container process (different UID) to connect
    srv.listen(5)

    def cleanup(*_):
        srv.close()
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    node_names = [k for k in NODES]
    print(f"mock-laceup-socket: listening on {socket_path}")
    print(f"  {len(node_names)} nodes: {', '.join(node_names)}")
    print("  Ctrl+C to stop")
    print()

    connections = 0
    while True:
        conn, _ = srv.accept()
        connections += 1
        try:
            payload = build_payload()
            data = (json.dumps(payload) + "\n").encode("utf-8")
            conn.sendall(data)
            if verbose:
                print(f"  [{connections}] served {len(data)} bytes")
            else:
                print(f"  [{connections}] connection served ({len(node_names)} nodes)")
        finally:
            conn.close()

        if once:
            cleanup()


def main():
    parser = argparse.ArgumentParser(
        description="Mock laceup topology socket for dcm-site-ui dev testing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--socket-path",
        default="/tmp/laceup/topology.sock",
        help="Unix socket path (default: /tmp/laceup/topology.sock)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Serve one connection then exit",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Print payload size on each connection",
    )
    args = parser.parse_args()
    serve(args.socket_path, once=args.once, verbose=args.verbose)


if __name__ == "__main__":
    main()
