import net from "node:net";
import { existsSync } from "node:fs";
import { nanoid } from "nanoid";
import { db } from "./db.js";
import logger from "./logger.js";

const SOCKET_PATH = process.env.LACEUP_SOCKET_PATH || "/run/laceup/topology.sock";
const POLL_INTERVAL_MS = parseInt(process.env.LACEUP_POLL_INTERVAL_MS || "10000", 10);

const INVALID_SERIALS = new Set([
  "", "Not Specified", "Default string", "0", "System Serial Number",
]);

function isValidSerial(s) {
  if (!s) return false;
  if (INVALID_SERIALS.has(s)) return false;
  if (s.includes("Permission")) return false;
  return true;
}

function parseBondState(s) {
  const m = s.match(/^(\S+)\s+\(([^)]+)\)\s+\[([^\]]+)\]$/);
  if (!m) return null;
  return { name: m[1], mode: m[2], health: m[3] };
}

function primaryMac(interfaces) {
  for (const ifc of Object.values(interfaces || {})) {
    if (ifc.carrier === "UP" && ifc.mac) return ifc.mac;
  }
  for (const ifc of Object.values(interfaces || {})) {
    if (ifc.mac) return ifc.mac;
  }
  return null;
}

function translateNode(nodeName, nodeData) {
  const nd = nodeData.node_details || {};
  const uid = nd.unique_identifiers || {};
  const ifaces = nodeData.interfaces || {};
  const sys = nd.system || {};

  let serial = uid.chassis_serial;
  if (!isValidSerial(serial)) serial = uid.board_serial;
  if (!isValidSerial(serial)) serial = primaryMac(ifaces);
  if (!serial) return null;

  const mac = primaryMac(ifaces);

  const interfaces = Object.entries(ifaces).map(([name, ifc]) => ({
    name,
    mac: ifc.mac,
    state: (ifc.carrier || "DOWN").toLowerCase(),
    mtu: null,
    speed: null,
  }));

  const bondGroups = {};
  for (const [ifaceName, ifc] of Object.entries(ifaces)) {
    const bs = ifc.bond_state;
    if (!bs || bs === "Standalone") continue;
    const parsed = parseBondState(bs);
    if (!parsed) continue;
    if (!bondGroups[parsed.name]) {
      bondGroups[parsed.name] = { name: parsed.name, mode: parsed.mode, health: parsed.health, members: [] };
    }
    bondGroups[parsed.name].members.push(ifaceName);
  }
  const bonds = Object.values(bondGroups);

  const storage = nd.storage || {};
  const disks = (storage.devices || []).map((d) => ({
    name: (d.device_name || "").replace("/dev/", ""),
    by_path: null,
    size_gb: Math.round(d.size_gib || 0),
    rotational: (d.media_type || "").includes("HDD"),
    model: d.model || null,
    serial: d.serial || null,
    wwn: d.wwn || null,
    vendor: null,
  }));

  const cpu_raw = nd.cpu || {};
  const cpu = {
    count: cpu_raw.total_logical_cpus || 0,
    model: cpu_raw.model_name || null,
    architecture: cpu_raw.architecture || null,
  };

  const memory_gb = Math.round((nd.memory || {}).total_gib || 0);

  const gpuMap = {};
  for (const g of nd.gpus || []) {
    const vendor = g.vendor || "Unknown";
    gpuMap[vendor] = (gpuMap[vendor] || 0) + 1;
  }
  const gpu = Object.entries(gpuMap).map(([vendor, count]) => ({ count, vendor, model: vendor }));

  return {
    serial,
    mac,
    ip: null,
    hostname: nodeName,
    interfaces,
    bonds,
    disks,
    cpu,
    memory_gb,
    gpu,
    system: {
      manufacturer: sys.manufacturer || null,
      model: sys.model || null,
      bios_version: null,
    },
  };
}

function readTopologySnapshot(socketPath) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    const chunks = [];
    sock.on("data", (chunk) => chunks.push(chunk));
    sock.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    sock.on("error", reject);
  });
}

const upsert = db.prepare(`
  INSERT INTO discovered_nodes (id, serial, mac, ip, received_at, manifest_json)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(serial) DO UPDATE SET
    mac = excluded.mac,
    ip = excluded.ip,
    received_at = excluded.received_at,
    manifest_json = excluded.manifest_json,
    drained_at = NULL
`);

async function poll() {
  if (!existsSync(SOCKET_PATH)) return;

  let snapshot;
  try {
    snapshot = await readTopologySnapshot(SOCKET_PATH);
  } catch (err) {
    logger.warn({ err }, "laceup socket read failed");
    return;
  }

  const nodes = snapshot.nodes || {};
  let upserted = 0;

  for (const [nodeName, nodeData] of Object.entries(nodes)) {
    if (nodeData.is_local) continue;

    const manifest = translateNode(nodeName, nodeData);
    if (!manifest) {
      logger.warn({ nodeName }, "laceup node skipped: no usable serial");
      continue;
    }

    upsert.run(nanoid(), manifest.serial, manifest.mac, manifest.ip, Date.now(), JSON.stringify(manifest));
    upserted++;
  }

  if (upserted > 0) {
    logger.info({ upserted }, "laceup nodes upserted from socket");
  }
}

export function startPoller() {
  setInterval(() => {
    poll().catch((err) => logger.error({ err }, "laceup poller error"));
  }, POLL_INTERVAL_MS);
  poll().catch((err) => logger.error({ err }, "laceup poller initial poll error"));
}
