export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cluster_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.exec(`
    ALTER TABLE discovered_nodes ADD COLUMN network_config_json TEXT
  `);
};

export const down = (db) => {
  db.exec(`DROP TABLE IF EXISTS cluster_config`);
};
