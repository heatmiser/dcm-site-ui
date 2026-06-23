import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrationRunner.js";
import logger from "./logger.js";

const dataDir = process.env.DATA_DIR || "/var/lib/dcm-site-ui/data";
const dbPath = path.join(dataDir, "dcm-site-ui.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

try {
  await runMigrations(db);
} catch (error) {
  logger.error({ err: error }, "Database migration failed");
  throw error;
}

export { db, dataDir };
