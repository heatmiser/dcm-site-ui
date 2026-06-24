import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";
import logger, { generateErrorId } from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const OCP_VERSIONS_PATH = path.join(__dirname, "../../data/ocp-versions.json");

const BOOTSTRAP_CONFIG_PATH =
  process.env.BOOTSTRAP_CONFIG_PATH ||
  "/var/lib/dcm-site-ui/data/dcm-site-ui-bootstrap.json";

// GET /api/bootstrap-config
// Returns pre-populated cluster values from the first-boot renderer.
// Returns {} when the file is absent (dev environment).
router.get("/bootstrap-config", (_req, res) => {
  try {
    if (!existsSync(BOOTSTRAP_CONFIG_PATH)) return res.json({});
    const data = JSON.parse(readFileSync(BOOTSTRAP_CONFIG_PATH, "utf8"));
    return res.json(data);
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to read bootstrap config");
    return res.status(500).json({ error: "Failed to read bootstrap config", errorId });
  }
});

// GET /api/ocp-versions
// Returns available OCP versions for the version selector.
router.get("/ocp-versions", (_req, res) => {
  try {
    if (!existsSync(OCP_VERSIONS_PATH)) return res.json({ default: "", versions: [] });
    const data = JSON.parse(readFileSync(OCP_VERSIONS_PATH, "utf8"));
    return res.json(data);
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to read ocp-versions");
    return res.status(500).json({ error: "Failed to read ocp-versions", errorId });
  }
});

// GET /api/cluster-config
// Returns all cluster config key/value pairs as a flat object.
router.get("/cluster-config", (_req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM cluster_config").all();
    const config = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return res.json(config);
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to read cluster config");
    return res.status(500).json({ error: "Failed to read cluster config", errorId });
  }
});

// PUT /api/cluster-config
// Upserts all key/value pairs from the request body.
// Body: { cluster_name: "...", base_domain: "...", ... }
router.put("/cluster-config", (req, res) => {
  const entries = Object.entries(req.body);
  if (entries.length === 0) return res.status(400).json({ error: "Empty body" });

  try {
    const stmt = db.prepare(
      "INSERT INTO cluster_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    db.transaction(() => {
      for (const [key, value] of entries) {
        stmt.run(key, value === null || value === undefined ? null : String(value));
      }
    })();
    logger.info({ count: entries.length }, "Cluster config saved");
    return res.json({ status: "ok", updated: entries.length });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId }, "Failed to save cluster config");
    return res.status(500).json({ error: "Failed to save cluster config", errorId });
  }
});

export default router;
