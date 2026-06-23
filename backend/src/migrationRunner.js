// Copyright (c) 2025 Bill Strauss — MIT License
/**
 * Database migration runner.
 *
 * Adapted from openshift-airgap-architect (MIT) by Bill Strauss.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);
}

function getAppliedMigrations(db) {
  const rows = db.prepare("SELECT name FROM migrations ORDER BY id").all();
  return rows.map((row) => row.name);
}

function recordMigration(db, name) {
  db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
}

function removeMigrationRecord(db, name) {
  db.prepare("DELETE FROM migrations WHERE name = ?").run(name);
}

async function discoverMigrations() {
  const migrationsDir = path.join(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => ({ name: f, path: path.join(migrationsDir, f) }));
}

export async function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  const available = await discoverMigrations();
  const pending = available.filter((m) => !applied.includes(m.name));

  if (pending.length === 0) {
    logger.info({ tag: "migrations" }, "No pending migrations");
    return 0;
  }

  logger.info({ tag: "migrations", count: pending.length }, "Running pending migrations");
  let count = 0;

  for (const migration of pending) {
    try {
      const mod = await import(migration.path);
      if (typeof mod.up !== "function") throw new Error(`${migration.name} missing up()`);
      db.transaction(() => {
        mod.up(db);
        recordMigration(db, migration.name);
      })();
      logger.info({ tag: "migrations", migration: migration.name }, "Applied");
      count++;
    } catch (error) {
      logger.error({ tag: "migrations", migration: migration.name, err: error }, "Migration failed");
      throw new Error(`Migration ${migration.name} failed: ${error.message}`);
    }
  }

  logger.info({ tag: "migrations", count }, "All migrations applied");
  return count;
}

export async function rollbackMigration(db) {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  if (applied.length === 0) return null;

  const last = applied[applied.length - 1];
  const migrationPath = path.join(__dirname, "migrations", last);
  const mod = await import(migrationPath);
  if (typeof mod.down !== "function") throw new Error(`${last} missing down()`);
  db.transaction(() => {
    mod.down(db);
    removeMigrationRecord(db, last);
  })();
  return last;
}
