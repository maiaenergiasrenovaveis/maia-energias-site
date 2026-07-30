const SP_BOUNDS = { latMin: -25.36, latMax: -19.78, lngMin: -53.11, lngMax: -44.16 };
const TUPI_STATIONS_URL = "https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes=&fast=false&searchText=";
const TUPI_STATION_DETAIL_URL = (id) => `https://api.tupinambaenergia.com.br/station/${id}`;
const OPERATIONAL_STATES = new Set(["Available", "Charging", "Preparing", "Finishing", "Reserved"]);
const IN_USE_STATES = new Set(["Charging"]);
const PRICE_BATCH_SIZE = 20;
const UPTIME_WINDOW_MS = 24 * 3600 * 1000;
const FETCH_HEADERS = { "User-Agent": "MaiaEnergiasRenovaveis-Portal/1.0 (contato@maiaenergiasrenovaveis.com.br)" };

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

async function buildEletropostosPayload(env) {
  const now = Date.now();
  const since = now - UPTIME_WINDOW_MS;

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
  const uptimeByKey = new Map();
  for (const u of uptimeRes.results)
    uptimeByKey.set(u.station_id + ":" + u.connector_index, { pct: u.uptime_pct, utilization: u.utilization_pct, samples: u.samples });
  const pricingByStation = new Map();
  for (const p of pricingRes.results) pricingByStation.set(p.station_id, p);

  const stations = stationsRes.results.map((s) => {
    const connMap = connectorsByStation.get(s.station_id) || new Map();
    const connectors = [...connMap.values()].map((c) => {
      const key = s.station_id + ":" + c.connector_index;
      const latest = latestByKey.get(key);
      const uptime = uptimeByKey.get(key);
      return {
        power: c.power,
        current: c.current,
        state: latest || null,
        inUseNow: latest ? IN_USE_STATES.has(latest) : null,
        uptimePct24h: uptime ? Math.round(uptime.pct * 1000) / 1000 : null,
        utilizationPct24h: uptime ? Math.round(uptime.utilization * 1000) / 1000 : null,
      };
    });
    const pricing = pricingByStation.get(s.station_id) || null;

    // Receita estimada usa % de tempo REALMENTE carregando ("Charging"), não % de tempo
    // apenas disponível/sem falha — disponível ocioso não gera receita.
    let estimatedRevenue30d = null;
    if (pricing && pricing.price_per_kwh && connectors.length) {
      let sum = 0;
      for (const c of connectors) {
        if (c.power && c.utilizationPct24h !== null) {
          sum += c.utilizationPct24h * 24 * (c.power || 0) * pricing.price_per_kwh * 30;
        }
      }
      estimatedRevenue30d = sum > 0 ? Math.round(sum) : null;
    }

    return {
      id: s.station_id,
      name: s.name,
      network: s.network,
      lat: s.lat,
      lng: s.lng,
      connectors,
      pricePerKwh: pricing?.price_per_kwh ?? null,
      idleFeeValue: pricing?.idle_fee_enabled ? pricing.idle_fee_value : null,
      estimatedRevenue30d,
      pricingUpdatedAt: pricing?.updated_at ? new Date(pricing.updated_at).toISOString() : null,
    };
  });

  const priceCoverage = await env.DB.prepare(`SELECT COUNT(*) AS n FROM station_pricing`).first();

  return {
    updatedAt: new Date().toISOString(),
    source: "Tupi (api.tupinambaenergia.com.br) — dados públicos do mapa de eletropostos",
    count: stations.length,
    priceCoverage: priceCoverage?.n ?? 0,
    stations,
  };
}

async function handleEletropostosSP(request, env) {
  const payload = await buildEletropostosPayload(env);
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
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
