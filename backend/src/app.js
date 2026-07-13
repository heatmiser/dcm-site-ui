import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import logger, { generateErrorId } from "./logger.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { getMetrics, getMetricsContentType } from "./metrics.js";
import discoveryRouter from "./routes/discovery.js";
import clusterRouter from "./routes/cluster.js";
import installRouter from "./routes/install.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDevelopment = process.env.NODE_ENV !== "production";

let version = "unknown";
try {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  version = pkg.version;
} catch { /* ignore */ }

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(loggingMiddleware);
app.use(metricsMiddleware);

// Health endpoint — queried by listener.yml to detect dcm-site-ui vs FastAPI fallback.
// Must return { service: "dcm-site-ui" } for detection to work.
app.get("/healthz", (_req, res) => {
  res.json({ service: "dcm-site-ui", status: "ok", version });
});

app.get("/api/metrics", async (_req, res) => {
  res.set("Content-Type", getMetricsContentType());
  res.end(await getMetrics());
});

app.use("/api/discovery", discoveryRouter);
app.use("/api/install", installRouter);
app.use("/api", clusterRouter);

if (!isDevelopment) {
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  const errorId = generateErrorId();
  logger.error({ err, errorId }, "Unhandled error");
  res.status(500).json({ error: "Internal server error", errorId });
});

export default app;
