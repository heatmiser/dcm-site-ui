import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

// Must be set before app.js is imported (db.js reads DATA_DIR at module init time)
const TEST_DATA_DIR = `/tmp/dcm-site-ui-test-${process.pid}`;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";

const { default: supertest } = await import("supertest");
const { default: app } = await import("../src/app.js");

const request = supertest(app);

const DELL_R750_NODE = {
  serial: "7X4KPM3",
  hostname: "discovery-7x4kpm3.local",
  ip: "10.0.100.101",
  interfaces: [
    { name: "eno1", mac: "b4:96:91:a2:3c:10", state: "up", mtu: 1500, speed: 1000 },
    { name: "ens3f0", mac: "b4:96:91:a2:3c:12", state: "down", mtu: 1500, speed: 25000 },
  ],
  disks: [
    {
      by_path: "/dev/disk/by-path/pci-0000:65:00.0-nvme-1",
      name: "nvme0n1",
      size_gb: 480,
      rotational: false,
      model: "Samsung PM9A3 480GB",
      vendor: "Samsung",
      serial: "S64GNXA082345",
      wwn: "0x0025385b21a3e7f4",
    },
  ],
  cpu: { count: 64, model: "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz", architecture: "x86_64" },
  memory_gb: 512,
  gpu: [],
  system: { manufacturer: "Dell Inc.", model: "PowerEdge R750", bios_version: "1.9.2" },
};

describe("GET /healthz", () => {
  it("returns service identity", async () => {
    const res = await request.get("/healthz");
    assert.equal(res.status, 200);
    assert.equal(res.body.service, "dcm-site-ui");
    assert.equal(res.body.status, "ok");
  });
});

describe("POST /api/discovery/report", () => {
  it("accepts a valid node manifest", async () => {
    const res = await request.post("/api/discovery/report").send(DELL_R750_NODE);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.ok(res.body.id);
  });

  it("rejects missing serial", async () => {
    const { serial: _serial, ...noSerial } = DELL_R750_NODE;
    const res = await request.post("/api/discovery/report").send(noSerial);
    assert.equal(res.status, 400);
  });

  it("rejects missing ip", async () => {
    const { ip: _ip, ...noIp } = DELL_R750_NODE;
    const res = await request.post("/api/discovery/report").send(noIp);
    assert.equal(res.status, 400);
  });

  it("is idempotent on serial — updates manifest, resets drain state", async () => {
    const updated = { ...DELL_R750_NODE, ip: "10.0.100.199" };
    const res = await request.post("/api/discovery/report").send(updated);
    assert.equal(res.status, 200);

    const nodes = await request.get("/api/discovery/nodes");
    const node = nodes.body.nodes.find((n) => n.serial === "7X4KPM3");
    assert.equal(node.ip, "10.0.100.199");
  });
});

describe("GET /api/discovery/nodes", () => {
  it("returns array of nodes with parsed manifests", async () => {
    const res = await request.get("/api/discovery/nodes");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.nodes));

    const node = res.body.nodes.find((n) => n.serial === "7X4KPM3");
    assert.ok(node, "reported node should appear in list");
    assert.equal(node.manifest.cpu.count, 64);
    assert.equal(node.manifest.memory_gb, 512);
    assert.equal(node.manifest.system.model, "PowerEdge R750");
  });
});

describe("POST /api/discovery/classify", () => {
  it("assigns role and hostname to a node", async () => {
    const nodes = await request.get("/api/discovery/nodes");
    const node = nodes.body.nodes.find((n) => n.serial === "7X4KPM3");
    assert.ok(node);

    const res = await request.post("/api/discovery/classify").send({
      nodes: [
        {
          id: node.id,
          role: "control-plane",
          hostname: "cp1.cluster.example.com",
          interface_selected: "eno1",
          disk_selected: "/dev/disk/by-path/pci-0000:65:00.0-nvme-1",
        },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.updated, 1);

    const updated = await request.get("/api/discovery/nodes");
    const classified = updated.body.nodes.find((n) => n.serial === "7X4KPM3");
    assert.equal(classified.role, "control-plane");
    assert.equal(classified.hostname, "cp1.cluster.example.com");
    assert.ok(classified.classified_at);
  });

  it("rejects empty nodes array", async () => {
    const res = await request.post("/api/discovery/classify").send({ nodes: [] });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/discovery/generate", () => {
  it("creates a pending generation job", async () => {
    const res = await request.post("/api/discovery/generate").send({});
    assert.equal(res.status, 200);
    assert.ok(res.body.job_id);
    assert.equal(res.body.status, "pending");
  });
});

after(() => {
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
});
