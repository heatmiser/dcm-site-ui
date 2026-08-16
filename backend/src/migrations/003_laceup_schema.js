// SQLite cannot DROP NOT NULL via ALTER TABLE — recreate the table.
// Changes: ip TEXT NOT NULL → ip TEXT (nullable); add mac TEXT column.
export const up = (db) => {
  db.exec(`
    CREATE TABLE discovered_nodes_new (
      id TEXT PRIMARY KEY,
      serial TEXT UNIQUE NOT NULL,
      mac TEXT,
      ip TEXT,
      received_at INTEGER NOT NULL,
      drained_at INTEGER,
      classified_at INTEGER,
      role TEXT,
      hostname TEXT,
      interface_selected TEXT,
      disk_selected TEXT,
      manifest_json TEXT NOT NULL,
      network_config_json TEXT
    )
  `);

  db.exec(`
    INSERT INTO discovered_nodes_new
      (id, serial, mac, ip, received_at, drained_at, classified_at, role, hostname,
       interface_selected, disk_selected, manifest_json, network_config_json)
    SELECT
      id, serial, NULL, ip, received_at, drained_at, classified_at, role, hostname,
      interface_selected, disk_selected, manifest_json, network_config_json
    FROM discovered_nodes
  `);

  db.exec(`DROP TABLE discovered_nodes`);
  db.exec(`ALTER TABLE discovered_nodes_new RENAME TO discovered_nodes`);
};

export const down = (db) => {
  db.exec(`
    CREATE TABLE discovered_nodes_old (
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
      manifest_json TEXT NOT NULL,
      network_config_json TEXT
    )
  `);

  db.exec(`
    INSERT INTO discovered_nodes_old
      (id, serial, ip, received_at, drained_at, classified_at, role, hostname,
       interface_selected, disk_selected, manifest_json, network_config_json)
    SELECT
      id, serial, COALESCE(ip, ''), received_at, drained_at, classified_at, role, hostname,
      interface_selected, disk_selected, manifest_json, network_config_json
    FROM discovered_nodes
  `);

  db.exec(`DROP TABLE discovered_nodes`);
  db.exec(`ALTER TABLE discovered_nodes_old RENAME TO discovered_nodes`);
};
