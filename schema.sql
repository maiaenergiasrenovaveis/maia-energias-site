DROP TABLE IF EXISTS status_snapshots;
DROP TABLE IF EXISTS station_pricing;
DROP TABLE IF EXISTS connector_meta;
DROP TABLE IF EXISTS stations;
DROP TABLE IF EXISTS sync_state;

CREATE TABLE stations (
  station_id TEXT PRIMARY KEY,
  name TEXT,
  network TEXT,
  lat REAL,
  lng REAL
);

CREATE TABLE connector_meta (
  station_id TEXT NOT NULL,
  connector_index INTEGER NOT NULL,
  power REAL,
  current TEXT,
  PRIMARY KEY (station_id, connector_index)
);

CREATE TABLE status_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL,
  connector_index INTEGER NOT NULL,
  state TEXT,
  captured_at INTEGER NOT NULL
);
CREATE INDEX idx_snapshots_station_time ON status_snapshots(station_id, connector_index, captured_at);
CREATE INDEX idx_snapshots_time ON status_snapshots(captured_at);

CREATE TABLE station_pricing (
  station_id TEXT PRIMARY KEY,
  price_per_kwh REAL,
  idle_fee_enabled INTEGER,
  idle_fee_value REAL,
  currency TEXT,
  updated_at INTEGER
);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
