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

  for (const s of sp) {
    stationStmts.push(
      env.DB.prepare(
        `INSERT INTO stations (station_id, name, network, lat, lng) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(station_id) DO UPDATE SET name=excluded.name, network=excluded.network, lat=excluded.lat, lng=excluded.lng`
      ).bind(s._id, s.name || "", s.iconPack || "outra", s.lat, s.lng)
    );
    const connectors = s.connectedPlugs || [];
    connectors.forEach((c, idx) => {
      connectorStmts.push(
        env.DB.prepare(
          `INSERT INTO connector_meta (station_id, connector_index, power, current) VALUES (?, ?, ?, ?)
           ON CONFLICT(station_id, connector_index) DO UPDATE SET power=excluded.power, current=excluded.current`
        ).bind(s._id, idx, c.power ?? null, c.current ?? null)
      );
      snapshotStmts.push(
        env.DB.prepare(`INSERT INTO status_snapshots (station_id, connector_index, state, captured_at) VALUES (?, ?, ?, ?)`).bind(
          s._id,
          idx,
          c.stateName || "Desconhecido",
          now
        )
      );
    });
  }

  await runBatches(env.DB, stationStmts);
  await runBatches(env.DB, connectorStmts);
  await runBatches(env.DB, snapshotStmts);

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
      snapshotStmts.push(
        env.DB.prepare(`INSERT INTO status_snapshots (station_id, connector_index, state, captured_at) VALUES (?, ?, ?, ?)`).bind(
          stationId,
          idx,
          normalizeCcStatus(c.status),
          now
        )
      );
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

async function buildEletropostosPayload(env, windowKey) {
  const now = Date.now();
  const windowDays = WINDOW_DAYS[windowKey] ?? 30;
  const since = windowKey === "all" ? 0 : now - windowDays * 24 * 3600 * 1000;
  const windowHours = windowDays * 24;

  const [stationsRes, connectorsRes, latestRes, uptimeRes, pricingRes] = await Promise.all([
    env.DB.prepare(`SELECT station_id, name, network, lat, lng, source FROM stations`).all(),
    env.DB.prepare(`SELECT station_id, connector_index, power, current FROM connector_meta`).all(),
    env.DB.prepare(
      `SELECT ss.station_id, ss.connector_index, ss.state
       FROM status_snapshots ss
       INNER JOIN (
         SELECT station_id, connector_index, MAX(captured_at) AS max_captured
         FROM status_snapshots GROUP BY station_id, connector_index
       ) latest ON ss.station_id = latest.station_id AND ss.connector_index = latest.connector_index AND ss.captured_at = latest.max_captured`
    ).all(),
    env.DB.prepare(
      `SELECT station_id, connector_index,
         AVG(CASE WHEN state IN ('Available','Charging','Preparing','Finishing','Reserved') THEN 1.0 ELSE 0.0 END) AS uptime_pct,
         AVG(CASE WHEN state = 'Charging' THEN 1.0 ELSE 0.0 END) AS utilization_pct,
         COUNT(*) AS samples
       FROM status_snapshots WHERE captured_at > ? GROUP BY station_id, connector_index`
    ).bind(since).all(),
    env.DB.prepare(`SELECT station_id, price_per_kwh, idle_fee_enabled, idle_fee_value, currency, updated_at FROM station_pricing`).all(),
  ]);

  const connectorsByStation = new Map();
  for (const c of connectorsRes.results) {
    if (!connectorsByStation.has(c.station_id)) connectorsByStation.set(c.station_id, new Map());
    connectorsByStation.get(c.station_id).set(c.connector_index, c);
  }
  const latestByKey = new Map();
  for (const l of latestRes.results) latestByKey.set(l.station_id + ":" + l.connector_index, l.state);
  const statsByKey = new Map();
  for (const u of uptimeRes.results)
    statsByKey.set(u.station_id + ":" + u.connector_index, { pct: u.uptime_pct, utilization: u.utilization_pct, samples: u.samples });
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
    env.DB.prepare(`SELECT station_id, name, network, lat, lng, source FROM stations WHERE station_id = ?`).bind(stationId).first(),
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
    const perConn = await env.DB.prepare(
      `SELECT connector_index,
              AVG(CASE WHEN state = 'Charging' THEN 1.0 ELSE 0.0 END) AS utilization_pct,
              AVG(CASE WHEN state IN ('Available','Charging','Preparing','Finishing','Reserved') THEN 1.0 ELSE 0.0 END) AS uptime_pct,
              COUNT(*) AS samples
       FROM status_snapshots WHERE station_id = ? AND captured_at > ? GROUP BY connector_index`
    )
      .bind(stationId, since)
      .all();
    const rows = perConn.results.filter((r) => r.samples >= MIN_SAMPLES_FOR_ESTIMATE);
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
      samples: perConn.results.reduce((a, r) => a + r.samples, 0),
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

async function handleEletropostosSP(request, env) {
  const url = new URL(request.url);
  const windowKey = WINDOW_DAYS[url.searchParams.get("window")] ? url.searchParams.get("window") : "30d";
  const payload = await buildEletropostosPayload(env, windowKey);
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
}

async function handleStationDetail(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response(JSON.stringify({ error: "missing_id" }), { status: 400, headers: { "content-type": "application/json" } });
  const detail = await buildStationDetail(env, id);
  if (!detail) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify(detail), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
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

const SECURITY_HEADERS_BASE = {
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function withSecurityHeaders(response, hostname) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS_BASE)) {
    headers.set(key, value);
  }
  headers.set("Content-Security-Policy", hostname === "portal.maiaenergiasrenovaveis.com.br" ? CSP_PORTAL : CSP_SITE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleFetch(request, env) {
  const url = new URL(request.url);

  if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && url.pathname === "/portal/api/eletropostos-sp") {
    try {
      return await handleEletropostosSP(request, env);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }

  if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && url.pathname === "/portal/api/eletropostos-sp/estacao") {
    try {
      return await handleStationDetail(request, env);
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
  async fetch(request, env) {
    const response = await handleFetch(request, env);
    return withSecurityHeaders(response, new URL(request.url).hostname);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env));
  },
};
