export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_nodes (
      id TEXT PRIMARY KEY,
      serial TEXT UNIQUE NOT NULL,
      ip TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      drained_at INTEGER,
      classified_at INTEGER,
      role TEXT,
      hostname TEXT,
      interface_selected TEXT,
      disk_selected TEXT,
      manifest_json TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      output TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
};

export const down = (db) => {
  db.exec(`DROP TABLE IF EXISTS jobs`);
  db.exec(`DROP TABLE IF EXISTS discovered_nodes`);
};
