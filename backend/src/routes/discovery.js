import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import logger, { generateErrorId } from "../logger.js";
import { sleep } from "../utils.js";

const router = Router();

const DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_INTERVAL_MS = 1_000;

// POST /api/discovery/report
// Receives a hardware manifest from a node running the live ISO.
// Idempotent: re-report from same serial resets drain state and updates manifest.
router.post("/report", (req, res) => {
  const { serial, ip } = req.body;

  if (!serial || !ip) {
    return res.status(400).json({ error: "serial and ip are required" });
  }

  const id = nanoid();
  const now = Date.now();
  const manifest_json = JSON.stringify(req.body);

  try {
    db.prepare(`
      INSERT INTO discovered_nodes (id, serial, ip, received_at, manifest_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(serial) DO UPDATE SET
        ip = excluded.ip,
        received_at = excluded.received_at,
        manifest_json = excluded.manifest_json,
        drained_at = NULL
    `).run(id, serial, ip, now, manifest_json);

    logger.info({ serial, ip }, "Node reported");
    return res.json({ status: "ok", id });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId, serial }, "Failed to store node report");
    return res.status(500).json({ error: "Failed to store report", errorId });
  }
});

// GET /api/discovery/drain
// Long-poll for Ansible drain.yml. Returns one undrained node or {"node":null} after timeout.
// Marks the node drained_at so subsequent polls skip it.
router.get("/drain", async (_req, res) => {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const row = db
      .prepare(
        `SELECT * FROM discovered_nodes
         WHERE drained_at IS NULL
         ORDER BY received_at ASC
         LIMIT 1`
      )
      .get();

    if (row) {
      db.prepare("UPDATE discovered_nodes SET drained_at = ? WHERE id = ?").run(Date.now(), row.id);
      return res.json({
        node: { ...row, manifest: JSON.parse(row.manifest_json) },
      });
    }

    await sleep(DRAIN_POLL_INTERVAL_MS);
  }

  return res.json({ node: null });
});

// GET /api/discovery/nodes
// Lists all discovered nodes with parsed manifests.
router.get("/nodes", (_req, res) => {
  try {
    const rows = db
      .prepare("SELECT * FROM discovered_nodes ORDER BY received_at ASC")
      .all();
    const nodes = rows.map((row) => ({
      ...row,
      manifest: JSON.parse(row.manifest_json),
      network_config: row.network_config_json ? JSON.parse(row.network_config_json) : null,
    }));
    return res.json({ nodes });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to list nodes");
    return res.status(500).json({ error: "Failed to list nodes", errorId });
  }
});

// PUT /api/discovery/nodes/:id/network-config
// Saves the NMState network config for a single node.
router.put("/nodes/:id/network-config", (req, res) => {
  const { id } = req.params;
  const networkConfig = req.body;

  try {
    const result = db
      .prepare("UPDATE discovered_nodes SET network_config_json = ? WHERE id = ?")
      .run(JSON.stringify(networkConfig), id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Node not found" });
    }
    return res.json({ status: "ok" });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId, id }, "Failed to save network config");
    return res.status(500).json({ error: "Failed to save network config", errorId });
  }
});

// POST /api/discovery/classify
// Assigns role, hostname, interface, and disk to one or more nodes.
// Body: { nodes: [{ id, role, hostname, interface_selected, disk_selected }] }
router.post("/classify", (req, res) => {
  const { nodes } = req.body;

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return res.status(400).json({ error: "nodes array required" });
  }

  const now = Date.now();
  let updated = 0;

  const stmt = db.prepare(`
    UPDATE discovered_nodes
    SET role = ?, hostname = ?, interface_selected = ?, disk_selected = ?, classified_at = ?
    WHERE id = ?
  `);

  try {
    db.transaction((rows) => {
      for (const { id, role, hostname, interface_selected, disk_selected } of rows) {
        const result = stmt.run(role ?? null, hostname ?? null, interface_selected ?? null, disk_selected ?? null, now, id);
        updated += result.changes;
      }
    })(nodes);

    logger.info({ updated }, "Nodes classified");
    return res.json({ status: "ok", updated });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to classify nodes");
    return res.status(500).json({ error: "Failed to classify nodes", errorId });
  }
});

// POST /api/discovery/reset
// Clears all classification data from every node, returning them to pending state.
router.post("/reset", (req, res) => {
  try {
    const result = db.prepare(`
      UPDATE discovered_nodes
      SET role = NULL, hostname = NULL, interface_selected = NULL,
          disk_selected = NULL, classified_at = NULL
    `).run();
    logger.info({ updated: result.changes }, "All classifications reset");
    return res.json({ status: "ok", updated: result.changes });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to reset classifications");
    return res.status(500).json({ error: "Failed to reset classifications", errorId });
  }
});

// POST /api/discovery/generate
// Creates a generation job. Actual install-config generation deferred to next phase.
router.post("/generate", (req, res) => {
  const jobId = nanoid();
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO jobs (id, type, status, progress, created_at, updated_at)
      VALUES (?, 'generate', 'pending', 0, ?, ?)
    `).run(jobId, now, now);

    logger.info({ jobId }, "Generate job created");
    return res.json({ job_id: jobId, status: "pending" });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to create generate job");
    return res.status(500).json({ error: "Failed to create job", errorId });
  }
});

export default router;
