// Gera o SQL de importação do Open Charge Map (snapshot estático, sem status ao vivo) para SP.
//
// Uso:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/openchargemap/ocm-export.git ocm
//   (cd ocm && git sparse-checkout set data/BR)
//   curl -o ocm_ref.json https://raw.githubusercontent.com/openchargemap/ocm-export/master/data/referencedata.json
//   curl -o ours.json "https://portal.maiaenergiasrenovaveis.com.br/portal/api/eletropostos-sp?window=24h"
//   node scripts/build-ocm-seed.mjs ocm/data/BR ocm_ref.json ours.json ocm-seed.sql
//   npx wrangler d1 execute maia-eletropostos-db --remote --file=ocm-seed.sql
//
// Licença: dados de "Open Charge Map Contributors" são CC BY 4.0 (exige atribuição);
// Easy Volt e YellotMob são CC0. A atribuição fica na seção de metodologia do Monitor.
import fs from "node:fs";
import path from "node:path";

const [dir, refPath, oursPath, outPath] = process.argv.slice(2);
if (!dir || !refPath || !oursPath || !outPath) {
  console.error("uso: node build-ocm-seed.mjs <data/BR> <referencedata.json> <ours.json> <saida.sql>");
  process.exit(1);
}

const B = { latMin: -25.36, latMax: -19.78, lngMin: -53.11, lngMax: -44.16 };
const DEDUPE_DEGREES = 0.003; // ~300m, igual ao GO Electric

const ref = JSON.parse(fs.readFileSync(refPath, "utf8"));
const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.ID, x]));
const usage = byId(ref.UsageTypes);
const status = byId(ref.StatusTypes);
const conn = byId(ref.ConnectionTypes);
const cur = byId(ref.CurrentTypes);
const ops = byId(ref.Operators);

const ours = JSON.parse(fs.readFileSync(oursPath, "utf8")).stations.filter((s) => s.source !== "ocm");
const isDup = (lat, lng) => ours.some((e) => Math.abs(e.lat - lat) < DEDUPE_DEGREES && Math.abs(e.lng - lng) < DEDUPE_DEGREES);

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");

const pois = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

const stats = { total: 0, emSP: 0, naoOperacional: 0, duplicada: 0, importada: 0, privada: 0, conectores: 0 };
const lines = ["-- Gerado por scripts/build-ocm-seed.mjs (snapshot Open Charge Map; sem status ao vivo)"];

for (const p of pois) {
  stats.total++;
  const a = p.AddressInfo || {};
  if (!(a.Latitude >= B.latMin && a.Latitude <= B.latMax && a.Longitude >= B.lngMin && a.Longitude <= B.lngMax)) continue;
  stats.emSP++;
  const st = status[p.StatusTypeID];
  if (st && st.IsOperational === false) {
    stats.naoOperacional++;
    continue;
  }
  if (isDup(a.Latitude, a.Longitude)) {
    stats.duplicada++;
    continue;
  }

  const id = "ocm_" + p.ID;
  const name = (a.Title || a.AddressLine1 || "Posto sem nome").trim();
  let network = ((ops[p.OperatorID] && ops[p.OperatorID].Title) || "").replace(/\s*\(BR\)\s*$/, "").trim();
  if (!network || /^\(.*\)$/.test(network)) network = "Open Charge Map";
  const priv = usage[p.UsageTypeID] && /^Private/i.test(usage[p.UsageTypeID].Title) ? 1 : 0;
  if (priv) stats.privada++;

  lines.push(
    `INSERT INTO stations (station_id, name, network, lat, lng, private, source) VALUES (${q(id)}, ${q(name)}, ${q(network)}, ${a.Latitude}, ${a.Longitude}, ${priv}, 'ocm') ` +
      `ON CONFLICT(station_id) DO UPDATE SET name=excluded.name, network=excluded.network, lat=excluded.lat, lng=excluded.lng, private=excluded.private, source='ocm';`
  );

  let idx = 0;
  for (const c of p.Connections || []) {
    const ct = (conn[c.ConnectionTypeID] && conn[c.ConnectionTypeID].Title) || "";
    const curTitle = (cur[c.CurrentTypeID] && cur[c.CurrentTypeID].Title) || "";
    let current = /^DC/i.test(curTitle) ? "DC" : /^AC/i.test(curTitle) ? "AC" : null;
    if (!current) current = /CCS|CHAdeMO|GB\/T DC|GB-T DC/i.test(ct) ? "DC" : "AC";
    const power = typeof c.PowerKW === "number" && c.PowerKW > 0 ? c.PowerKW : null;
    for (let i = 0; i < (c.Quantity || 1); i++) {
      lines.push(
        `INSERT INTO connector_meta (station_id, connector_index, power, current) VALUES (${q(id)}, ${idx}, ${q(power)}, ${q(current)}) ` +
          `ON CONFLICT(station_id, connector_index) DO UPDATE SET power=excluded.power, current=excluded.current;`
      );
      idx++;
      stats.conectores++;
    }
  }
  stats.importada++;
}

fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(JSON.stringify(stats));
