// Cálculo de uso/disponibilidade a partir de MUDANÇAS de estado (não de leituras a
// cada tick). O plano gratuito do D1 só aceita ~100 mil gravações por dia; gravar uma
// linha por conector a cada 5 min estoura isso em minutos, então o sync só grava quando
// a classe do conector muda e os tempos são obtidos integrando os intervalos.
//
// Unidade de saída: "ticks equivalentes" (ms / 5 min), pra continuar compatível com o
// histórico antigo de connector_daily_stats (que contava leituras de 5 em 5 min) e com
// MIN_SAMPLES_FOR_ESTIMATE.

export const TICK_MS = 5 * 60 * 1000;
export const DAY_MS = 24 * 3600 * 1000;

const OPERATIONAL = new Set(["Available", "Charging", "Preparing", "Finishing", "Reserved"]);

// C = carregando, O = operacional sem carregar, P = problema (falha/indisponível/desconhecido)
export function classOf(state) {
  if (state === "Charging") return "C";
  if (OPERATIONAL.has(state)) return "O";
  return "P";
}

export function dayBucket(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

// Remove de [a, b] os períodos em que o sync ficou fora do ar (gaps = [[ini, fim], ...]),
// devolvendo só os pedaços realmente observados.
export function observedPieces(a, b, gaps) {
  if (b <= a) return [];
  let pieces = [[a, b]];
  for (const [g0, g1] of gaps || []) {
    if (g1 <= a || g0 >= b) continue;
    const next = [];
    for (const [x, y] of pieces) {
      if (g1 <= x || g0 >= y) {
        next.push([x, y]);
        continue;
      }
      if (g0 > x) next.push([x, g0]);
      if (g1 < y) next.push([g1, y]);
    }
    pieces = next;
  }
  return pieces;
}

export function weights(cls, ms) {
  const t = ms / TICK_MS;
  return { total: t, ok: cls === "P" ? 0 : t, charging: cls === "C" ? t : 0 };
}

// Fatias por dia UTC de um intervalo já filtrado de gaps — usado pra gravar no agregado diário.
export function dailySlices(cls, a, b, gaps) {
  const out = new Map();
  for (const [x, y] of observedPieces(a, b, gaps)) {
    let cur = x;
    while (cur < y) {
      const day = dayBucket(cur);
      const stop = Math.min(y, day + DAY_MS);
      const w = weights(cls, stop - cur);
      const acc = out.get(day) || { total: 0, ok: 0, charging: 0 };
      acc.total += w.total;
      acc.ok += w.ok;
      acc.charging += w.charging;
      out.set(day, acc);
      cur = stop;
    }
  }
  return [...out.entries()].map(([day, w]) => ({ day, ...w }));
}

// Sequência de (classe, início, fim) de um conector dentro de [winStart, end], a partir
// dos eventos de mudança de classe (ordenados) e da classe atual.
// event = { cls, prev, at }; prev === null marca o primeiro registro do conector (não
// existe nada observado antes dele).
export function segmentsFor(events, currentCls, winStart, end) {
  const evs = events.filter((e) => e.at > winStart && e.at <= end);
  if (evs.length === 0) return end > winStart ? [{ cls: currentCls, from: winStart, to: end }] : [];
  const segs = [];
  if (evs[0].prev !== null && evs[0].prev !== undefined) segs.push({ cls: evs[0].prev, from: winStart, to: evs[0].at });
  for (let i = 0; i < evs.length; i++) {
    const to = i + 1 < evs.length ? evs[i + 1].at : end;
    segs.push({ cls: evs[i].cls, from: evs[i].at, to });
  }
  return segs;
}

export function integrate(segs, gaps) {
  const acc = { total: 0, ok: 0, charging: 0 };
  for (const s of segs) {
    for (const [x, y] of observedPieces(s.from, s.to, gaps)) {
      const w = weights(s.cls, y - x);
      acc.total += w.total;
      acc.ok += w.ok;
      acc.charging += w.charging;
    }
  }
  return acc;
}

// Pontos do gráfico "carros carregando": por bucket, média de conectores carregando e
// quantidade de conectores observados. connectors = [{ segs }].
export function timelinePoints(connectors, gaps, since, end, bucketMs) {
  if (end <= since) return [];
  const first = Math.floor(since / bucketMs) * bucketMs;
  const points = [];
  for (let b = first; b < end; b += bucketMs) {
    const lo = Math.max(b, since);
    const hi = Math.min(b + bucketMs, end);
    let charging = 0;
    let total = 0;
    for (const c of connectors) {
      const acc = { obs: 0, ch: 0 };
      for (const s of c.segs) {
        const a = Math.max(s.from, lo);
        const z = Math.min(s.to, hi);
        if (z <= a) continue;
        for (const [x, y] of observedPieces(a, z, gaps)) {
          acc.obs += y - x;
          if (s.cls === "C") acc.ch += y - x;
        }
      }
      if (acc.obs > 0) {
        total += 1;
        charging += acc.ch / acc.obs;
      }
    }
    if (total > 0) points.push({ t: b, charging: Math.round(charging * 10) / 10, total });
  }
  return points;
}
