import { Router } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import logger, { generateErrorId } from "../logger.js";

const router = Router();

const CLUSTERS_BASE =
  process.env.CLUSTERS_BASE || "/var/lib/dcm-bootstrap/clusters";

const CLUSTER_NAME_RE = /^[\w-]+$/;

function clusterDir(name) {
  return path.join(CLUSTERS_BASE, name);
}

function triggerFile(name) {
  return path.join(CLUSTERS_BASE, `${name}.trigger`);
}

// POST /api/install
// Writes cluster-vars.yaml and the trigger file to start a dcm-bootstrap
// OCP install. The systemd dcm-install-dispatch.path unit on the bootstrap
// host detects the trigger file and fires dcm-run-install.sh.
//
// Body: { cluster_name: string, cluster_vars_yaml: string }
// Returns: { status: "triggered", cluster_name }
// 409 if an install is already running for this cluster.
router.post("/", (req, res) => {
  const { cluster_name, cluster_vars_yaml } = req.body;

  if (!cluster_name || typeof cluster_name !== "string" || !CLUSTER_NAME_RE.test(cluster_name)) {
    return res.status(400).json({
      error: "cluster_name is required and must contain only letters, digits, hyphens, or underscores",
    });
  }
  if (!cluster_vars_yaml || typeof cluster_vars_yaml !== "string") {
    return res.status(400).json({ error: "cluster_vars_yaml is required" });
  }

  try {
    const dir = clusterDir(cluster_name);
    mkdirSync(dir, { recursive: true });

    const statusFile = path.join(dir, "install.status");
    if (existsSync(statusFile)) {
      const current = readFileSync(statusFile, "utf8").trim();
      if (current === "running") {
        return res.status(409).json({
          error: `Install already running for cluster "${cluster_name}"`,
        });
      }
    }

    writeFileSync(path.join(dir, "cluster-vars.yaml"), cluster_vars_yaml, {
      mode: 0o640,
    });
    writeFileSync(triggerFile(cluster_name), "", { mode: 0o640 });

    logger.info({ cluster_name }, "OCP install triggered");
    return res.json({ status: "triggered", cluster_name });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId, cluster_name }, "Failed to trigger install");
    return res.status(500).json({ error: "Failed to trigger install", errorId });
  }
});

// GET /api/install/:name/status
// Returns the current install status for a cluster.
// { status: "not_started" | "running" | "succeeded" | "failed" }
router.get("/:name/status", (req, res) => {
  const { name } = req.params;
  const statusFile = path.join(clusterDir(name), "install.status");

  try {
    if (!existsSync(statusFile)) return res.json({ status: "not_started" });
    const status = readFileSync(statusFile, "utf8").trim();
    return res.json({ status });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId, name }, "Failed to read install status");
    return res.status(500).json({ error: "Failed to read status", errorId });
  }
});

// GET /api/install/:name/log
// Returns the last 200 lines of the install log.
// { lines: string[] }
router.get("/:name/log", (req, res) => {
  const { name } = req.params;
  const logFile = path.join(clusterDir(name), "install.log");

  try {
    if (!existsSync(logFile)) return res.json({ lines: [] });
    const content = readFileSync(logFile, "utf8");
    const lines = content.split("\n");
    return res.json({ lines: lines.slice(-200) });
  } catch (err) {
    const errorId = generateErrorId();
    logger.error({ err, errorId, name }, "Failed to read install log");
    return res.status(500).json({ error: "Failed to read log", errorId });
  }
});

export default router;
