const SP_BOUNDS = { latMin: -25.36, latMax: -19.78, lngMin: -53.11, lngMax: -44.16 };
const TUPI_STATIONS_URL = "https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes=&fast=false&searchText=";
const TUPI_STATION_DETAIL_URL = (id) => `https://api.tupinambaenergia.com.br/station/${id}`;
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

async function runTick(env) {
  const spIds = await syncStationsAndSnapshots(env);
  await syncPricingBatch(env, spIds);
}

async function buildEletropostosPayload(env, windowKey) {
  const now = Date.now();
  const windowDays = WINDOW_DAYS[windowKey] ?? 30;
  const since = windowKey === "all" ? 0 : now - windowDays * 24 * 3600 * 1000;
  const windowHours = windowDays * 24;

  const [stationsRes, connectorsRes, latestRes, uptimeRes, pricingRes] = await Promise.all([
    env.DB.prepare(`SELECT station_id, name, network, lat, lng FROM stations`).all(),
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
    // apenas disponível/sem falha — disponível ocioso não gera receita.
    let estimatedRevenue = null;
    if (pricing && pricing.price_per_kwh && connectors.length) {
      let sum = 0;
      for (const c of connectors) {
        if (c.power && c.utilizationPctWindow !== null) {
          sum += c.utilizationPctWindow * windowHours * (c.power || 0) * pricing.price_per_kwh;
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

async function buildStationDetail(env, stationId) {
  const [stationRow, connectorsRes, pricingRow, timelineRes] = await Promise.all([
    env.DB.prepare(`SELECT station_id, name, network, lat, lng FROM stations WHERE station_id = ?`).bind(stationId).first(),
    env.DB.prepare(`SELECT connector_index, power, current FROM connector_meta WHERE station_id = ?`).bind(stationId).all(),
    env.DB.prepare(`SELECT price_per_kwh, idle_fee_enabled, idle_fee_value, currency, updated_at FROM station_pricing WHERE station_id = ?`)
      .bind(stationId)
      .first(),
    env.DB.prepare(
      `SELECT captured_at, SUM(CASE WHEN state = 'Charging' THEN 1 ELSE 0 END) AS charging, COUNT(*) AS total
       FROM status_snapshots WHERE station_id = ? AND captured_at > ? GROUP BY captured_at ORDER BY captured_at ASC`
    )
      .bind(stationId, Date.now() - 24 * 3600 * 1000)
      .all(),
  ]);

  if (!stationRow) return null;

  const totalConnectors = connectorsRes.results.length;
  const totalPowerKw = connectorsRes.results.reduce((acc, c) => acc + (c.power || 0), 0);

  const revenueByWindow = {};
  for (const key of Object.keys(WINDOW_DAYS)) {
    const days = WINDOW_DAYS[key];
    const since = key === "all" ? 0 : Date.now() - days * 24 * 3600 * 1000;
    const stats = await env.DB.prepare(
      `SELECT AVG(CASE WHEN state = 'Charging' THEN 1.0 ELSE 0.0 END) AS utilization_pct,
              AVG(CASE WHEN state IN ('Available','Charging','Preparing','Finishing','Reserved') THEN 1.0 ELSE 0.0 END) AS uptime_pct,
              COUNT(*) AS samples
       FROM status_snapshots WHERE station_id = ? AND captured_at > ?`
    )
      .bind(stationId, since)
      .first();
    const hours = days * 24;
    const enough = stats && stats.samples >= MIN_SAMPLES_FOR_ESTIMATE;
    let revenue = null;
    if (enough && pricingRow?.price_per_kwh && totalPowerKw) {
      revenue = Math.round(stats.utilization_pct * hours * totalPowerKw * pricingRow.price_per_kwh);
    }
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
    lat: stationRow.lat,
    lng: stationRow.lng,
    connectorCount: totalConnectors,
    totalPowerKw,
    pricePerKwh: pricingRow?.price_per_kwh ?? null,
    idleFeeValue: pricingRow?.idle_fee_enabled ? pricingRow.idle_fee_value : null,
    revenueByWindow,
    timeline24h: timelineRes.results.map((r) => ({ t: r.captured_at, charging: r.charging, total: r.total })),
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

export default {
  async fetch(request, env) {
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

    const lastSegment = url.pathname.split("/").pop() ?? "";
    const isStaticAsset = lastSegment.includes(".");

    if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && !isStaticAsset && !url.pathname.startsWith("/portal")) {
      url.pathname = url.pathname === "/" ? "/portal" : "/portal" + url.pathname;
      return env.ASSETS.fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env));
  },
};
