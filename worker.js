const SP_BOUNDS = { latMin: -25.36, latMax: -19.78, lngMin: -53.11, lngMax: -44.16 };
const TUPI_STATIONS_URL = "https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes=&fast=false&searchText=";
const TUPI_STATION_DETAIL_URL = (id) => `https://api.tupinambaenergia.com.br/station/${id}`;
const CLUBECHARGER_STATIONS_URL = "https://clubecharger.com/api/map/stations";
const GOELECTRIC_PAGE_URL = "https://www.goelectric-emobility.com/eletropostos/";
const AC_CONNECTOR_TYPES = new Set(["Type 2", "Type 1", "Tipo 2", "Tipo 1"]);
const OPERATIONAL_STATES = new Set(["Available", "Charging", "Preparing", "Finishing", "Reserved"]);
const IN_USE_STATES = new Set(["Charging"]);
const PRICE_BATCH_SIZE = 20;
const FETCH_HEADERS = { "User-Agent": "MaiaEnergiasRenovaveis-Portal/1.0 (contato@maiaenergiasrenovaveis.com.br)" };

// Pontos de referência aproximados para agrupar estações por região dentro de SP
// (heurística de "vizinho mais próximo" — não são limites administrativos reais)
const SP_REGIONS = [
  { code: "rmsp", name: "Região Metropolitana de SP", lat: -23.55, lng: -46.63 },
  { code: "campinas", name: "Campinas e Região", lat: -22.9, lng: -47.06 },
  { code: "vale-paraiba", name: "Vale do Paraíba", lat: -23.18, lng: -45.88 },
  { code: "litoral", name: "Litoral", lat: -23.96, lng: -46.33 },
  { code: "sorocaba", name: "Sorocaba e Região", lat: -23.5, lng: -47.45 },
  { code: "interior", name: "Interior", lat: -21.17, lng: -47.81 },
];

const WINDOW_DAYS = { "24h": 1, "7d": 7, "15d": 15, "30d": 30, all: 30 };
// Abaixo disso, a média de utilização é ruído estatístico (ex.: 1 leitura em
// "Charging" vira "100% de uso") — não mostramos % nem receita até ter esse mínimo.
const MIN_SAMPLES_FOR_ESTIMATE = 12;
// Carregadores DC comerciais reais não passam disso hoje (~360kW é o teto do mercado).
// Valores acima são erro de cadastro na própria Tupi (ex.: vários postos com
// exatamente "480" em todos os conectores — claramente um placeholder/bug deles,
// não potência real) — sinalizados na UI, mas não entram mais na conta de receita
// (ver ENERGY_PER_HOUR_KWH abaixo).
const MAX_PLAUSIBLE_POWER_KW = 400;
// Nenhum carro sustenta a potência nominal do carregador por uma hora inteira (a
// curva de carga cai bastante depois de ~80% de bateria) — por isso a receita usa
// um consumo médio fixo por hora de uso, independente da potência do carregador,
// igual à metodologia do Zeus Eletrik (referência usada para este portal).
const ENERGY_PER_HOUR_KWH = 40;

// Janelas 15d/30d/acumulado usam o agregado diário (connector_daily_stats) em vez de
// somar status_snapshots bruto — reprocessar meses de leitura a cada carregamento de
// página não escala (chegou a levar ~20s com o histórico atual). 24h/7d continuam lendo
// direto do bruto, que é pequeno o bastante pra não precisar da tabela agregada.
const RAW_SCAN_WINDOWS = new Set(["24h", "7d"]);
const DAY_MS = 24 * 3600 * 1000;
function dayBucket(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

// Upsert incremental do agregado diário — chamado uma vez por conector a cada tick,
// junto com o INSERT em status_snapshots, pra manter connector_daily_stats sempre
// em dia sem precisar reprocessar nada depois.
function rollupStmt(env, stationId, connectorIndex, state, capturedAt) {
  const ok = OPERATIONAL_STATES.has(state) ? 1 : 0;
  const charging = state === "Charging" ? 1 : 0;
  return env.DB.prepare(
    `INSERT INTO connector_daily_stats (station_id, connector_index, day, samples, ok_samples, charging_samples) VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(station_id, connector_index, day) DO UPDATE SET
       samples = samples + 1,
       ok_samples = ok_samples + excluded.ok_samples,
       charging_samples = charging_samples + excluded.charging_samples`
  ).bind(stationId, connectorIndex, dayBucket(capturedAt), ok, charging);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runBatches(db, statements) {
  for (const part of chunk(statements, 50)) {
    if (part.length) await db.batch(part);
  }
}

function regionFor(lat, lng) {
  let best = SP_REGIONS[0];
  let bestDist = Infinity;
  for (const r of SP_REGIONS) {
    const d = (lat - r.lat) ** 2 + (lng - r.lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}

async function syncStationsAndSnapshots(env) {
  const res = await fetch(TUPI_STATIONS_URL, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error("tupi_list_unavailable_" + res.status);
  const all = await res.json();
  const sp = all.filter(
    (s) =>
      typeof s.lat === "number" &&
      typeof s.lng === "number" &&
      s.lat >= SP_BOUNDS.latMin &&
      s.lat <= SP_BOUNDS.latMax &&
      s.lng >= SP_BOUNDS.lngMin &&
      s.lng <= SP_BOUNDS.lngMax &&
      s._id
  );

  const now = Date.now();
  const stationStmts = [];
  const connectorStmts = [];
  const snapshotStmts = [];
  const rollupStmts = [];

  for (const s of sp) {
    stationStmts.push(
      env.DB.prepare(
        `INSERT INTO stations (station_id, name, network, lat, lng, private) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(station_id) DO UPDATE SET name=excluded.name, network=excluded.network, lat=excluded.lat, lng=excluded.lng, private=excluded.private`
      ).bind(s._id, s.name || "", s.iconPack || "outra", s.lat, s.lng, s.private ? 1 : 0)
    );
    const connectors = s.connectedPlugs || [];
    connectors.forEach((c, idx) => {
      connectorStmts.push(
        env.DB.prepare(
          `INSERT INTO connector_meta (station_id, connector_index, power, current) VALUES (?, ?, ?, ?)
           ON CONFLICT(station_id, connector_index) DO UPDATE SET power=excluded.power, current=excluded.current`
        ).bind(s._id, idx, c.power ?? null, c.current ?? null)
      );
      const state = c.stateName || "Desconhecido";
      snapshotStmts.push(
        env.DB.prepare(`INSERT INTO status_snapshots (station_id, connector_index, state, captured_at) VALUES (?, ?, ?, ?)`).bind(
          s._id,
          idx,
          state,
          now
        )
      );
      rollupStmts.push(rollupStmt(env, s._id, idx, state, now));
    });
  }

  await runBatches(env.DB, stationStmts);
  await runBatches(env.DB, connectorStmts);
  await runBatches(env.DB, snapshotStmts);
  await runBatches(env.DB, rollupStmts);

  // Prune snapshots older than 30 days to keep the table bounded
  await env.DB.prepare(`DELETE FROM status_snapshots WHERE captured_at < ?`).bind(now - 30 * 24 * 3600 * 1000).run();

  return sp.map((s) => s._id);
}

async function syncPricingBatch(env, spStationIds) {
  if (spStationIds.length === 0) return;
  const cursorRow = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'price_cursor'`).first();
  const sortedIds = [...spStationIds].sort();
  let startIdx = 0;
  if (cursorRow?.value) {
    const idx = sortedIds.indexOf(cursorRow.value);
    startIdx = idx >= 0 ? (idx + 1) % sortedIds.length : 0;
  }
  const batchIds = [];
  for (let i = 0; i < Math.min(PRICE_BATCH_SIZE, sortedIds.length); i++) {
    batchIds.push(sortedIds[(startIdx + i) % sortedIds.length]);
  }

  const results = await Promise.all(
    batchIds.map(async (id) => {
      try {
        const res = await fetch(TUPI_STATION_DETAIL_URL(id), { headers: FETCH_HEADERS });
        if (!res.ok) return null;
        const detail = await res.json();
        return { id, detail };
      } catch {
        return null;
      }
    })
  );

  const now = Date.now();
  const stmts = [];
  for (const r of results) {
    if (!r) continue;
    const pc = r.detail.paymentCharge || {};
    const idle = r.detail.idleFee || {};
    stmts.push(
      env.DB.prepare(
        `INSERT INTO station_pricing (station_id, price_per_kwh, idle_fee_enabled, idle_fee_value, currency, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(station_id) DO UPDATE SET price_per_kwh=excluded.price_per_kwh, idle_fee_enabled=excluded.idle_fee_enabled, idle_fee_value=excluded.idle_fee_value, currency=excluded.currency, updated_at=excluded.updated_at`
      ).bind(
        r.id,
        pc.enabled && pc.method === "kWh" ? (pc.value || 0) / 100 : null,
        idle.enabled ? 1 : 0,
        idle.enabled ? (idle.value || 0) / 100 : null,
        r.detail.currency || "BRL",
        now
      )
    );
  }
  await runBatches(env.DB, stmts);

  if (batchIds.length) {
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('price_cursor', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(batchIds[batchIds.length - 1]).run();
  }
}

function parseBRNumber(str) {
  if (!str) return null;
  const match = String(str).replace(/\./g, "").match(/-?\d+,\d+|-?\d+/);
  if (!match) return null;
  return parseFloat(match[0].replace(",", "."));
}

const CC_STATUS_MAP = { offline: "Unavailable", faulted: "Faulted", unavailable: "Unavailable", finishing: "Finishing", reserved: "Reserved", suspendedev: "SuspendedEV" };
function normalizeCcStatus(raw) {
  if (!raw) return "Desconhecido";
  const lower = String(raw).toLowerCase();
  if (CC_STATUS_MAP[lower]) return CC_STATUS_MAP[lower];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ClubeCharger: só os postos "linked" (vinculados à plataforma deles, com status ao
// vivo) — os "community" (cadastro aberto por qualquer um) não têm telemetria real,
// então ficam de fora. Diferente da Tupi, o preço já vem no mesmo payload da lista.
async function syncClubeCharger(env) {
  const res = await fetch(CLUBECHARGER_STATIONS_URL, { headers: FETCH_HEADERS });
  if (!res.ok) return;
  const data = await res.json();
  const stations = (data.map_payload && data.map_payload.stations) || [];
  const sp = stations.filter(
    (s) =>
      s.kind === "linked" &&
      typeof s.latitude === "number" &&
      typeof s.longitude === "number" &&
      s.latitude >= SP_BOUNDS.latMin &&
      s.latitude <= SP_BOUNDS.latMax &&
      s.longitude >= SP_BOUNDS.lngMin &&
      s.longitude <= SP_BOUNDS.lngMax
  );

  const now = Date.now();
  const stationStmts = [];
  const connectorStmts = [];
  const snapshotStmts = [];
  const rollupStmts = [];
  const pricingStmts = [];

  for (const s of sp) {
    const stationId = "cc_" + s.id;
    stationStmts.push(
      env.DB.prepare(
        `INSERT INTO stations (station_id, name, network, lat, lng, source) VALUES (?, ?, ?, ?, ?, 'clubecharger')
         ON CONFLICT(station_id) DO UPDATE SET name=excluded.name, network=excluded.network, lat=excluded.lat, lng=excluded.lng, source='clubecharger'`
      ).bind(stationId, s.name || "", s.operator_display_name || "ClubeCharger", s.latitude, s.longitude)
    );

    const connectors = s.connector_slots || [];
    connectors.forEach((c, idx) => {
      const power = parseBRNumber(c.power_label);
      const current = AC_CONNECTOR_TYPES.has(c.type) ? "AC" : "DC";
      connectorStmts.push(
        env.DB.prepare(
          `INSERT INTO connector_meta (station_id, connector_index, power, current) VALUES (?, ?, ?, ?)
           ON CONFLICT(station_id, connector_index) DO UPDATE SET power=excluded.power, current=excluded.current`
        ).bind(stationId, idx, power, current)
      );
      const state = normalizeCcStatus(c.status);
      snapshotStmts.push(
        env.DB.prepare(`INSERT INTO status_snapshots (station_id, connector_index, state, captured_at) VALUES (?, ?, ?, ?)`).bind(
          stationId,
          idx,
          state,
          now
        )
      );
      rollupStmts.push(rollupStmt(env, stationId, idx, state, now));
    });

    const price = parseBRNumber(s.pricing && s.pricing.active_price_label);
    if (price !== null) {
      pricingStmts.push(
        env.DB.prepare(
          `INSERT INTO station_pricing (station_id, price_per_kwh, idle_fee_enabled, idle_fee_value, currency, updated_at) VALUES (?, ?, 0, NULL, 'BRL', ?)
           ON CONFLICT(station_id) DO UPDATE SET price_per_kwh=excluded.price_per_kwh, currency=excluded.currency, updated_at=excluded.updated_at`
        ).bind(stationId, price, now)
      );
    }
  }

  await runBatches(env.DB, stationStmts);
  await runBatches(env.DB, connectorStmts);
  await runBatches(env.DB, snapshotStmts);
  await runBatches(env.DB, rollupStmts);
  await runBatches(env.DB, pricingStmts);
}

function parseGoElectricConnectors(inlineStr) {
  if (!inlineStr) return [];
  const segments = inlineStr.split("+").map((s) => s.trim());
  const connectors = [];
  for (const seg of segments) {
    const m = seg.match(/^(\d+)\s*[×x]\s*(.+?)\s+(\d+(?:[.,]\d+)?)\s*kW$/i);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    const type = m[2].trim();
    const power = parseFloat(m[3].replace(",", "."));
    for (let i = 0; i < count; i++) connectors.push({ type, power });
  }
  return connectors;
}

// GO Electric: lista embutida direto no HTML da página deles (window.GE_STATIONS),
// sem endpoint de API separado. Dado é estático (sem status ao vivo nem preço) — só
// cria estação + conectores, sem status_snapshots, para não fingir monitoramento que
// não existe. A UI já trata isso como "sem dado de conector" naturalmente.
async function syncGoElectric(env) {
  const res = await fetch(GOELECTRIC_PAGE_URL, { headers: FETCH_HEADERS });
  if (!res.ok) return;
  const html = await res.text();
  const match = html.match(/window\.GE_STATIONS\s*=\s*(\[.*?\]);/s);
  if (!match) return;
  let stations;
  try {
    stations = JSON.parse(match[1]);
  } catch {
    return;
  }
  const spAll = stations.filter((s) => s.state === "SP" && typeof s.lat === "number" && typeof s.lng === "number");

  // Não duplica postos que já existem via outra fonte (mesmo local físico, ~300m).
  const existing = await env.DB.prepare(`SELECT lat, lng FROM stations WHERE source != 'goelectric'`).all();
  const DEDUPE_DEGREES = 0.003; // ~300m
  const isDuplicate = (lat, lng) => existing.results.some((e) => Math.abs(e.lat - lat) < DEDUPE_DEGREES && Math.abs(e.lng - lng) < DEDUPE_DEGREES);
  const sp = spAll.filter((s) => !isDuplicate(s.lat, s.lng));

  const stationStmts = [];
  const connectorStmts = [];
  for (const s of sp) {
    const stationId = "ge_" + s.slug;
    stationStmts.push(
      env.DB.prepare(
        `INSERT INTO stations (station_id, name, network, lat, lng, source) VALUES (?, ?, ?, ?, ?, 'goelectric')
         ON CONFLICT(station_id) DO UPDATE SET name=excluded.name, network=excluded.network, lat=excluded.lat, lng=excluded.lng, source='goelectric'`
      ).bind(stationId, s.name || "", "GO Electric", s.lat, s.lng)
    );
    const connectors = parseGoElectricConnectors(s.connectors_inline);
    connectors.forEach((c, idx) => {
      const current = AC_CONNECTOR_TYPES.has(c.type) ? "AC" : "DC";
      connectorStmts.push(
        env.DB.prepare(
          `INSERT INTO connector_meta (station_id, connector_index, power, current) VALUES (?, ?, ?, ?)
           ON CONFLICT(station_id, connector_index) DO UPDATE SET power=excluded.power, current=excluded.current`
        ).bind(stationId, idx, c.power, current)
      );
    });
  }

  await runBatches(env.DB, stationStmts);
  await runBatches(env.DB, connectorStmts);
}

async function runTick(env) {
  const spIds = await syncStationsAndSnapshots(env);
  await syncPricingBatch(env, spIds);
  await syncClubeCharger(env);
  await syncGoElectric(env);
}

// Uso/disponibilidade por conector numa janela — lê status_snapshots bruto pras janelas
// curtas (24h/7d, poucas linhas) e o agregado connector_daily_stats pras longas
// (15d/30d/acumulado), que senão viram uma varredura de milhões de linhas a cada
// carregamento de página (ver RAW_SCAN_WINDOWS).
async function getUptimeStats(env, windowKey, sinceMs) {
  const statsByKey = new Map();
  const res = RAW_SCAN_WINDOWS.has(windowKey)
    ? await env.DB.prepare(
        `SELECT station_id, connector_index,
           AVG(CASE WHEN state IN ('Available','Charging','Preparing','Finishing','Reserved') THEN 1.0 ELSE 0.0 END) AS uptime_pct,
           AVG(CASE WHEN state = 'Charging' THEN 1.0 ELSE 0.0 END) AS utilization_pct,
           COUNT(*) AS samples
         FROM status_snapshots WHERE captured_at > ? GROUP BY station_id, connector_index`
      ).bind(sinceMs).all()
    : await env.DB.prepare(
        `SELECT station_id, connector_index,
           SUM(ok_samples) * 1.0 / SUM(samples) AS uptime_pct,
           SUM(charging_samples) * 1.0 / SUM(samples) AS utilization_pct,
           SUM(samples) AS samples
         FROM connector_daily_stats WHERE day >= ? GROUP BY station_id, connector_index`
      ).bind(dayBucket(sinceMs)).all();
  for (const u of res.results)
    statsByKey.set(u.station_id + ":" + u.connector_index, { pct: u.uptime_pct, utilization: u.utilization_pct, samples: u.samples });
  return statsByKey;
}

// Mesma ideia que getUptimeStats, mas escopado a uma estação só (usado no modal de
// detalhe, que já tinha essa lógica por conector separada da lista).
async function getStationConnectorStats(env, stationId, windowKey, sinceMs) {
  const res = RAW_SCAN_WINDOWS.has(windowKey)
    ? await env.DB.prepare(
        `SELECT connector_index,
                AVG(CASE WHEN state = 'Charging' THEN 1.0 ELSE 0.0 END) AS utilization_pct,
                AVG(CASE WHEN state IN ('Available','Charging','Preparing','Finishing','Reserved') THEN 1.0 ELSE 0.0 END) AS uptime_pct,
                COUNT(*) AS samples
         FROM status_snapshots WHERE station_id = ? AND captured_at > ? GROUP BY connector_index`
      ).bind(stationId, sinceMs).all()
    : await env.DB.prepare(
        `SELECT connector_index,
                SUM(charging_samples) * 1.0 / SUM(samples) AS utilization_pct,
                SUM(ok_samples) * 1.0 / SUM(samples) AS uptime_pct,
                SUM(samples) AS samples
         FROM connector_daily_stats WHERE station_id = ? AND day >= ? GROUP BY connector_index`
      ).bind(stationId, dayBucket(sinceMs)).all();
  return res.results;
}

async function buildEletropostosPayload(env, windowKey) {
  const now = Date.now();
  const windowDays = WINDOW_DAYS[windowKey] ?? 30;
  const since = windowKey === "all" ? 0 : now - windowDays * 24 * 3600 * 1000;
  const windowHours = windowDays * 24;

  const [stationsRes, connectorsRes, latestRes, statsByKey, pricingRes] = await Promise.all([
    env.DB.prepare(`SELECT station_id, name, network, lat, lng, source, private FROM stations`).all(),
    env.DB.prepare(`SELECT station_id, connector_index, power, current FROM connector_meta`).all(),
    env.DB.prepare(
      `SELECT ss.station_id, ss.connector_index, ss.state
       FROM status_snapshots ss
       INNER JOIN (
         SELECT station_id, connector_index, MAX(captured_at) AS max_captured
         FROM status_snapshots WHERE captured_at > ? GROUP BY station_id, connector_index
       ) latest ON ss.station_id = latest.station_id AND ss.connector_index = latest.connector_index AND ss.captured_at = latest.max_captured`
    ).bind(now - 3 * DAY_MS).all(),
    getUptimeStats(env, windowKey, since),
    env.DB.prepare(`SELECT station_id, price_per_kwh, idle_fee_enabled, idle_fee_value, currency, updated_at FROM station_pricing`).all(),
  ]);

  const connectorsByStation = new Map();
  for (const c of connectorsRes.results) {
    if (!connectorsByStation.has(c.station_id)) connectorsByStation.set(c.station_id, new Map());
    connectorsByStation.get(c.station_id).set(c.connector_index, c);
  }
  const latestByKey = new Map();
  for (const l of latestRes.results) latestByKey.set(l.station_id + ":" + l.connector_index, l.state);
  const pricingByStation = new Map();
  for (const p of pricingRes.results) pricingByStation.set(p.station_id, p);

  const stations = stationsRes.results.map((s) => {
    const connMap = connectorsByStation.get(s.station_id) || new Map();
    const connectors = [...connMap.values()].map((c) => {
      const key = s.station_id + ":" + c.connector_index;
      const latest = latestByKey.get(key);
      const stats = statsByKey.get(key);
      const enough = stats && stats.samples >= MIN_SAMPLES_FOR_ESTIMATE;
      return {
        power: c.power,
        powerSuspicious: !!(c.power && c.power > MAX_PLAUSIBLE_POWER_KW),
        current: c.current,
        state: latest || null,
        inUseNow: latest ? IN_USE_STATES.has(latest) : null,
        samples: stats?.samples ?? 0,
        uptimePctWindow: enough ? Math.round(stats.pct * 1000) / 1000 : null,
        utilizationPctWindow: enough ? Math.round(stats.utilization * 1000) / 1000 : null,
      };
    });
    const pricing = pricingByStation.get(s.station_id) || null;
    const region = regionFor(s.lat, s.lng);

    // Receita estimada usa % de tempo REALMENTE carregando ("Charging"), não % de tempo
    // apenas disponível/sem falha — disponível ocioso não gera receita. O consumo por
    // hora de uso é o menor entre ENERGY_PER_HOUR_KWH (teto realista de recarga DC) e a
    // potência nominal do conector — um AC de 22kW fisicamente não entrega 40kWh/h.
    let estimatedRevenue = null;
    if (pricing && pricing.price_per_kwh && connectors.length) {
      let sum = 0;
      for (const c of connectors) {
        if (c.utilizationPctWindow !== null) {
          const energyPerHour = c.power ? Math.min(ENERGY_PER_HOUR_KWH, c.power) : ENERGY_PER_HOUR_KWH;
          sum += c.utilizationPctWindow * windowHours * energyPerHour * pricing.price_per_kwh;
        }
      }
      estimatedRevenue = sum > 0 ? Math.round(sum) : null;
    }

    return {
      id: s.station_id,
      name: s.name,
      network: s.network,
      lat: s.lat,
      lng: s.lng,
      regionCode: region.code,
      regionName: region.name,
      source: s.source || "tupi",
      private: !!s.private,
      connectors,
      pricePerKwh: pricing?.price_per_kwh ?? null,
      idleFeeValue: pricing?.idle_fee_enabled ? pricing.idle_fee_value : null,
      estimatedRevenue,
      pricingUpdatedAt: pricing?.updated_at ? new Date(pricing.updated_at).toISOString() : null,
    };
  });

  const priceCoverage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM station_pricing`).first();

  return {
    updatedAt: new Date().toISOString(),
    source: "Tupi (api.tupinambaenergia.com.br) — dados públicos do mapa de eletropostos",
    window: windowKey,
    windowHours,
    count: stations.length,
    priceCoverage: priceCoverage?.n ?? 0,
    regions: SP_REGIONS.map((r) => ({ code: r.code, name: r.name })),
    stations,
  };
}

async function buildTimeline(env, stationId, sinceMs, bucketMs) {
  const res = await env.DB.prepare(
    `SELECT captured_at, SUM(CASE WHEN state = 'Charging' THEN 1 ELSE 0 END) AS charging, COUNT(*) AS total
     FROM status_snapshots WHERE station_id = ? AND captured_at > ? GROUP BY captured_at ORDER BY captured_at ASC`
  )
    .bind(stationId, sinceMs)
    .all();
  const points = res.results.map((r) => ({ t: r.captured_at, charging: r.charging, total: r.total }));
  if (!bucketMs) return points;

  // Agrupamento em JS (não em SQL) — divisão inteira do SQLite com parâmetros bound
  // como REAL não trunca como esperado, o que fazia cada tick virar seu próprio "bucket".
  const buckets = new Map();
  for (const p of points) {
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, { sumCharging: 0, sumTotal: 0, n: 0 });
    const b = buckets.get(key);
    b.sumCharging += p.charging;
    b.sumTotal += p.total;
    b.n += 1;
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, charging: Math.round((b.sumCharging / b.n) * 10) / 10, total: Math.round(b.sumTotal / b.n) }));
}

const TIMELINE_BUCKET_MS = { "24h": 0, "7d": 3600 * 1000, "15d": 24 * 3600 * 1000, "30d": 24 * 3600 * 1000, all: 24 * 3600 * 1000 };

async function buildStationDetail(env, stationId) {
  const [stationRow, connectorsRes, pricingRow] = await Promise.all([
    env.DB.prepare(`SELECT station_id, name, network, lat, lng, source, private FROM stations WHERE station_id = ?`).bind(stationId).first(),
    env.DB.prepare(`SELECT connector_index, power, current FROM connector_meta WHERE station_id = ?`).bind(stationId).all(),
    env.DB.prepare(`SELECT price_per_kwh, idle_fee_enabled, idle_fee_value, currency, updated_at FROM station_pricing WHERE station_id = ?`)
      .bind(stationId)
      .first(),
  ]);

  if (!stationRow) return null;

  const totalConnectors = connectorsRes.results.length;
  const hasSuspiciousPower = connectorsRes.results.some((c) => c.power && c.power > MAX_PLAUSIBLE_POWER_KW);
  const totalPowerKw = connectorsRes.results.reduce((acc, c) => acc + (c.power && c.power <= MAX_PLAUSIBLE_POWER_KW ? c.power : 0), 0);

  const revenueByWindow = {};
  const timelineByWindow = {};
  for (const key of Object.keys(WINDOW_DAYS)) {
    const days = WINDOW_DAYS[key];
    const since = key === "all" ? 0 : Date.now() - days * 24 * 3600 * 1000;
    const hours = days * 24;
    timelineByWindow[key] = await buildTimeline(env, stationId, since, TIMELINE_BUCKET_MS[key]);
    // Por conector, não agregado — cada conector tem seu próprio teto de potência
    // (um AC de 22kW não entrega 40kWh/h só porque a média inclui um DC de 150kW).
    const perConnResults = await getStationConnectorStats(env, stationId, key, since);
    const rows = perConnResults.filter((r) => r.samples >= MIN_SAMPLES_FOR_ESTIMATE);
    const enough = rows.length > 0;

    let revenue = null;
    if (enough && pricingRow?.price_per_kwh) {
      let sum = 0;
      for (const r of rows) {
        const meta = connectorsRes.results.find((c) => c.connector_index === r.connector_index);
        const power = meta?.power;
        const energyPerHour = power ? Math.min(ENERGY_PER_HOUR_KWH, power) : ENERGY_PER_HOUR_KWH;
        sum += r.utilization_pct * hours * energyPerHour * pricingRow.price_per_kwh;
      }
      revenue = sum > 0 ? Math.round(sum) : null;
    }
    const stats = {
      utilization_pct: enough ? rows.reduce((a, r) => a + r.utilization_pct, 0) / rows.length : null,
      uptime_pct: enough ? rows.reduce((a, r) => a + r.uptime_pct, 0) / rows.length : null,
      samples: perConnResults.reduce((a, r) => a + r.samples, 0),
    };
    revenueByWindow[key] = {
      revenue,
      utilizationPct: enough ? stats.utilization_pct : null,
      uptimePct: enough ? stats.uptime_pct : null,
      samples: stats?.samples ?? 0,
    };
  }

  return {
    id: stationRow.station_id,
    name: stationRow.name,
    network: stationRow.network,
    source: stationRow.source || "tupi",
    private: !!stationRow.private,
    lat: stationRow.lat,
    lng: stationRow.lng,
    connectorCount: totalConnectors,
    totalPowerKw,
    hasSuspiciousPower,
    pricePerKwh: pricingRow?.price_per_kwh ?? null,
    idleFeeValue: pricingRow?.idle_fee_enabled ? pricingRow.idle_fee_value : null,
    revenueByWindow,
    timelineByWindow,
  };
}

// Cache de borda (por colo) pras respostas da API do portal — segunda camada de defesa
// além do agregado diário: mesmo com a query rápida, sem isso cada visita recalcula o
// payload do zero. Chave = URL completa (inclui window=/id=, então cada variação tem
// sua própria entrada). Só cacheia resposta 200.
async function withEdgeCache(request, ctx, buildResponse, cacheVersion = "") {
  const cache = caches.default;
  const keyUrl = new URL(request.url);
  if (cacheVersion) keyUrl.searchParams.set("__v", cacheVersion);
  const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const response = await buildResponse();
  if (response.status === 200) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleEletropostosSP(request, env, ctx) {
  return withEdgeCache(request, ctx, async () => {
    const url = new URL(request.url);
    const windowKey = WINDOW_DAYS[url.searchParams.get("window")] ? url.searchParams.get("window") : "30d";
    const payload = await buildEletropostosPayload(env, windowKey);
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
  });
}

async function handleStationDetail(request, env, ctx) {
  return withEdgeCache(request, ctx, async () => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "missing_id" }), { status: 400, headers: { "content-type": "application/json" } });
    const detail = await buildStationDetail(env, id);
    if (!detail) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(detail), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
  });
}

// Geocodificação de ruas/estabelecimentos via Nominatim (OpenStreetMap), usada como
// complemento quando a busca não encontra nenhum posto pelo nome. Proxied pelo Worker
// para poder mandar um User-Agent identificável (exigido pela politica de uso deles)
// e não precisar liberar dominio externo na CSP do navegador.
async function handleGeocode(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });

  const viewbox = `${SP_BOUNDS.lngMin},${SP_BOUNDS.latMax},${SP_BOUNDS.lngMax},${SP_BOUNDS.latMin}`;
  const nominatimUrl =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=br&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
  const res = await fetch(nominatimUrl, { headers: { "User-Agent": FETCH_HEADERS["User-Agent"] } });
  if (!res.ok) return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
  const data = await res.json();
  const results = data.map((r) => ({ label: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }));
  return new Response(JSON.stringify({ results }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
}

// Headers de seguranca aplicados a toda resposta do Worker. O portal (subdominio
// portal.*) e uma ferramenta interna que depende de scripts inline e de CDNs
// (Leaflet, Chart.js) e por isso usa uma CSP mais permissiva — o site
// institucional publico mantem a CSP estrita original.
const CSP_SITE = [
  "default-src 'self'",
  "script-src 'self' https://www.instagram.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.cdninstagram.com https://*.fbcdn.net",
  "frame-src https://www.youtube.com https://www.instagram.com",
  "connect-src 'self' https://www.instagram.com",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const CSP_PORTAL = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// /interno/* (simulador de eficiência) precisa de scripts de CDN (Chart.js, jsPDF)
// que a CSP estrita do site público bloquearia.
const CSP_INTERNO = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  // worker-src pro worker do pdf.js (renderização de PDF de conta de energia no navegador,
  // client-side, antes de enviar como imagem pro scan da OpenAI) — cai em script-src sem isso
  // em navegadores mais novos, mas alguns exigem a diretiva explícita.
  "worker-src 'self' https://cdn.jsdelivr.net blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS_BASE = {
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function withSecurityHeaders(response, hostname, pathname) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS_BASE)) {
    headers.set(key, value);
  }
  const csp = hostname === "portal.maiaenergiasrenovaveis.com.br" ? CSP_PORTAL : pathname.startsWith("/interno") ? CSP_INTERNO : CSP_SITE;
  headers.set("Content-Security-Policy", csp);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Autenticação HTTP Basic para /interno/* (ferramentas internas — simulador de
// eficiência). Ao contrário do gate client-side do /portal (só sessionStorage,
// não é segurança de verdade), isso é validado na borda pelo Worker: sem as
// credenciais certas, o conteúdo nem chega a ser servido. Falha fechado — se os
// secrets INTERNO_USER/INTERNO_PASSWORD não estiverem configurados, bloqueia tudo.
function checkBasicAuth(request, env) {
  const expectedUser = env.INTERNO_USER;
  const expectedPassword = env.INTERNO_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = atob(auth.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  return user === expectedUser && password === expectedPassword;
}

function requireBasicAuth() {
  return new Response("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Maia Interno", charset="UTF-8"' },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const MESES_ORDEM_NASA = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Irradiação solar mensal (índice de sol pleno, kWh/m².dia) via NASA POWER — climatologia
// de 20 anos por ponto (lat/long), sem necessidade de chave de API. O CRESESB (SunData)
// não expõe uma API pública utilizável por automação; NASA POWER é a alternativa aberta
// mais usada pra esse mesmo tipo de dado solarimétrico. Cache de 1 ano: é climatologia
// histórica, não muda de um dia pro outro.
async function handleIrradiacaoApi(request) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lng = parseFloat(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse({ error: "lat/lng inválidos" }, 400);
  }
  const nasaUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lng}&latitude=${lat}&format=JSON`;
  const res = await fetch(nasaUrl, { headers: { "User-Agent": FETCH_HEADERS["User-Agent"] } });
  if (!res.ok) return jsonResponse({ error: "falha ao consultar NASA POWER" }, 502);
  const data = await res.json();
  const porMes = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN;
  if (!porMes) return jsonResponse({ error: "resposta inesperada da NASA POWER" }, 502);
  const mensal = MESES_ORDEM_NASA.map((m) => porMes[m]);
  return new Response(JSON.stringify({ mensal, fonte: "NASA POWER (climatologia 2001-2020)" }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable" },
  });
}

const ANEEL_RESOURCE_ID = "fcf2906c-7c32-4b9b-a637-054e7a5234f4"; // tarifas-homologadas-distribuidoras-energia-eletrica.csv
const ANEEL_API = "https://dadosabertos.aneel.gov.br/api/3/action";

// Converte "1.912,96" / "294,98" (formato BR) pra número.
function parseNumeroBr(s) {
  if (s == null) return 0;
  return parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0;
}

// Lista de distribuidoras (SigAgente) pro seletor — cache de 7 dias, muda raramente.
async function handleAneelDistribuidoras() {
  const url = `${ANEEL_API}/datastore_search?resource_id=${ANEEL_RESOURCE_ID}&fields=SigAgente&distinct=true&limit=300`;
  const res = await fetch(url);
  if (!res.ok) return jsonResponse({ error: "falha ao consultar ANEEL" }, 502);
  const data = await res.json();
  const distribuidoras = (data?.result?.records ?? []).map((r) => r.SigAgente).filter(Boolean).sort();
  return new Response(JSON.stringify({ distribuidoras }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=604800" },
  });
}

// Tarifas homologadas (TE+TUSD) de uma distribuidora/subgrupo/modalidade, direto da base
// aberta da ANEEL. DscDetalhe="Não se aplica" filtra fora tarifas especiais (SCEE = geração
// distribuída/compensação, APE = autoprodução) que apareceriam misturadas com a tarifa normal
// se não fosse esse filtro. Pega a vigência mais recente disponível. Cache curto (1 dia): a
// ANEEL atualiza a base semanalmente e reajustes tarifários entram em vigor a qualquer momento.
async function handleAneelTarifas(request) {
  const url = new URL(request.url);
  const distribuidora = url.searchParams.get("distribuidora");
  const subgrupo = url.searchParams.get("subgrupo");
  const modalidade = url.searchParams.get("modalidade");
  if (!distribuidora || !subgrupo || !modalidade) {
    return jsonResponse({ error: "informe distribuidora, subgrupo e modalidade" }, 400);
  }

  const filters = JSON.stringify({
    SigAgente: distribuidora,
    DscSubGrupo: subgrupo,
    DscModalidadeTarifaria: modalidade,
    DscBaseTarifaria: "Tarifa de Aplicação",
    DscDetalhe: "Não se aplica",
  });
  const aneelUrl =
    `${ANEEL_API}/datastore_search?resource_id=${ANEEL_RESOURCE_ID}&filters=${encodeURIComponent(filters)}` +
    `&sort=${encodeURIComponent("DatInicioVigencia desc")}&limit=10`;
  const res = await fetch(aneelUrl);
  if (!res.ok) return jsonResponse({ error: "falha ao consultar ANEEL" }, 502);
  const data = await res.json();
  const registros = data?.result?.records ?? [];
  if (!registros.length) return jsonResponse({ error: "nenhuma tarifa encontrada para essa combinação" }, 404);

  // Registros já vêm ordenados pela vigência mais recente primeiro — pega só as linhas
  // dessa vigência (as demais são histórico).
  const vigenciaMaisRecente = registros[0].DatInicioVigencia;
  const atuais = registros.filter((r) => r.DatInicioVigencia === vigenciaMaisRecente);

  const linhaDemanda = atuais.find((r) => r.DscUnidadeTerciaria === "kW");
  const linhaPonta = atuais.find((r) => r.NomPostoTarifario === "Ponta");
  const linhaForaPonta = atuais.find((r) => r.NomPostoTarifario === "Fora ponta") ?? atuais.find((r) => r.NomPostoTarifario === "Não se aplica" && r.DscUnidadeTerciaria === "MWh");

  if (!linhaForaPonta) return jsonResponse({ error: "não encontrei a tarifa de energia para essa combinação" }, 404);

  // Valores vêm em R$/MWh — divide por 1000 pra virar R$/kWh.
  const tarifaForaPonta = (parseNumeroBr(linhaForaPonta.VlrTE) + parseNumeroBr(linhaForaPonta.VlrTUSD)) / 1000;
  const tarifaPonta = linhaPonta ? (parseNumeroBr(linhaPonta.VlrTE) + parseNumeroBr(linhaPonta.VlrTUSD)) / 1000 : tarifaForaPonta;
  const tarifaDemanda = linhaDemanda ? parseNumeroBr(linhaDemanda.VlrTUSD) : null;
  // Só o componente TUSD (sem TE) da fora ponta — é o que continua devido à distribuidora
  // quando o cliente migra pro Mercado Livre (só a energia/TE é negociada livremente lá).
  const tarifaTusd = parseNumeroBr(linhaForaPonta.VlrTUSD) / 1000;

  return new Response(
    JSON.stringify({
      tarifaPonta,
      tarifaForaPonta,
      tarifaDemanda,
      tarifaTusd,
      vigenciaInicio: vigenciaMaisRecente,
      vigenciaFim: atuais[0].DatFimVigencia,
      fonte: `ANEEL — ${distribuidora} (${subgrupo}/${modalidade})`,
    }),
    // max-age curto: essa resposta ainda está mudando de formato enquanto o simulador evolui,
    // e o front-end já busca com cache:"no-store" — este header é só pra quem chamar o endpoint
    // sem esse cuidado (ex: curl), pra não herdar uma resposta com formato antigo por muito tempo.
    { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } }
  );
}

// Escaneia uma foto/print da conta de energia para extrair o histórico de consumo mensal e
// alguns dados do cliente, evitando digitação manual.
// Sem cache: cada conta é um documento pessoal do cliente, não um dado de referência público
// como os de irradiação/ANEEL acima — nunca deve ficar guardada na borda da Cloudflare.
const PROMPT_SCAN_CONTA = `Você extrai dados estruturados de contas de energia elétrica brasileiras (Enel, CPFL, Light, Cemig, Copel, Celesc etc), de clientes do Grupo B (baixa tensão, tarifa única por kWh, sem demanda contratada). Pode receber mais de uma imagem — são páginas da mesma conta (o "Histórico de consumo" e a tabela de tributos às vezes ficam na 1ª página, às vezes no verso) — procure os dados em todas elas. Retorne APENAS um JSON (sem markdown, sem texto extra) no formato:
{
  "cliente": string ou null (o NOME DA EMPRESA OU PESSOA titular da unidade consumidora — geralmente a primeira linha em destaque no bloco de identificação do cliente, muitas vezes com "LTDA", "ME", "EIRELI" ou similar. NÃO é o nome do bairro, rua ou cidade que aparece na linha de endereço logo abaixo — cuidado pra não confundir os dois),
  "cidade": string ou null (cidade do endereço de fornecimento, sem UF),
  "uf": string ou null (sigla de 2 letras),
  "distribuidora": string ou null,
  "tipo_rede": "Monofásica" | "Bifásica" | "Trifásica" | null (pela tensão/ligação informada na conta, se houver),
  "historico_consumo": array de objetos { "mes": "JAN"|"FEV"|"MAR"|"ABR"|"MAI"|"JUN"|"JUL"|"AGO"|"SET"|"OUT"|"NOV"|"DEZ", "kwh": number }, um por mês da tabela/gráfico "Consumo" ou "Histórico de consumo" (geralmente os últimos 12 meses). FORMATO NUMÉRICO BRASILEIRO — leia com cuidado: a tabela escreve valores como "12.800,000" — o PONTO é separador de milhar e ",000" é a parte decimal (sempre zero, sem significado). Isso significa DOZE MIL E OITOCENTOS, e deve virar o número 12800 no JSON — nunca 12.8 nem 12800.000. Outro exemplo: "1.059" na conta = 1059 no JSON, não 1.059.,
  "te_com_imposto": number ou null (tarifa de energia/TE em R$/kWh, valor unitário já com impostos, como cobrado na fatura — geralmente na linha "Energia Elétrica" ou "Consumo"),
  "tusd_com_imposto": number ou null (tarifa TUSD em R$/kWh, valor unitário já com impostos — linha "Energia Elétrica TUSD" ou similar; se a conta só mostrar um valor único de energia sem separar TE/TUSD, deixe os dois null),
  "icms_percent": number ou null (alíquota de ICMS em %, geralmente na seção de tributos/impostos da conta),
  "pis_cofins_percent": number ou null (soma das alíquotas de PIS + COFINS em %, se mostradas separadamente some as duas),
  "iluminacao_publica": number ou null (valor em R$ da Contribuição de Iluminação Pública/COSIP, cobrada à parte)
}
Se um campo não estiver visível ou você não tiver certeza, use null (para historico_consumo, use um array vazio). Não invente valores. IMPORTANTE: sua resposta inteira deve ser SOMENTE o objeto JSON — comece direto com "{" e termine com "}". Não escreva nenhuma frase de introdução, explicação, análise ou comentário antes ou depois do JSON.`;

// GPT-4o-mini via um relay hospedado na Vercel (projeto separado: maia-scan-proxy), não mais
// direto da Cloudflare nem via Workers AI. Motivo: uma sessão inteira de diagnóstico (chave sem
// espaço, retry, timeout, User-Agent de navegador, AI Gateway da própria Cloudflare, hospedar a
// imagem numa URL em vez de embutir) confirmou que TODO tráfego deste Worker pra api.openai.com
// era bloqueado antes de chegar lá (0 requisições no dashboard de uso da OpenAI, até pra chamadas
// de texto puro) — provavelmente as faixas de IP de saída da Cloudflare Workers bloqueadas pela
// OpenAI. O Workers AI (modelo Llama 3.2 11B, rodando dentro da rede da Cloudflare) contornava o
// bloqueio mas não tinha precisão suficiente pra ler uma tabela tarifária densa. A Vercel roda em
// outra rede — sem esse bloqueio — e o relay lá só injeta a chave da OpenAI (que fica só nas env
// vars da Vercel) e repassa; o prompt e toda a lógica de negócio continuam aqui.
const VERCEL_RELAY_URL = "https://maia-scan-proxy.vercel.app/api/scan-conta";

async function handleScanConta(request, env) {
  if (!env.RELAY_SECRET) return jsonResponse({ error: "Leitura automática não configurada (falta RELAY_SECRET)." }, 500);

  const body = await request.json().catch(() => null);
  const imagens = Array.isArray(body?.images) ? body.images : [];
  if (!imagens.length) return jsonResponse({ error: "envie ao menos uma imagem em images" }, 400);
  if (imagens.length > 3) return jsonResponse({ error: "no máximo 3 páginas/imagens por vez" }, 400);
  for (const img of imagens) {
    if (!img?.base64 || !/^image\/(png|jpe?g|webp)$/.test(img.mimeType ?? "")) {
      return jsonResponse({ error: "cada imagem precisa de base64 e mimeType (PNG, JPG ou WEBP)" }, 400);
    }
    // ~5.5MB em base64 ≈ 4MB de imagem original — o front-end já redimensiona antes de enviar,
    // isso aqui é só uma trava de segurança contra payloads fora do esperado.
    if (img.base64.length > 5.5 * 1024 * 1024) return jsonResponse({ error: "imagem muito grande (máx. ~4MB por página)" }, 400);
  }

  let texto;
  try {
    const res = await fetch(VERCEL_RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-secret": env.RELAY_SECRET },
      body: JSON.stringify({ images: imagens, prompt: PROMPT_SCAN_CONTA }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("scan-conta: relay respondeu com erro", { status: res.status, corpo: data });
      return jsonResponse({ error: `falha no relay (${res.status}): ${data?.error ?? "erro desconhecido"}` }, 502);
    }
    texto = data?.content;
  } catch (err) {
    return jsonResponse({ error: `falha ao chamar o relay: ${String(err)}` }, 502);
  }

  if (!texto) return jsonResponse({ error: "resposta vazia do modelo" }, 502);

  // GPT-4o-mini com response_format:json_object quase sempre devolve só JSON, mas mantém a
  // mesma extração robusta (em vez de confiar 100% nisso) por segurança.
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  const trechoJson = inicio >= 0 && fim > inicio ? texto.slice(inicio, fim + 1) : texto;

  let extraido;
  try {
    extraido = JSON.parse(trechoJson);
  } catch {
    console.error("scan-conta: resposta do modelo não é JSON válido", { texto: texto.slice(0, 800) });
    return jsonResponse({ error: "não consegui interpretar a resposta do modelo de visão — tente novamente" }, 502);
  }

  // Rede de segurança pro erro de formatação BR (ponto de milhar lido como decimal): consumo em
  // kWh de conta residencial/comercial é sempre um número inteiro de leitura de medidor — nunca
  // fracionário. Qualquer casa decimal aqui quase certamente é "1.059" (mil e cinquenta e nove)
  // sendo devolvido como 1.059 (um vírgula zero cinco nove) em vez de 1059.
  if (Array.isArray(extraido?.historico_consumo)) {
    extraido.historico_consumo = extraido.historico_consumo.map((h) => (h && !Number.isInteger(h.kwh) && Number.isFinite(h.kwh) ? { ...h, kwh: Math.round(h.kwh * 1000) } : h));
  }

  return jsonResponse(extraido);
}

// API de simulações salvas (/interno/api/simulacoes) — banco D1 dedicado
// (maia-simulador-db), separado do banco do portal de eletropostos para não
// misturar dados dos dois projetos. Já protegida pelo Basic Auth de /interno/*.
async function handleSimulacoesApi(request, env) {
  const url = new URL(request.url);
  const db = env.SIMULADOR_DB;
  const idMatch = url.pathname.match(/^\/interno\/api\/simulacoes\/(\d+)$/);

  if (request.method === "GET" && idMatch) {
    const row = await db.prepare("SELECT * FROM simulacoes WHERE id = ?").bind(Number(idMatch[1])).first();
    if (!row) return jsonResponse({ error: "not_found" }, 404);
    return jsonResponse({ ...row, dados: JSON.parse(row.dados) });
  }

  if (request.method === "DELETE" && idMatch) {
    await db.prepare("DELETE FROM simulacoes WHERE id = ?").bind(Number(idMatch[1])).run();
    return jsonResponse({ ok: true });
  }

  if (request.method === "GET" && url.pathname === "/interno/api/simulacoes") {
    const tipo = url.searchParams.get("tipo");
    const query = tipo
      ? db.prepare("SELECT id, tipo, cliente, criado_em, atualizado_em FROM simulacoes WHERE tipo = ? ORDER BY criado_em DESC LIMIT 200").bind(tipo)
      : db.prepare("SELECT id, tipo, cliente, criado_em, atualizado_em FROM simulacoes ORDER BY criado_em DESC LIMIT 200");
    const { results } = await query.all();
    return jsonResponse({ results });
  }

  if (request.method === "POST" && url.pathname === "/interno/api/simulacoes") {
    const body = await request.json().catch(() => null);
    if (!body || !body.tipo || !body.dados) return jsonResponse({ error: "invalid_body" }, 400);
    const now = Date.now();
    const result = await db
      .prepare("INSERT INTO simulacoes (tipo, cliente, criado_em, atualizado_em, dados) VALUES (?, ?, ?, ?, ?)")
      .bind(body.tipo, body.cliente || null, now, now, JSON.stringify(body.dados))
      .run();
    return jsonResponse({ id: result.meta.last_row_id }, 201);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/interno" || url.pathname.startsWith("/interno/")) {
    if (!checkBasicAuth(request, env)) return requireBasicAuth();
  }

  if (url.pathname === "/interno/api/simulacoes" || /^\/interno\/api\/simulacoes\/\d+$/.test(url.pathname)) {
    try {
      return await handleSimulacoesApi(request, env);
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  if (url.pathname === "/interno/api/scan-conta" && request.method === "POST") {
    try {
      return await handleScanConta(request, env);
    } catch (err) {
      return jsonResponse({ error: String(err) }, 500);
    }
  }

  if (url.pathname === "/interno/api/irradiacao") {
    return withEdgeCache(request, ctx, async () => {
      try {
        return await handleIrradiacaoApi(request);
      } catch (err) {
        return jsonResponse({ error: String(err) }, 500);
      }
    });
  }

  if (url.pathname === "/interno/api/aneel-distribuidoras") {
    return withEdgeCache(request, ctx, async () => {
      try {
        return await handleAneelDistribuidoras();
      } catch (err) {
        return jsonResponse({ error: String(err) }, 500);
      }
    });
  }

  if (url.pathname === "/interno/api/aneel-tarifas") {
    // cacheVersion "2": bump sempre que o formato da resposta mudar (ex: campo novo como
    // tarifaTusd), pra não continuar servindo do cache de borda uma resposta com o formato antigo.
    return withEdgeCache(
      request,
      ctx,
      async () => {
        try {
          return await handleAneelTarifas(request);
        } catch (err) {
          return jsonResponse({ error: String(err) }, 500);
        }
      },
      "3"
    );
  }

  if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && url.pathname === "/portal/api/eletropostos-sp") {
    try {
      return await handleEletropostosSP(request, env, ctx);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }

  if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && url.pathname === "/portal/api/eletropostos-sp/estacao") {
    try {
      return await handleStationDetail(request, env, ctx);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }


  if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && url.pathname === "/portal/api/geocode") {
    try {
      return await handleGeocode(request, env);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }

  const lastSegment = url.pathname.split("/").pop() ?? "";
  const isStaticAsset = lastSegment.includes(".");

  if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && !isStaticAsset && !url.pathname.startsWith("/portal")) {
    url.pathname = url.pathname === "/" ? "/portal" : "/portal" + url.pathname;
    return env.ASSETS.fetch(new Request(url, request));
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const response = await handleFetch(request, env, ctx);
    const url = new URL(request.url);
    return withSecurityHeaders(response, url.hostname, url.pathname);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env));
  },
};
