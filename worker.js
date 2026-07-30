// São Paulo state bounding box (approximate)
const SP_BOUNDS = { latMin: -25.36, latMax: -19.78, lngMin: -53.11, lngMax: -44.16 };
const TUPI_STATIONS_URL = "https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes=&fast=false&searchText=";
const CACHE_TTL_SECONDS = 300;

async function handleEletropostosSP(request) {
  const cache = caches.default;
  const cacheKey = new Request("https://internal-cache/eletropostos-sp", request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(TUPI_STATIONS_URL, {
    headers: { "User-Agent": "MaiaEnergiasRenovaveis-Portal/1.0" },
  });
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "upstream_unavailable", status: upstream.status }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const stations = await upstream.json();

  const sp = stations
    .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
    .filter((s) => s.lat >= SP_BOUNDS.latMin && s.lat <= SP_BOUNDS.latMax && s.lng >= SP_BOUNDS.lngMin && s.lng <= SP_BOUNDS.lngMax)
    .map((s) => ({
      id: s._id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      network: s.iconPack || "outra",
      private: !!s.private,
      connectors: (s.connectedPlugs || []).map((p) => ({
        power: p.power ?? null,
        current: p.current ?? null,
        state: p.stateName || "Desconhecido",
      })),
    }));

  const body = JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: "Tupi (api.tupinambaenergia.com.br) — dados públicos do mapa de eletropostos",
    count: sp.length,
    stations: sp,
  });

  const response = new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  await cache.put(cacheKey, response.clone());
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && url.pathname === "/portal/api/eletropostos-sp") {
      return handleEletropostosSP(request);
    }

    const lastSegment = url.pathname.split("/").pop() ?? "";
    const isStaticAsset = lastSegment.includes(".");

    if (url.hostname === "portal.maiaenergiasrenovaveis.com.br" && !isStaticAsset && !url.pathname.startsWith("/portal")) {
      url.pathname = url.pathname === "/" ? "/portal" : "/portal" + url.pathname;
      return env.ASSETS.fetch(new Request(url, request));
    }

    return env.ASSETS.fetch(request);
  },
};
