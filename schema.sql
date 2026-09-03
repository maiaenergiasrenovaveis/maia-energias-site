DROP TABLE IF EXISTS status_snapshots;
DROP TABLE IF EXISTS connector_daily_stats;
DROP TABLE IF EXISTS station_pricing;
DROP TABLE IF EXISTS connector_meta;
DROP TABLE IF EXISTS stations;
DROP TABLE IF EXISTS sync_state;

CREATE TABLE stations (
  station_id TEXT PRIMARY KEY,
  name TEXT,
  network TEXT,
  lat REAL,
  lng REAL,
  source TEXT DEFAULT 'tupi',
  private INTEGER DEFAULT 0
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

-- Agregado diário por conector, alimentado incrementalmente a cada tick do cron.
-- Existe pra "uso/disponibilidade em 15d/30d/acumulado" não precisar reprocessar
-- milhões de linhas de status_snapshots a cada carregamento de página — sem isso,
-- essa consulta cresce (e fica mais lenta) pra sempre, junto com o histórico bruto.
-- Janelas curtas (24h/7d) continuam usando status_snapshots direto, que é pequeno.
CREATE TABLE connector_daily_stats (
  station_id TEXT NOT NULL,
  connector_index INTEGER NOT NULL,
  day INTEGER NOT NULL,
  samples INTEGER NOT NULL DEFAULT 0,
  ok_samples INTEGER NOT NULL DEFAULT 0,
  charging_samples INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, connector_index, day)
);
CREATE INDEX idx_daily_stats_day ON connector_daily_stats(day);

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
