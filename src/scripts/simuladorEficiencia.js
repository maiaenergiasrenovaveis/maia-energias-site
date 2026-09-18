import { MESES, calcularDimensionamento, calcularAreaModulos, calcularModulosQueCabem, calcularCapex, calcularContaMes1, calcularPayback } from "../lib/dimensionamentoSolar.js";
import { calcularBESS, calcularCenariosGrupoA } from "../lib/dimensionamentoBESS.js";
import { calcularInvestimentoMigracao, calcularCenariosMigracao } from "../lib/migracaoGrupoA.js";
import { calcularDimensionamentoEletrico, MATERIAIS_CONDUTOR as MATERIAIS_CONDUTOR_LABEL } from "../lib/dimensionamentoEletrico.js";
import { gerarPropostaPdf, gerarDatasheetPdf } from "./pdfProposta.js";

const $ = (id) => document.getElementById(id);
const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pct = (n) => (Number(n) * 100 || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const num = (n, casas = 1) => (Number(n) || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const gerarCodigoProposta = (prefixo) => {
  const d = new Date();
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${prefixo}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${rand}`;
};

// ---------- Tarifas homologadas ANEEL (Grupo A) ----------
let distribuidorasAneelCache = null;
const datalistsDistribuidorasPreenchidos = new Set();

async function carregarDistribuidorasAneel(datalistId) {
  if (datalistsDistribuidorasPreenchidos.has(datalistId)) return;
  datalistsDistribuidorasPreenchidos.add(datalistId);
  try {
    if (!distribuidorasAneelCache) {
      const res = await fetch("/interno/api/aneel-distribuidoras");
      const data = await res.json();
      distribuidorasAneelCache = data.distribuidoras ?? [];
    }
    const datalist = $(datalistId);
    const frag = document.createDocumentFragment();
    distribuidorasAneelCache.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      frag.appendChild(opt);
    });
    datalist.appendChild(frag);
  } catch {
    // Lista de distribuidoras é só conveniência (autocomplete) — falha aqui não deve travar nada.
  }
}

// Alíquota de ICMS sobre energia elétrica por UF — valores de REFERÊNCIA (base geral não
// residencial), não uma fonte oficial em tempo real. Varia por classe de consumo e alguns
// estados somam um adicional de fundo de combate à pobreza — sempre confirmar na SEFAZ do
// estado antes de usar em proposta. Onde a alíquota é progressiva por faixa, usei o teto
// (mais representativo de um consumidor Grupo A, que não fica na faixa mais baixa).
const ICMS_REFERENCIA_POR_UF = {
  AC: 19, AL: 20.5, AP: 18, AM: 20, BA: 20.5, CE: 20, DF: 20, ES: 17,
  GO: 19, MA: 20, MT: 17, MS: 17, MG: 18, PA: 19, PB: 20, PR: 19,
  PE: 20.5, PI: 22.5, RJ: 22, RN: 20, RS: 17, RO: 19.5, RR: 20, SC: 17,
  SP: 18, SE: 20, TO: 20,
};

const ultimasTarifasBrutasAneel = new Map(); // statusId -> {tarifaPonta, tarifaForaPonta, tarifaDemanda} sem imposto

function aplicarImpostoTarifaAneel({ statusId, ufId, icmsId, pisCofinsId, tarifaPontaId, tarifaForaPontaId, tarifaDemandaId, tarifaTusdId }) {
  const bruta = ultimasTarifasBrutasAneel.get(statusId);
  if (!bruta) return;
  const icmsPercent = Number($(icmsId).value) / 100 || 0;
  const pisCofinsPercent = Number($(pisCofinsId).value) / 100 || 0;
  const fatorGrossUp = (1 - icmsPercent) * (1 - pisCofinsPercent);
  if (fatorGrossUp <= 0) return;
  $(tarifaPontaId).value = (bruta.tarifaPonta / fatorGrossUp).toFixed(4);
  $(tarifaForaPontaId).value = (bruta.tarifaForaPonta / fatorGrossUp).toFixed(4);
  if (bruta.tarifaDemanda != null) $(tarifaDemandaId).value = (bruta.tarifaDemanda / fatorGrossUp).toFixed(2);
  if (tarifaTusdId && $(tarifaTusdId) && bruta.tarifaTusd != null) $(tarifaTusdId).value = (bruta.tarifaTusd / fatorGrossUp).toFixed(4);
}

async function buscarTarifaAneel({ distribuidoraId, subgrupoId, modalidadeId, statusId, ufId, icmsId, pisCofinsId, tarifaPontaId, tarifaForaPontaId, tarifaDemandaId, tarifaTusdId, onDone }) {
  const distribuidora = $(distribuidoraId).value.trim();
  const subgrupo = $(subgrupoId).value;
  const modalidade = $(modalidadeId).value;
  const status = $(statusId);
  if (!distribuidora || !subgrupo || !modalidade) return;

  status.textContent = "Buscando na ANEEL...";
  try {
    // cache: "no-store" — essa chamada muda de formato conforme o simulador evolui; sem isso,
    // o navegador de quem já buscou essa combinação antes guardaria a resposta antiga por até
    // 1h (o Cache-Control do endpoint) e nunca veria os campos novos até o cache expirar.
    const res = await fetch(`/interno/api/aneel-tarifas?distribuidora=${encodeURIComponent(distribuidora)}&subgrupo=${encodeURIComponent(subgrupo)}&modalidade=${encodeURIComponent(modalidade)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = `Não encontrado — confira o nome da distribuidora (${data.error ?? "erro"}).`;
      return;
    }
    ultimasTarifasBrutasAneel.set(statusId, { tarifaPonta: data.tarifaPonta, tarifaForaPonta: data.tarifaForaPonta, tarifaDemanda: data.tarifaDemanda, tarifaTusd: data.tarifaTusd });
    aplicarImpostoTarifaAneel({ statusId, ufId, icmsId, pisCofinsId, tarifaPontaId, tarifaForaPontaId, tarifaDemandaId, tarifaTusdId });
    const vigInicio = new Date(data.vigenciaInicio + "T00:00:00").toLocaleDateString("pt-BR");
    const vigFim = new Date(data.vigenciaFim + "T00:00:00").toLocaleDateString("pt-BR");
    status.innerHTML = `<span class="text-emerald-600 font-semibold">✓</span> ${data.fonte} — vigência ${vigInicio} a ${vigFim} (valores sem imposto; ICMS/PIS-COFINS aplicados acima).`;
    onDone?.();
  } catch {
    status.textContent = "Erro ao buscar na ANEEL — preencha manualmente.";
  }
}

// ---------- Seleção de grupo tarifário ----------
document.querySelectorAll(".grupo-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("grupo-selector").classList.add("hidden");
    $("simulacoes-salvas-wrap").classList.add("hidden");
    if (btn.dataset.grupo === "B") {
      $("painel-solar").classList.remove("hidden");
      initSolar();
    } else if (btn.dataset.grupo === "A") {
      $("painel-bess").classList.remove("hidden");
      initBess();
    } else if (btn.dataset.grupo === "Carregador") {
      $("painel-carregador").classList.remove("hidden");
      initCarregador();
    } else {
      $("painel-migracao").classList.remove("hidden");
      initMigracao();
    }
  });
});
document.querySelectorAll(".voltar-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("painel-solar").classList.add("hidden");
    $("painel-bess").classList.add("hidden");
    $("painel-migracao").classList.add("hidden");
    $("painel-carregador").classList.add("hidden");
    $("grupo-selector").classList.remove("hidden");
    $("simulacoes-salvas-wrap").classList.remove("hidden");
  });
});

// ---------- Simulações salvas (banco compartilhado, /interno/api/simulacoes) ----------
function coletarCamposPainel(painelId) {
  const painel = document.getElementById(painelId);
  const dados = {};
  painel.querySelectorAll("input[id], select[id]").forEach((el) => {
    dados[el.id] = el.type === "checkbox" ? el.checked : el.value;
  });
  return dados;
}

function aplicarCamposPainel(painelId, dados) {
  const painel = document.getElementById(painelId);
  Object.entries(dados || {}).forEach(([id, value]) => {
    const el = painel.querySelector(`#${CSS.escape(id)}`);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function salvarSimulacao(tipo, painelId, clienteFieldId, statusElId) {
  const status = $(statusElId);
  status.textContent = "Salvando...";
  try {
    const dados = coletarCamposPainel(painelId);
    const cliente = $(clienteFieldId).value || null;
    const res = await fetch("/interno/api/simulacoes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tipo, cliente, dados }),
    });
    if (res.status === 500) {
      const body = await res.json().catch(() => null);
      if (body?.error?.includes("D1_ERROR") && body.error.includes("limit")) {
        status.textContent = "Banco no limite diário de escrita — tente novamente mais tarde ou amanhã.";
        return;
      }
    }
    if (!res.ok) throw new Error("falha ao salvar");
    status.textContent = "Simulação salva.";
    carregarListaSimulacoes();
    setTimeout(() => (status.textContent = ""), 4000);
  } catch {
    status.textContent = "Erro ao salvar — tente novamente.";
  }
}

async function carregarSimulacao(id, tipo) {
  const res = await fetch(`/interno/api/simulacoes/${id}`);
  if (!res.ok) return;
  const row = await res.json();
  $("grupo-selector").classList.add("hidden");
  $("simulacoes-salvas-wrap").classList.add("hidden");
  if (tipo === "solar") {
    $("painel-solar").classList.remove("hidden");
    initSolar();
    aplicarCamposPainel("painel-solar", row.dados);
    computeSolar();
  } else if (tipo === "bess") {
    $("painel-bess").classList.remove("hidden");
    initBess();
    aplicarCamposPainel("painel-bess", row.dados);
    computeBess();
  } else if (tipo === "migracao") {
    $("painel-migracao").classList.remove("hidden");
    initMigracao();
    aplicarCamposPainel("painel-migracao", row.dados);
    computeMigracao();
  } else {
    $("painel-carregador").classList.remove("hidden");
    initCarregador();
    aplicarCamposPainel("painel-carregador", row.dados);
    computeCarregador();
  }
}

async function excluirSimulacao(id) {
  if (!confirm("Excluir esta simulação salva? Essa ação não pode ser desfeita.")) return;
  try {
    const res = await fetch(`/interno/api/simulacoes/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("falha ao excluir");
    carregarListaSimulacoes();
  } catch {
    alert("Não foi possível excluir agora (o banco pode estar no limite diário de escrita). Tente novamente mais tarde.");
  }
}

async function carregarListaSimulacoes() {
  const container = $("simulacoes-salvas-lista");
  try {
    const res = await fetch("/interno/api/simulacoes");
    const { results } = await res.json();
    if (!results || !results.length) {
      container.innerHTML = '<p class="p-4 text-slate-400">Nenhuma simulação salva ainda.</p>';
      return;
    }
    container.innerHTML = results
      .map(
        (r) => `
      <div class="flex items-center justify-between p-3 gap-3">
        <div class="min-w-0">
          <span class="text-[10px] font-bold uppercase tracking-wide ${r.tipo === "solar" ? "text-maia-blue-dark" : r.tipo === "bess" ? "text-maia-orange-dark" : r.tipo === "migracao" ? "text-maia-green" : "text-slate-500"}">${r.tipo === "solar" ? "Grupo B · Solar" : r.tipo === "bess" ? "Grupo A · BESS" : r.tipo === "migracao" ? "Grupo B → A · Migração" : "Elétrico · Carregador"}</span>
          <p class="font-semibold text-maia-navy truncate">${r.cliente || "(sem nome)"}</p>
          <p class="text-[11px] text-slate-400">${new Date(r.criado_em).toLocaleString("pt-BR")}</p>
        </div>
        <div class="flex gap-3 shrink-0">
          <button data-carregar="${r.id}" data-tipo="${r.tipo}" class="text-xs font-semibold text-maia-blue-dark whitespace-nowrap">Carregar</button>
          <button data-excluir="${r.id}" class="text-xs font-semibold text-red-600 whitespace-nowrap">Excluir</button>
        </div>
      </div>`
      )
      .join("");
    container.querySelectorAll("[data-carregar]").forEach((btn) => btn.addEventListener("click", () => carregarSimulacao(btn.dataset.carregar, btn.dataset.tipo)));
    container.querySelectorAll("[data-excluir]").forEach((btn) => btn.addEventListener("click", () => excluirSimulacao(btn.dataset.excluir)));
  } catch {
    container.innerHTML = '<p class="p-4 text-red-500">Erro ao carregar simulações salvas.</p>';
  }
}

carregarListaSimulacoes();

// ============================================================
// GRUPO B — SOLAR
// ============================================================
let solarInited = false;
let cidades = null;
let chartGeracao, chartPayback;
// Irradiação (índice de sol pleno) por mês do CALENDÁRIO, não por posição na grade —
// a grade pode começar em qualquer mês (histórico de consumo nem sempre começa em janeiro).
// Fallback (São Paulo) usado até a busca automática via NASA POWER responder, ou se falhar.
let irradiacaoPorMesCalendario = [4.7, 5.25, 4.82, 4.7, 4.21, 4.13, 4.15, 4.99, 4.46, 4.6, 4.66, 5.01];
let mesesRotacionados = MESES;

function atualizarLabelsMeses() {
  const mesInicial = Number($("s-mes-inicial").value) || 0;
  mesesRotacionados = MESES.map((_, i) => MESES[(mesInicial + i) % 12]);
  mesesRotacionados.forEach((mes, i) => {
    const consumoInput = $(`s-consumo-${i}`);
    const irrInput = $(`s-irr-${i}`);
    if (consumoInput) consumoInput.previousElementSibling.textContent = mes;
    if (irrInput) {
      irrInput.previousElementSibling.textContent = mes;
      const calendarMonth = (mesInicial + i) % 12;
      irrInput.value = irradiacaoPorMesCalendario[calendarMonth];
    }
  });
}

async function carregarCidades() {
  if (cidades) return cidades;
  const res = await fetch("/data/bd-cidades.json");
  cidades = await res.json();
  return cidades;
}

function initSolar() {
  if (solarInited) return;
  solarInited = true;

  $("s-ano-inicial").value = new Date().getFullYear();
  $("s-proposta-codigo").value = gerarCodigoProposta("SOL");

  // Grids de consumo e irradiação (labels iniciais em JAN..DEZ; ajustadas se o mês inicial mudar)
  const consumoGrid = $("s-consumo-grid");
  const irradiacaoGrid = $("s-irradiacao-grid");
  MESES.forEach((mes, i) => {
    consumoGrid.insertAdjacentHTML(
      "beforeend",
      `<div><label class="block text-[10px] text-slate-400">${mes}</label><input id="s-consumo-${i}" data-consumo-idx="${i}" type="number" value="0" class="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></div>`
    );
    irradiacaoGrid.insertAdjacentHTML(
      "beforeend",
      `<div><label class="block text-[10px] text-slate-400">${mes}</label><input id="s-irr-${i}" data-irr-idx="${i}" type="number" step="0.01" value="${irradiacaoPorMesCalendario[i]}" class="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></div>`
    );
  });

  $("s-mes-inicial").addEventListener("change", () => {
    atualizarLabelsMeses();
    computeSolar();
  });

  $("s-consumo-aplicar").addEventListener("click", () => {
    const v = Number($("s-consumo-media").value) || 0;
    document.querySelectorAll("[data-consumo-idx]").forEach((el) => (el.value = v));
    computeSolar();
  });

  // Autocomplete de cidade
  carregarCidades().then((list) => {
    const datalist = $("lista-cidades");
    const frag = document.createDocumentFragment();
    list.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = `${c.municipio} - ${c.uf}`;
      frag.appendChild(opt);
    });
    datalist.appendChild(frag);
  });
  let ultimaCidadeBuscada = null;
  $("s-cidade").addEventListener("input", () => {
    const match = cidades?.find((c) => `${c.municipio} - ${c.uf}`.toLowerCase() === $("s-cidade").value.toLowerCase());
    if (!match) {
      $("s-cidade-info").textContent = "";
      return;
    }
    const infoBase = `Lat ${match.lat.toFixed(2)}° · Long ${match.lng.toFixed(2)}° · Inclinação ideal sugerida: ${Math.abs(match.lat).toFixed(0)}°`;
    $("s-cidade-info").textContent = infoBase;
    const chave = `${match.municipio}|${match.uf}`;
    if (chave === ultimaCidadeBuscada) return;
    ultimaCidadeBuscada = chave;
    buscarIrradiacaoAutomatica(match, infoBase);
  });

  $("s-simultaneidade").addEventListener("input", () => {
    $("s-simultaneidade-out").textContent = pct($("s-simultaneidade").value);
    computeSolar();
  });

  async function buscarIrradiacaoAutomatica(match, infoBase) {
    $("s-cidade-info").textContent = `${infoBase} · Buscando irradiação (NASA POWER)...`;
    try {
      const res = await fetch(`/interno/api/irradiacao?lat=${match.lat}&lng=${match.lng}`);
      if (!res.ok) throw new Error("falha na busca");
      const { mensal } = await res.json();
      if (!Array.isArray(mensal) || mensal.length !== 12 || mensal.some((v) => typeof v !== "number")) throw new Error("resposta inválida");
      irradiacaoPorMesCalendario = mensal;
      atualizarLabelsMeses();
      computeSolar();
      $("s-cidade-info").textContent = `${infoBase} · Irradiação preenchida automaticamente (NASA POWER) — pode ajustar manualmente.`;
    } catch {
      $("s-cidade-info").textContent = `${infoBase} · Não foi possível buscar a irradiação automaticamente — confira/ajuste manualmente abaixo.`;
    }
  }

  document.querySelectorAll("#painel-solar input, #painel-solar select").forEach((el) => {
    el.addEventListener("input", computeSolar);
  });

  $("s-export-pdf").addEventListener("click", exportarPdfSolar);
  $("s-salvar").addEventListener("click", () => salvarSimulacao("solar", "painel-solar", "s-cliente", "s-salvar-status"));
  $("s-scan-conta-btn").addEventListener("click", escanearContaEnergia);

  computeSolar();
}

function arquivoParaDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Redesenha num canvas limitado a maxDim (maior lado) e reexporta como JPEG — reduz bastante
// o tamanho de fotos tiradas por celular (que podem vir com vários MB) antes do upload, o que
// evita erros de rede em conexões mais lentas/instáveis e deixa a chamada à OpenAI mais rápida.
function redimensionarImagem(img, maxDim = 1200, quality = 0.8) {
  const escala = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * escala);
  canvas.height = Math.round(img.naturalHeight * escala);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

async function imagemArquivoParaBase64(file) {
  const dataUrl = await arquivoParaDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  return redimensionarImagem(img);
}

// PDFs de conta variam muito sobre em qual página fica o "Histórico de consumo" (às vezes é
// a 1ª, às vezes o verso) — em vez de adivinhar, renderiza até 2 páginas e empilha tudo numa
// imagem só (o modelo de visão da Workers AI só aceita 1 imagem por chamada), pra ele procurar
// os dados em qualquer uma das páginas.
async function pdfArquivoParaImagemUnicaBase64(file, maxPaginas = 2) {
  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const totalPaginas = Math.min(pdf.numPages, maxPaginas);
  const canvasPaginas = [];
  for (let i = 1; i <= totalPaginas; i++) {
    const page = await pdf.getPage(i);
    const viewportBase = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1200 / Math.max(viewportBase.width, viewportBase.height) });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    canvasPaginas.push(canvas);
  }

  const larguraFinal = Math.max(...canvasPaginas.map((c) => c.width));
  const alturaFinal = canvasPaginas.reduce((soma, c) => soma + c.height, 0);
  const combinado = document.createElement("canvas");
  combinado.width = larguraFinal;
  combinado.height = alturaFinal;
  const ctx = combinado.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, larguraFinal, alturaFinal);
  let y = 0;
  for (const c of canvasPaginas) {
    ctx.drawImage(c, 0, y);
    y += c.height;
  }
  return combinado.toDataURL("image/jpeg", 0.8).split(",")[1];
}

async function escanearContaEnergia() {
  const arquivo = $("s-scan-conta-arquivo").files?.[0];
  const status = $("s-scan-conta-status");
  if (!arquivo) {
    status.textContent = "Selecione uma imagem ou PDF da conta primeiro.";
    return;
  }
  status.textContent = "Lendo a conta (pode levar alguns segundos)...";
  try {
    const imageBase64 = arquivo.type === "application/pdf" ? await pdfArquivoParaImagemUnicaBase64(arquivo) : await imagemArquivoParaBase64(arquivo);
    const res = await fetch("/interno/api/scan-conta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: imageBase64, mimeType: "image/jpeg" }),
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = `Não foi possível ler a conta — ${data.error ?? "erro desconhecido"}.`;
      return;
    }

    const preenchidos = [];
    if (data.cliente && !$("s-cliente").value) {
      $("s-cliente").value = data.cliente;
      preenchidos.push("cliente");
    }
    if (data.cidade && !$("s-cidade").value) {
      $("s-cidade").value = data.uf ? `${data.cidade} - ${data.uf}` : data.cidade;
      $("s-cidade").dispatchEvent(new Event("input", { bubbles: true }));
      preenchidos.push("cidade");
    }
    if (data.tipo_rede && ["Monofásica", "Bifásica", "Trifásica"].includes(data.tipo_rede)) {
      $("s-rede").value = data.tipo_rede;
      preenchidos.push("tipo de rede");
    }

    const historico = Array.isArray(data.historico_consumo) ? data.historico_consumo.filter((h) => MESES.includes(h?.mes) && Number.isFinite(h?.kwh)) : [];
    if (historico.length) {
      const mesInicialIdx = MESES.indexOf(historico[0].mes);
      $("s-mes-inicial").value = String(mesInicialIdx);
      atualizarLabelsMeses();
      historico.slice(0, 12).forEach((h, i) => {
        const el = $(`s-consumo-${i}`);
        if (el) el.value = h.kwh;
      });
      preenchidos.push(`${historico.length} meses de consumo`);
    }

    // Tarifas: a conta mostra o valor JÁ com imposto (é o que o cliente paga). Se a conta também
    // trouxer as alíquotas de ICMS/PIS-COFINS, dá pra "tirar o imposto" (mesma lógica inversa do
    // gross-up usado no lookup da ANEEL) e preencher também os campos "sem imposto"; sem as
    // alíquotas, só dá pra preencher o valor com imposto com segurança.
    if (Number.isFinite(data.icms_percent)) {
      $("s-icms").value = data.icms_percent;
      preenchidos.push("ICMS");
    }
    if (Number.isFinite(data.pis_cofins_percent)) {
      $("s-piscofins").value = data.pis_cofins_percent;
      preenchidos.push("PIS/COFINS");
    }
    const fatorGrossUp = (1 - (Number(data.icms_percent) || 0) / 100) * (1 - (Number(data.pis_cofins_percent) || 0) / 100);
    const temAliquotas = Number.isFinite(data.icms_percent) && Number.isFinite(data.pis_cofins_percent);
    if (Number.isFinite(data.te_com_imposto)) {
      $("s-te-com").value = data.te_com_imposto.toFixed(5);
      if (temAliquotas) $("s-te-sem").value = (data.te_com_imposto * fatorGrossUp).toFixed(5);
      preenchidos.push("TE");
    }
    if (Number.isFinite(data.tusd_com_imposto)) {
      $("s-tusd-com").value = data.tusd_com_imposto.toFixed(5);
      if (temAliquotas) $("s-tusd-sem").value = (data.tusd_com_imposto * fatorGrossUp).toFixed(5);
      preenchidos.push("TUSD");
    }
    if (Number.isFinite(data.iluminacao_publica)) {
      $("s-iluminacao").value = data.iluminacao_publica;
      preenchidos.push("iluminação pública");
    }

    if (!preenchidos.length) {
      status.textContent = "Não consegui identificar dados nessa imagem — confira se é uma foto legível da conta, ou preencha manualmente.";
      return;
    }
    status.innerHTML = `<span class="text-emerald-600 font-semibold">✓</span> Preenchido automaticamente: ${preenchidos.join(", ")}. <strong>Confira os valores antes de calcular.</strong>`;
    computeSolar();
  } catch {
    status.textContent = "Erro ao processar a imagem — tente novamente ou preencha manualmente.";
  }
}

function lerConsumoMensal() {
  return Array.from(document.querySelectorAll("[data-consumo-idx]"))
    .sort((a, b) => a.dataset.consumoIdx - b.dataset.consumoIdx)
    .map((el) => Number(el.value) || 0);
}
function lerIrradiacaoMensal() {
  return Array.from(document.querySelectorAll("[data-irr-idx]"))
    .sort((a, b) => a.dataset.irrIdx - b.dataset.irrIdx)
    .map((el) => Number(el.value) || 0);
}

let ultimoResultadoSolar = null;

function computeSolar() {
  const consumoMensal = lerConsumoMensal();
  if (consumoMensal.every((v) => v === 0)) {
    // Sem consumo preenchido não dá pra calcular nada — mas isso precisa ficar visível
    // pro usuário, em vez de simplesmente não atualizar a tela sem explicação (o que
    // parece a ferramenta ter travado quando na verdade só falta preencher o consumo).
    $("s-result-cards").innerHTML = `<div class="sm:col-span-2 lg:col-span-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
      ⚠ Preencha o consumo mensal (kWh) acima para calcular os resultados — todos os campos de "Consumo mensal" estão em 0.
    </div>`;
    return;
  }

  const rede = $("s-rede").value;
  const irradiacaoMensal = lerIrradiacaoMensal();
  const perdas = Number($("s-perdas").value) / 100;
  const perdasAdicionais = Number($("s-perdas-adicionais").value) / 100;
  const potenciaOverride = $("s-potencia-escolhida").value === "" ? null : Number($("s-potencia-escolhida").value);

  let dim = calcularDimensionamento({
    consumoMensal,
    rede,
    irradiacaoMensal,
    perdas,
    perdasAdicionais,
    potenciaEscolhidaKwp: potenciaOverride,
  });

  $("s-out-potencia-sugerida").textContent = `${num(dim.potenciaSugeridaKwp, 2)} kWp`;
  if (!$("s-potencia-escolhida").dataset.touched) {
    $("s-potencia-escolhida").placeholder = `Sugerida: ${num(dim.potenciaSugeridaKwp, 2)} kWp`;
  }

  const moduloParams = {
    moduloWp: Number($("s-modulo-wp").value) || 650,
    moduloAreaM2: Number($("s-modulo-area").value) || 3.055,
  };
  const tipoInstalacao = $("s-tipo-instalacao").value;
  const areaDisponivel = Number($("s-area-disponivel").value) || 0;
  const potenciaTravada = $("s-potencia-travada").value === "" ? null : Number($("s-potencia-travada").value);
  let limitadoPorArea = false;
  const potenciaDesejadaKwp = dim.potenciaEscolhidaKwp;

  // "Potência travada": o usuário já sabe o kWp real (projeto pronto, layout medido em
  // campo, etc.) e quer que TUDO — inclusive a checagem de área — use esse valor direto,
  // sem a sugestão por consumo nem o ajuste automático por área tentando decidir por ele.
  if (potenciaTravada != null) {
    dim = calcularDimensionamento({
      consumoMensal,
      rede,
      irradiacaoMensal,
      perdas,
      perdasAdicionais,
      potenciaEscolhidaKwp: potenciaTravada,
    });
  }

  let area = calcularAreaModulos(dim.potenciaEscolhidaKwp, moduloParams);

  if (areaDisponivel > 0) {
    const areaNecessariaEscolhida = tipoInstalacao === "solo" ? area.areaNecessariaSolo : area.areaNecessariaTelhado;
    const cabe = areaDisponivel >= areaNecessariaEscolhida;
    if (cabe) {
      $("s-area-comparacao").innerHTML = `<span class="text-emerald-600 font-semibold">✓ Cabe</span> — sobram ${num(areaDisponivel - areaNecessariaEscolhida, 0)} m² de folga.`;
    } else if (potenciaTravada != null) {
      // Potência travada não cabe na área informada — avisa, mas respeita a escolha do
      // usuário em vez de reduzir a potência automaticamente.
      $("s-area-comparacao").innerHTML =
        `<span class="text-red-600 font-semibold">✗ Não cabe</span> — faltam ${num(areaNecessariaEscolhida - areaDisponivel, 0)} m² (considerando ${tipoInstalacao}) para os ${num(potenciaTravada, 2)} kWp travados. ` +
        `<strong>Mantendo a potência travada mesmo assim — os cálculos abaixo usam ${num(potenciaTravada, 2)} kWp.</strong>`;
    } else {
      const possivel = calcularModulosQueCabem(areaDisponivel, tipoInstalacao, moduloParams);
      limitadoPorArea = true;
      // A área disponível não comporta a potência desejada — o dimensionamento e
      // toda a viabilidade financeira abaixo passam a usar a potência REAL que
      // cabe no local, não a que foi digitada em "Potência escolhida".
      dim = calcularDimensionamento({
        consumoMensal,
        rede,
        irradiacaoMensal,
        perdas,
        perdasAdicionais,
        potenciaEscolhidaKwp: possivel.potenciaMaximaKwp,
      });
      area = calcularAreaModulos(dim.potenciaEscolhidaKwp, moduloParams);
      $("s-area-comparacao").innerHTML =
        `<span class="text-red-600 font-semibold">✗ Não cabe</span> — faltam ${num(areaNecessariaEscolhida - areaDisponivel, 0)} m² (considerando ${tipoInstalacao}) para os ${num(potenciaDesejadaKwp, 2)} kWp desejados. ` +
        `Nessa área cabem aproximadamente <strong>${possivel.numeroModulos} módulos (${num(possivel.potenciaMaximaKwp, 2)} kWp)</strong> — ` +
        `<strong>os cálculos abaixo já foram recalculados usando essa potência real.</strong>`;
    }
  } else {
    $("s-area-comparacao").textContent = "";
  }
  $("s-out-num-modulos").textContent = `${area.numeroModulos}`;
  $("s-out-area-telhado").textContent = `${num(area.areaNecessariaTelhado, 0)} m²`;
  $("s-out-area-solo").textContent = `${num(area.areaNecessariaSolo, 0)} m²`;

  const capex = calcularCapex({
    valorKit: Number($("s-kit").value) || 0,
    lucroEquipamentoPercent: Number($("s-lucro-equip").value) / 100,
    materialInstalacaoAc: Number($("s-instal-ac").value) || 0,
    projetoArt: Number($("s-projeto-art").value) || 0,
    instalacao: Number($("s-instalacao").value) || 0,
    frete: Number($("s-frete").value) || 0,
    outros: Number($("s-outros").value) || 0,
    margemPercent: Number($("s-margem").value) / 100,
    impostoMaoDeObraPercent: Number($("s-imposto-mo").value) / 100,
  });

  const tarifas = {
    teSemImposto: Number($("s-te-sem").value) || 0,
    teComImposto: Number($("s-te-com").value) || 0,
    tusdSemImposto: Number($("s-tusd-sem").value) || 0,
    tusdComImposto: Number($("s-tusd-com").value) || 0,
    fioBRate: Number($("s-fiob").value) || 0,
    iluminacaoPublica: Number($("s-iluminacao").value) || 0,
    icmsPercent: Number($("s-icms").value) / 100,
    pisCofinsPercent: Number($("s-piscofins").value) / 100,
    simultaneidadePercent: Number($("s-simultaneidade").value) || 0.6,
  };

  const anoInicial = Number($("s-ano-inicial").value) || new Date().getFullYear();
  const conta = calcularContaMes1(dim, tarifas, anoInicial);
  const payback = calcularPayback(dim, tarifas, capex, anoInicial, {
    horizonteAnos: Number($("s-horizonte").value) || 25,
    taxaInflacaoEnergia: Number($("s-inflacao").value) / 100,
    tma: Number($("s-tma").value) / 100,
  });

  ultimoResultadoSolar = { dim, area, tipoInstalacao, limitadoPorArea, potenciaTravada, potenciaDesejadaKwp, capex, tarifas, conta, payback, anoInicial, consumoMensal, irradiacaoMensal };

  const potenciaLabel = potenciaTravada != null ? "Potência travada (manual)" : limitadoPorArea ? "Potência real (limitada pela área)" : "Potência escolhida";
  $("s-result-cards").innerHTML = `
    ${cardHtml(potenciaLabel, `${num(dim.potenciaEscolhidaKwp, 2)} kWp`)}
    ${cardHtml("Geração média mensal", `${num(dim.geracaoMedia, 0)} kWh`)}
    ${cardHtml("Autonomia do sistema", pct(dim.autonomiaPercent))}
    ${cardHtml("Valor final do sistema", brl(capex.valorFinalCliente))}
  `;

  $("s-conta-mes1").innerHTML = `
    ${linhaHtml("Consumo médio usado no cálculo", `${num(dim.consumoMedioMensal, 0)} kWh/mês`)}
    ${linhaHtml("Conta sem solar", brl2(conta.contaSemSolar))}
    ${linhaHtml("Conta com solar", brl2(conta.contaComSolar))}
    ${linhaHtml("Desconto mensal", `${brl2(conta.descontoReais)} (${pct(conta.descontoPercent)})`)}
    ${linhaHtml("Economia anual (ano 1)", brl(conta.economiaAnual))}
  `;

  $("s-viabilidade").innerHTML = `
    ${linhaHtml("Investimento", brl(payback.investimento))}
    ${linhaHtml("Payback simples", `${num(payback.paybackSimples, 1)} anos`)}
    ${linhaHtml("Payback descontado", payback.anoPaybackDescontado ? `${payback.anoPaybackDescontado} anos` : "—")}
    ${linhaHtml("ROI", pct(payback.roi))}
    ${linhaHtml("TIR", payback.irr != null ? pct(payback.irr) : "—")}
    ${linhaHtml("VPL", brl(payback.vpl))}
  `;

  renderChartGeracao(dim.geracaoMensal);
  renderChartPayback(payback.linhas);
  renderTabelaSazonal(mesesRotacionados, irradiacaoMensal, dim.geracaoMensal, consumoMensal);
}

function calcularLinhasSazonais(meses, irradiacaoMensal, geracaoMensal, consumoMensal) {
  return meses.map((mes, i) => {
    const saldo = geracaoMensal[i] - consumoMensal[i];
    return { mes, irr: irradiacaoMensal[i], geracao: geracaoMensal[i], consumo: consumoMensal[i], saldo };
  });
}

function renderTabelaSazonal(meses, irradiacaoMensal, geracaoMensal, consumoMensal) {
  const linhas = calcularLinhasSazonais(meses, irradiacaoMensal, geracaoMensal, consumoMensal);
  const somaGeracao = linhas.reduce((a, l) => a + l.geracao, 0);
  const somaConsumo = linhas.reduce((a, l) => a + l.consumo, 0);
  const irrMedia = linhas.reduce((a, l) => a + l.irr, 0) / linhas.length;

  $("s-sazonal-tabela").innerHTML =
    linhas
      .map(
        (l) => `
      <tr class="border-b border-slate-100">
        <td class="py-1.5 pr-2 font-semibold text-maia-navy">${l.mes}</td>
        <td class="py-1.5 px-2 text-right text-slate-500">${num(l.irr, 4)}</td>
        <td class="py-1.5 px-2 text-right text-slate-500">${num(l.consumo, 0)}</td>
        <td class="py-1.5 px-2 text-right text-slate-500">${num(l.geracao, 0)}</td>
        <td class="py-1.5 pl-2 text-right font-semibold ${l.saldo >= 0 ? "text-emerald-600" : "text-amber-600"}">
          ${l.saldo >= 0 ? "+" : ""}${num(l.saldo, 0)} <span class="font-normal text-[10px]">(${l.saldo >= 0 ? "crédito" : "usa crédito"})</span>
        </td>
      </tr>`
      )
      .join("") +
    `<tr class="font-semibold text-maia-navy">
      <td class="py-2 pr-2">Total / Média</td>
      <td class="py-2 px-2 text-right">${num(irrMedia, 4)}</td>
      <td class="py-2 px-2 text-right">${num(somaConsumo, 0)}</td>
      <td class="py-2 px-2 text-right">${num(somaGeracao, 0)} <span class="font-normal text-[10px] text-slate-400">(${num(somaGeracao / 12, 0)}/mês)</span></td>
      <td class="py-2 pl-2 text-right">${num(somaGeracao - somaConsumo, 0)}</td>
    </tr>`;
}

function cardHtml(label, value) {
  return `<div class="rounded-xl bg-white border border-slate-200 p-4">
    <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">${label}</p>
    <p class="text-xl font-bold text-maia-navy mt-1">${value}</p>
  </div>`;
}
function linhaHtml(label, value) {
  return `<div class="flex justify-between border-b border-slate-100 pb-1.5"><dt class="text-slate-500">${label}</dt><dd class="font-semibold text-maia-navy">${value}</dd></div>`;
}

function renderChartGeracao(geracaoMensal) {
  const ctx = $("s-chart-geracao");
  if (chartGeracao) chartGeracao.destroy();
  chartGeracao = new Chart(ctx, {
    type: "bar",
    data: {
      labels: mesesRotacionados,
      datasets: [{ label: "Geração (kWh)", data: geracaoMensal, backgroundColor: "#1c75bc" }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });
}

function renderChartPayback(linhas) {
  const ctx = $("s-chart-payback");
  if (chartPayback) chartPayback.destroy();
  chartPayback = new Chart(ctx, {
    type: "line",
    data: {
      labels: linhas.map((l) => `Ano ${l.anoRelativo}`),
      datasets: [
        { label: "Economia acumulada descontada", data: linhas.map((l) => l.economiaAcumuladaDescontada), borderColor: "#5fa746", tension: 0.2 },
        { label: "Investimento", data: linhas.map(() => ultimoResultadoSolar.payback.investimento), borderColor: "#f5a623", borderDash: [6, 4], pointRadius: 0 },
      ],
    },
    options: { responsive: true },
  });
}

async function exportarPdfSolar() {
  if (!ultimoResultadoSolar) return;
  const { dim, area, tipoInstalacao, limitadoPorArea, potenciaDesejadaKwp, capex, conta, payback, consumoMensal, irradiacaoMensal } = ultimoResultadoSolar;
  const cliente = $("s-cliente").value || "Cliente";
  const cidade = $("s-cidade").value || "";
  const rede = $("s-rede").value;

  const diagnostico = [
    `Consumo médio mensal atual: ${num(dim.consumoMedioMensal, 0)} kWh, em ligação ${rede.toLowerCase()}${cidade ? `, na cidade de ${cidade}` : ""}.`,
    `Sem geração própria, 100% da energia consumida é comprada da distribuidora à tarifa cheia (R$ ${num(conta.contaSemSolar / dim.consumoMedioMensal || 0, 3)}/kWh equivalente).`,
    `Taxa de disponibilidade (conta mínima): ${num(dim.taxaDisp, 0)} kWh/mês, cobrados independente da geração.`,
  ];

  const areaEscolhida = tipoInstalacao === "solo" ? area.areaNecessariaSolo : area.areaNecessariaTelhado;
  const escopo = [
    `Instalação de sistema fotovoltaico de ${num(dim.potenciaEscolhidaKwp, 2)} kWp, projetado para a irradiação solar local (${num(dim.irradiacaoMedia, 2)} kWh/m².dia em média).`,
    `Geração média estimada de ${num(dim.geracaoMedia, 0)} kWh/mês, cobrindo ${pct(dim.autonomiaPercent)} do consumo (autonomia do sistema).`,
    `${area.numeroModulos} módulos, ocupando ${num(areaEscolhida, 0)} m² de área (instalação em ${tipoInstalacao}).`,
    limitadoPorArea
      ? `Potência limitada pela área real disponível no local: o ideal seria ${num(potenciaDesejadaKwp, 2)} kWp, mas o espaço comporta ${num(dim.potenciaEscolhidaKwp, 2)} kWp — todos os valores desta proposta já refletem essa potência real.`
      : null,
    "Projeto elétrico, ART, instalação completa, materiais e homologação junto à distribuidora inclusos no valor do investimento.",
    "Compensação de créditos de energia conforme a Lei 14.300/2022 (Marco Legal da Geração Distribuída).",
  ].filter(Boolean);

  const tabelaFinanceira = [
    ["Consumo médio atual (mensal)", brl(dim.consumoMedioMensal) + " kWh"],
    ["Conta de energia sem o sistema (mensal)", brl2(conta.contaSemSolar)],
    ["Conta de energia com o sistema (mensal)", brl2(conta.contaComSolar)],
    ["Economia mensal estimada", `${brl2(conta.descontoReais)} (${pct(conta.descontoPercent)} de redução)`],
    ["Economia anual acumulada (ano 1)", brl(conta.economiaAnual)],
    ["Tempo de retorno (payback simples)", `${num(payback.paybackSimples, 1)} anos`],
  ];

  const linhasSazonais = calcularLinhasSazonais(mesesRotacionados, irradiacaoMensal, dim.geracaoMensal, consumoMensal);
  const tabelaSazonalPdf = linhasSazonais.map((l) => [
    l.mes,
    num(l.irr, 4),
    `${num(l.consumo, 0)} kWh`,
    `${num(l.geracao, 0)} kWh`,
    `${l.saldo >= 0 ? "+" : ""}${num(l.saldo, 0)} kWh (${l.saldo >= 0 ? "crédito" : "usa crédito"})`,
  ]);

  await gerarPropostaPdf({
    subtitulo: "Projeto de Energia Solar Fotovoltaica",
    codigoProposta: $("s-proposta-codigo").value || "—",
    cliente,
    responsavelNome: $("s-responsavel-nome").value,
    responsavelCargo: $("s-responsavel-cargo").value,
    email: $("s-email").value,
    resumoExecutivo: `Esta proposta apresenta a solução de geração de energia solar fotovoltaica para as instalações de ${cliente}. Nosso objetivo é reduzir os custos com energia elétrica em até ${pct(conta.descontoPercent)}, gerando energia limpa e previsível pelos próximos 25 anos.`,
    diagnostico,
    escopo,
    tabelaFinanceira,
    graficoCanvas: $("s-chart-payback"),
    graficoSecundario: $("s-chart-geracao"),
    tabelaSecundaria: {
      titulo: "Comportamento sazonal da geração — a irradiação varia ao longo do ano, então a geração mensal não é fixa; o saldo é compensado pelo sistema de créditos da Lei 14.300:",
      head: ["Mês", "Irradiação (kWh/m².dia)", "Consumo", "Geração estimada", "Saldo do mês"],
      body: tabelaSazonalPdf,
    },
    investimentoTotal: capex.valorFinalCliente,
    formaPagamento: $("s-forma-pagamento").value,
    prazoExecucaoDias: $("s-prazo-execucao").value || "—",
    validadeDias: $("s-validade-proposta").value || "—",
    observacoes: $("s-observacoes").value,
    cronograma: [
      "Etapa 1: engenharia de detalhamento, compra de materiais e solicitação de acesso à distribuidora.",
      "Etapa 2: instalação física dos módulos, inversor e estrutura de fixação.",
      "Etapa 3: comissionamento, testes, troca do relógio de energia e vistoria da distribuidora.",
      "Etapa 4: sistema em operação e monitoramento de geração.",
    ],
    notaRodape:
      "Estimativas de geração baseadas em índices de irradiação da região (CRESESB/NASA) e no consumo informado pelo cliente; a geração real varia mês a mês por fatores meteorológicos. ROI, TIR e VPL consideram um horizonte de 25 anos, reajuste de energia e TMA informados na simulação. Não substitui análise técnica de campo.",
    fileName: `proposta-solar-${(cliente || "cliente").replace(/\s+/g, "-").toLowerCase()}.pdf`,
  });
}

// ============================================================
// GRUPO A — BESS / EFICIÊNCIA
// ============================================================
let bessInited = false;
let chartConta;
let ultimoResultadoBess = null;

function initBess() {
  if (bessInited) return;
  bessInited = true;

  $("b-proposta-codigo").value = gerarCodigoProposta("BESS");

  $("b-usar-ml").addEventListener("change", () => {
    $("b-ml-fields").classList.toggle("hidden", !$("b-usar-ml").checked);
    computeBess();
  });
  $("b-modo-aquisicao").addEventListener("change", () => {
    const eaas = $("b-modo-aquisicao").value === "eaas";
    $("b-capex-fields").classList.toggle("hidden", eaas);
    $("b-eaas-fields").classList.toggle("hidden", !eaas);
    computeBess();
  });
  $("b-lucro-real").addEventListener("change", () => {
    $("b-lucro-real-fields").classList.toggle("hidden", !$("b-lucro-real").checked);
    computeBess();
  });

  document.querySelectorAll("#painel-bess input, #painel-bess select").forEach((el) => {
    el.addEventListener("input", computeBess);
  });

  carregarDistribuidorasAneel("lista-distribuidoras-aneel");
  const buscarTarifaBessAneel = () =>
    buscarTarifaAneel({
      distribuidoraId: "b-aneel-distribuidora",
      subgrupoId: "b-aneel-subgrupo",
      modalidadeId: "b-aneel-modalidade",
      statusId: "b-aneel-status",
      ufId: "b-aneel-uf",
      icmsId: "b-aneel-icms",
      pisCofinsId: "b-aneel-piscofins",
      tarifaPontaId: "b-tarifa-ponta",
      tarifaForaPontaId: "b-tarifa-fora-ponta",
      tarifaDemandaId: "b-tarifa-demanda",
      tarifaTusdId: "b-tarifa-tusd",
      onDone: computeBess,
    });
  ["b-aneel-distribuidora", "b-aneel-subgrupo", "b-aneel-modalidade"].forEach((id) => {
    $(id).addEventListener("change", buscarTarifaBessAneel);
  });
  $("b-aneel-uf").addEventListener("change", () => {
    if (!$("b-aneel-icms").dataset.touched) {
      $("b-aneel-icms").value = ICMS_REFERENCIA_POR_UF[$("b-aneel-uf").value] ?? "";
    }
    aplicarImpostoTarifaAneel({
      statusId: "b-aneel-status",
      ufId: "b-aneel-uf",
      icmsId: "b-aneel-icms",
      pisCofinsId: "b-aneel-piscofins",
      tarifaPontaId: "b-tarifa-ponta",
      tarifaForaPontaId: "b-tarifa-fora-ponta",
      tarifaDemandaId: "b-tarifa-demanda",
      tarifaTusdId: "b-tarifa-tusd",
    });
    computeBess();
  });
  ["b-aneel-icms", "b-aneel-piscofins"].forEach((id) => {
    $(id).addEventListener("input", () => {
      $(id).dataset.touched = "1";
      aplicarImpostoTarifaAneel({
        statusId: "b-aneel-status",
        ufId: "b-aneel-uf",
        icmsId: "b-aneel-icms",
        pisCofinsId: "b-aneel-piscofins",
        tarifaPontaId: "b-tarifa-ponta",
        tarifaForaPontaId: "b-tarifa-fora-ponta",
        tarifaDemandaId: "b-tarifa-demanda",
        tarifaTusdId: "b-tarifa-tusd",
      });
      computeBess();
    });
  });

  $("b-export-pdf").addEventListener("click", exportarPdfBess);
  $("b-salvar").addEventListener("click", () => salvarSimulacao("bess", "painel-bess", "b-cliente", "b-salvar-status"));

  computeBess();
}

function computeBess() {
  const consumoPontaMensal = Number($("b-energia-ponta").value) || 0;
  if (consumoPontaMensal === 0) {
    $("b-result-cards").innerHTML = `<div class="sm:col-span-2 lg:col-span-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
      ⚠ Preencha "Energia ponta (kWh/mês)" para calcular os resultados.
    </div>`;
    return;
  }

  const bess = calcularBESS({
    consumoPontaMensal,
    diasUteis: Number($("b-dias-uteis").value) || 21,
    horasPonta: Number($("b-horas-ponta").value) || 3,
    margemPotencia: Number($("b-margem-potencia").value) / 100,
    rte: Number($("b-rte").value) / 100,
    dod: Number($("b-dod").value) / 100,
    margemCapacidade: Number($("b-margem-capacidade").value) / 100,
  });

  $("b-dimensionamento-out").innerHTML = `
    <div class="flex justify-between"><dt class="text-slate-500">Potência recomendada</dt><dd class="font-semibold">${num(bess.potenciaRecomendadaKw, 1)} kW</dd></div>
    <div class="flex justify-between"><dt class="text-slate-500">Capacidade recomendada</dt><dd class="font-semibold">${num(bess.capacidadeFinalKwh, 1)} kWh</dd></div>
  `;

  const modoAquisicao = $("b-modo-aquisicao").value;
  const cenarios = calcularCenariosGrupoA({
    energiaPontaKwh: consumoPontaMensal,
    energiaForaPontaKwh: Number($("b-energia-fora-ponta").value) || 0,
    demandaContratadaKw: Number($("b-demanda").value) || 0,
    demandaContratadaKwPosBess: Number($("b-demanda-pos").value) || 0,
    tarifaPonta: Number($("b-tarifa-ponta").value) || 0,
    tarifaForaPonta: Number($("b-tarifa-fora-ponta").value) || 0,
    tarifaDemanda: Number($("b-tarifa-demanda").value) || 0,
    reativoExcedente: Number($("b-reativo").value) || 0,
    iluminacaoPublica: Number($("b-iluminacao").value) || 0,
    outros: Number($("b-outros").value) || 0,
    usarMercadoLivre: $("b-usar-ml").checked,
    tarifaMercadoLivre: Number($("b-tarifa-ml").value) || null,
    tarifaTusd: Number($("b-tarifa-tusd").value) || 0,
    modoAquisicao,
    investimentoBess: Number($("b-investimento").value) || 0,
    mensalidadeEaasInicial: Number($("b-mensalidade").value) || 0,
    lucroReal: $("b-lucro-real").checked,
    creditoPisCofinsPercent: Number($("b-credito-piscofins").value) / 100,
    creditoIrpjCsllPercent: Number($("b-credito-irpjcsll").value) / 100,
    horizonteAnos: Number($("b-horizonte").value) || 10,
    reajusteTarifario: Number($("b-reajuste").value) / 100,
    ipca: Number($("b-ipca").value) / 100,
  });

  ultimoResultadoBess = { bess, cenarios, modoAquisicao };

  const l1 = cenarios.linhas[0];
  const cards = [
    cardHtml("Potência BESS", `${num(bess.potenciaRecomendadaKw, 1)} kW`),
    cardHtml("Capacidade BESS", `${num(bess.capacidadeFinalKwh, 1)} kWh`),
    // Economia de energia (efeito do BESS/ML na conta) — igual nos dois modos de aquisição,
    // não é afetada pela forma de pagamento do equipamento.
    cardHtml("Economia de energia (mês, ano 1)", brl(cenarios.economiaEnergiaMensalAno1)),
  ];
  if (modoAquisicao === "capex") {
    cards.push(cardHtml("Payback", cenarios.paybackMeses ? `${num(cenarios.paybackMeses, 1)} meses` : "—"));
  } else {
    cards.push(cardHtml("Mensalidade EaaS", brl2(cenarios.lucroReal ? l1.mensalidadeEaasLiquida : l1.mensalidadeEaasNominal)));
    cards.push(cardHtml("Resultado líquido mensal (após mensalidade)", brl2(cenarios.resultadoLiquidoMensalAno1)));
    if (cenarios.lucroReal) {
      cards.push(cardHtml("Mensalidade EaaS (nominal, sem crédito)", brl2(l1.mensalidadeEaasNominal)));
    }
  }
  $("b-result-cards").innerHTML = cards.join("");

  renderChartConta(cenarios.linhas, cenarios.usarMercadoLivre);
}

function renderChartConta(linhas, usouMercadoLivre) {
  const ctx = $("b-chart-conta");
  const heading = ctx.closest(".rounded-xl")?.querySelector("h2");
  if (heading) heading.textContent = `Conta mensal — Atual vs. Com BESS${usouMercadoLivre ? " + Mercado Livre" : ""}`;
  if (chartConta) chartConta.destroy();
  chartConta = new Chart(ctx, {
    type: "line",
    data: {
      labels: linhas.map((l) => `Ano ${l.anoRelativo}`),
      datasets: [
        { label: "Conta atual (mercado regulado)", data: linhas.map((l) => l.contaAtual), borderColor: "#e08e0b", tension: 0.15 },
        { label: `Conta com BESS${usouMercadoLivre ? " + Mercado Livre" : ""}`, data: linhas.map((l) => l.contaComBess), borderColor: "#1c75bc", tension: 0.15 },
      ],
    },
    options: { responsive: true },
  });
}

async function exportarPdfBess() {
  if (!ultimoResultadoBess) return;
  const { bess, cenarios, modoAquisicao } = ultimoResultadoBess;
  const cliente = $("b-cliente").value || "Cliente";
  const mlSufixo = cenarios.usarMercadoLivre ? " + Mercado Livre" : "";

  const diagnostico = [
    `Demanda contratada atual: ${num(Number($("b-demanda").value), 0)} kW, com consumo de ${num(Number($("b-energia-ponta").value), 0)} kWh/mês no horário de ponta.`,
    `Tarifa de ponta ${num(Number($("b-tarifa-ponta").value), 2)} vezes mais cara que a tarifa fora de ponta, penalizando o uso de energia nesse período.`,
    cenarios.usarMercadoLivre
      ? "Cliente ainda não migrado para o Mercado Livre de energia, pagando tarifas do mercado regulado."
      : "Cliente operando integralmente no ambiente de contratação regulado (ACR).",
  ];

  const escopo = [
    `Instalação de banco de baterias (BESS) de ${num(bess.potenciaRecomendadaKw, 1)} kW / ${num(bess.capacidadeFinalKwh, 1)} kWh para deslocamento de carga na ponta (peak shaving).`,
    `Redução da demanda contratada de ${num(Number($("b-demanda").value), 0)} kW para ${num(Number($("b-demanda-pos").value), 0)} kW.`,
    cenarios.usarMercadoLivre
      ? `Migração para o Mercado Livre de Energia, com energia estimada em R$ ${num(Number($("b-tarifa-ml").value), 4)}/kWh + TUSD de R$ ${num(Number($("b-tarifa-tusd").value), 4)}/kWh (continua devido à distribuidora local).`
      : null,
    modoAquisicao === "eaas"
      ? "Modelo de assinatura (Energy as a Service) — sem investimento inicial, com mensalidade reajustada anualmente pelo IPCA."
      : "Aquisição do sistema via investimento direto (CAPEX), com propriedade do ativo pelo cliente.",
  ].filter(Boolean);

  const tabelaFinanceira = [
    ["Conta atual (mensal, mercado regulado)", brl2(cenarios.linhas[0].contaAtual)],
    [`Conta com BESS${mlSufixo} — só energia (mensal)`, brl2(cenarios.linhas[0].contaAtual - cenarios.economiaEnergiaMensalAno1)],
    ["Economia de energia estimada (mensal)", brl2(cenarios.economiaEnergiaMensalAno1)],
    ["Economia de energia acumulada (ano 1)", brl(cenarios.linhas[0].economiaEnergiaAnual)],
    [`Economia de energia total (${cenarios.linhas.length} anos)`, brl(cenarios.economiaEnergiaTotalHorizonte)],
  ];
  if (modoAquisicao === "capex") {
    tabelaFinanceira.push(["Tempo de retorno (payback)", cenarios.paybackMeses ? `${num(cenarios.paybackMeses, 1)} meses` : "—"]);
  } else {
    tabelaFinanceira.push(["Mensalidade EaaS (nominal)", brl2(cenarios.linhas[0].mensalidadeEaasNominal)]);
    if (cenarios.lucroReal) {
      tabelaFinanceira.push(["Mensalidade líquida (Lucro Real)", brl2(cenarios.linhas[0].mensalidadeEaasLiquida)]);
    }
    tabelaFinanceira.push(["Resultado líquido mensal (economia − mensalidade)", brl2(cenarios.resultadoLiquidoMensalAno1)]);
    tabelaFinanceira.push([`Resultado líquido total (${cenarios.linhas.length} anos)`, brl(cenarios.resultadoLiquidoTotalHorizonte)]);
  }

  await gerarPropostaPdf({
    subtitulo: `Projeto de Eficiência Energética + BESS${mlSufixo}`,
    codigoProposta: $("b-proposta-codigo").value || "—",
    cliente,
    responsavelNome: $("b-responsavel-nome").value,
    responsavelCargo: $("b-responsavel-cargo").value,
    email: $("b-email").value,
    resumoExecutivo: `Esta proposta apresenta a solução de armazenamento de energia (BESS) para otimização do consumo elétrico nas instalações de ${cliente}. Nosso objetivo é reduzir os custos operacionais com energia e demanda contratada, com economia de energia estimada de ${brl2(cenarios.economiaEnergiaMensalAno1)}/mês.`,
    diagnostico,
    escopo,
    tabelaFinanceira,
    graficoCanvas: $("b-chart-conta"),
    investimentoTotal: modoAquisicao === "capex" ? cenarios.investimento : 0,
    formaPagamento: modoAquisicao === "capex" ? $("b-forma-pagamento").value : "Assinatura mensal (EaaS) — sem investimento inicial",
    prazoExecucaoDias: $("b-prazo-execucao").value || "—",
    validadeDias: $("b-validade-proposta").value || "—",
    observacoes: $("b-observacoes").value,
    cronograma: [
      "Etapa 1: engenharia de detalhamento, dimensionamento final e compra de equipamentos.",
      "Etapa 2: instalação física do banco de baterias e integração com o quadro elétrico, sem interromper a operação.",
      "Etapa 3: comissionamento, testes de descarga na ponta e configuração do sistema de controle.",
      "Etapa 4: acompanhamento da conta de energia e relatório mensal de economia gerada.",
    ],
    notaRodape:
      "Estimativas baseadas em dados informados pelo cliente. A efetividade do BESS em cobrir a energia de ponta decai ao longo da vida útil da bateria, conforme premissa técnica do fabricante. O crédito tributário sobre a mensalidade EaaS (Lucro Real) é uma estimativa e depende do enquadramento fiscal real do cliente — consulte a contabilidade dele antes de apresentar como garantido. Não substitui análise técnica detalhada.",
    fileName: `proposta-bess-${(cliente || "cliente").replace(/\s+/g, "-").toLowerCase()}.pdf`,
  });
}

// ============================================================
// MIGRAÇÃO GRUPO B → GRUPO A (aumento de carga + Mercado Livre)
// ============================================================
let migracaoInited = false;
let chartMigracao;
let ultimoResultadoMigracao = null;

function initMigracao() {
  if (migracaoInited) return;
  migracaoInited = true;

  $("m-proposta-codigo").value = gerarCodigoProposta("MIG");

  $("m-usar-ml").addEventListener("change", () => {
    $("m-ml-fields").classList.toggle("hidden", !$("m-usar-ml").checked);
    computeMigracao();
  });

  $("m-carga-tipo").addEventListener("change", () => {
    $("m-carga-outro-wrap").classList.toggle("hidden", $("m-carga-tipo").value !== "Outro");
    computeMigracao();
  });

  document.querySelectorAll("#painel-migracao input, #painel-migracao select").forEach((el) => {
    el.addEventListener("input", computeMigracao);
  });

  carregarDistribuidorasAneel("lista-distribuidoras-aneel-m");
  const camposAneelMigracao = {
    distribuidoraId: "m-aneel-distribuidora",
    subgrupoId: "m-aneel-subgrupo",
    modalidadeId: "m-aneel-modalidade",
    statusId: "m-aneel-status",
    ufId: "m-aneel-uf",
    icmsId: "m-aneel-icms",
    pisCofinsId: "m-aneel-piscofins",
    tarifaPontaId: "m-tarifa-ponta",
    tarifaForaPontaId: "m-tarifa-fora-ponta",
    tarifaDemandaId: "m-tarifa-demanda",
    tarifaTusdId: "m-tarifa-tusd",
  };
  ["m-aneel-distribuidora", "m-aneel-subgrupo", "m-aneel-modalidade"].forEach((id) => {
    $(id).addEventListener("change", () => buscarTarifaAneel({ ...camposAneelMigracao, onDone: computeMigracao }));
  });
  $("m-aneel-uf").addEventListener("change", () => {
    if (!$("m-aneel-icms").dataset.touched) {
      $("m-aneel-icms").value = ICMS_REFERENCIA_POR_UF[$("m-aneel-uf").value] ?? "";
    }
    aplicarImpostoTarifaAneel(camposAneelMigracao);
    computeMigracao();
  });
  ["m-aneel-icms", "m-aneel-piscofins"].forEach((id) => {
    $(id).addEventListener("input", () => {
      $(id).dataset.touched = "1";
      aplicarImpostoTarifaAneel(camposAneelMigracao);
      computeMigracao();
    });
  });

  $("m-export-pdf").addEventListener("click", exportarPdfMigracao);
  $("m-salvar").addEventListener("click", () => salvarSimulacao("migracao", "painel-migracao", "m-cliente", "m-salvar-status"));

  computeMigracao();
}

function computeMigracao() {
  const consumoAtualKwh = Number($("m-consumo-atual").value) || 0;
  if (consumoAtualKwh === 0) {
    $("m-result-cards").innerHTML = `<div class="sm:col-span-2 lg:col-span-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
      ⚠ Preencha "Consumo atual (kWh/mês)" para calcular os resultados.
    </div>`;
    return;
  }

  const investimento = calcularInvestimentoMigracao({
    transformador: Number($("m-transformador").value) || 0,
    obraCivil: Number($("m-obra-civil").value) || 0,
    projetoArt: Number($("m-projeto-art").value) || 0,
    medicaoProtecao: Number($("m-medicao-protecao").value) || 0,
    taxaDistribuidora: Number($("m-taxa-distribuidora").value) || 0,
    outros: Number($("m-investimento-outros").value) || 0,
    cargaValor: Number($("m-carga-valor").value) || 0,
  });
  $("m-out-investimento").textContent = brl(investimento.total);

  const cenarios = calcularCenariosMigracao({
    consumoAtualKwh,
    tarifaGrupoBAtual: Number($("m-tarifa-grupob").value) || 0,
    energiaPontaKwhProjetado: Number($("m-energia-ponta").value) || 0,
    energiaForaPontaKwhProjetado: Number($("m-energia-fora-ponta").value) || 0,
    demandaContratadaKw: Number($("m-demanda").value) || 0,
    tarifaPonta: Number($("m-tarifa-ponta").value) || 0,
    tarifaForaPonta: Number($("m-tarifa-fora-ponta").value) || 0,
    tarifaDemanda: Number($("m-tarifa-demanda").value) || 0,
    reativoExcedente: Number($("m-reativo").value) || 0,
    iluminacaoPublica: Number($("m-iluminacao").value) || 0,
    outros: Number($("m-outros").value) || 0,
    usarMercadoLivre: $("m-usar-ml").checked,
    tarifaMercadoLivre: Number($("m-tarifa-ml").value) || null,
    tarifaTusd: Number($("m-tarifa-tusd").value) || 0,
    investimentoMigracao: investimento.total,
    horizonteAnos: Number($("m-horizonte").value) || 10,
    reajusteTarifario: Number($("m-reajuste").value) / 100,
  });

  ultimoResultadoMigracao = { investimento, cenarios };

  const l1 = cenarios.linhas[0];
  const favoravel = l1.economiaMensal >= 0;
  $("m-result-cards").innerHTML = `
    ${cardHtml("Conta atual (Grupo B hoje)", brl2(cenarios.contaAtualGrupoB.total))}
    ${cardHtml("Grupo B projetado (mesmo consumo)", brl2(l1.contaGrupoBProjetada))}
    ${cardHtml(`Grupo A projetado${cenarios.usarMercadoLivre ? " + ML" : ""}`, brl2(l1.contaGrupoAProjetada))}
    ${cardHtml(favoravel ? "Economia mensal com a migração" : "Custo extra mensal da migração", brl2(Math.abs(l1.economiaMensal)))}
  `;

  renderChartMigracao(cenarios.linhas, cenarios.usarMercadoLivre);
}

function renderChartMigracao(linhas, usouMercadoLivre) {
  const ctx = $("m-chart-conta");
  const heading = ctx.closest(".rounded-xl")?.querySelector("h2");
  if (heading) heading.textContent = `Conta mensal — Grupo B vs. Grupo A${usouMercadoLivre ? " + Mercado Livre" : ""} (mesmo consumo projetado)`;
  if (chartMigracao) chartMigracao.destroy();
  chartMigracao = new Chart(ctx, {
    type: "line",
    data: {
      labels: linhas.map((l) => `Ano ${l.anoRelativo}`),
      datasets: [
        { label: "Conta como Grupo B", data: linhas.map((l) => l.contaGrupoBProjetada), borderColor: "#e08e0b", tension: 0.15 },
        { label: `Conta como Grupo A${usouMercadoLivre ? " + Mercado Livre" : ""}`, data: linhas.map((l) => l.contaGrupoAProjetada), borderColor: "#1c75bc", tension: 0.15 },
      ],
    },
    options: { responsive: true },
  });
}

async function exportarPdfMigracao() {
  if (!ultimoResultadoMigracao) return;
  const { investimento, cenarios } = ultimoResultadoMigracao;
  const cliente = $("m-cliente").value || "Cliente";
  const mlSufixo = cenarios.usarMercadoLivre ? " + Mercado Livre" : "";
  const l1 = cenarios.linhas[0];
  const cargaTipo = $("m-carga-tipo").value === "Outro" ? $("m-carga-outro").value || "Carga" : $("m-carga-tipo").value;
  const temCarga = investimento.cargaValor > 0;

  const diagnostico = [
    `Consumo atual (Grupo B, baixa tensão): ${num(Number($("m-consumo-atual").value), 0)} kWh/mês, sem demanda contratada.`,
    `Com o aumento de carga projetado${temCarga ? ` (motivado por ${cargaTipo.toLowerCase()})` : ""}, o consumo passa a ${num(cenarios.consumoProjetadoTotal, 0)} kWh/mês (${num(Number($("m-energia-ponta").value), 0)} kWh na ponta + ${num(Number($("m-energia-fora-ponta").value), 0)} kWh fora ponta) e demanda de ${num(Number($("m-demanda").value), 0)} kW — acima do que a ligação em baixa tensão comporta com bom custo-benefício.`,
    cenarios.usarMercadoLivre
      ? "Cenário já considera a migração para o Mercado Livre de Energia junto com a mudança de grupo tarifário."
      : "Cenário calculado no mercado regulado (ACR); o Mercado Livre pode ampliar a economia (ver observações).",
  ];

  const escopo = [
    `Migração da unidade consumidora de Grupo B para Grupo A (alta tensão), com nova demanda contratada de ${num(Number($("m-demanda").value), 0)} kW.`,
    "Construção de subestação/cabine primária própria: transformador, obra civil, projeto elétrico/ART, medição e proteção, e conexão junto à distribuidora.",
    temCarga ? `Fornecimento e instalação de ${cargaTipo.toLowerCase()}, preço final incluso no investimento total desta proposta.` : null,
    `Comparação de tarifas no mesmo nível de consumo projetado: Grupo B ficaria em ${brl2(l1.contaGrupoBProjetada)}/mês, Grupo A${mlSufixo} em ${brl2(l1.contaGrupoAProjetada)}/mês.`,
  ].filter(Boolean);

  const tabelaFinanceira = [
    ["Conta atual (Grupo B, consumo de hoje)", brl2(cenarios.contaAtualGrupoB.total)],
    ["Conta Grupo B no consumo projetado (referência)", brl2(l1.contaGrupoBProjetada)],
    [`Conta Grupo A no consumo projetado${mlSufixo}`, brl2(l1.contaGrupoAProjetada)],
    [l1.economiaMensal >= 0 ? "Economia mensal com a migração" : "Custo extra mensal da migração", brl2(Math.abs(l1.economiaMensal))],
    [`Resultado total (${cenarios.linhas.length} anos)`, brl(cenarios.economiaTotalHorizonte)],
    ...(temCarga ? [[`${cargaTipo} (fornecimento + instalação)`, brl(investimento.cargaValor)]] : []),
    ["Investimento de conexão (subestação)", brl(investimento.total - investimento.cargaValor)],
    ["Investimento total (carga + subestação)", brl(investimento.total)],
    ["Payback do investimento total", cenarios.paybackMeses ? `${num(cenarios.paybackMeses, 1)} meses` : "—"],
  ];

  await gerarPropostaPdf({
    subtitulo: `Migração Grupo B → Grupo A${mlSufixo}`,
    codigoProposta: $("m-proposta-codigo").value || "—",
    cliente,
    responsavelNome: $("m-responsavel-nome").value,
    responsavelCargo: $("m-responsavel-cargo").value,
    email: $("m-email").value,
    resumoExecutivo: `Esta proposta avalia a migração de ${cliente} do Grupo B para o Grupo A diante do aumento de carga projetado${temCarga ? ` (${cargaTipo.toLowerCase()})` : ""}, comparando o custo de energia nos dois grupos tarifários no mesmo nível de consumo e o retorno do investimento total necessário (carga + conexão).`,
    diagnostico,
    escopo,
    tabelaFinanceira,
    graficoCanvas: $("m-chart-conta"),
    investimentoTotal: investimento.total,
    formaPagamento: $("m-forma-pagamento").value,
    prazoExecucaoDias: $("m-prazo-execucao").value || "—",
    validadeDias: $("m-validade-proposta").value || "—",
    observacoes: $("m-observacoes").value,
    cronograma: [
      "Etapa 1: projeto elétrico da subestação, ART e solicitação de acesso junto à distribuidora.",
      "Etapa 2: fornecimento e instalação do transformador e obra civil da cabine primária.",
      temCarga ? `Etapa 3: fornecimento e instalação de ${cargaTipo.toLowerCase()}.` : null,
      `Etapa ${temCarga ? 4 : 3}: montagem da medição e proteção, vistoria e energização pela distribuidora.`,
      `Etapa ${temCarga ? 5 : 4}: acompanhamento da primeira fatura como Grupo A e ajuste fino da demanda contratada.`,
    ].filter(Boolean),
    notaRodape:
      "Comparação construída a partir das regras gerais de tarifação Grupo B/Grupo A e Mercado Livre — não há uma planilha de referência específica para este cenário; os valores de tarifa e investimento devem ser ajustados caso a caso com a distribuidora local e um orçamento de engenharia. Não substitui análise técnica detalhada nem estudo de acesso junto à distribuidora.",
    fileName: `proposta-migracao-${(cliente || "cliente").replace(/\s+/g, "-").toLowerCase()}.pdf`,
  });
}

// ---------- Carregador veicular: dimensionamento elétrico (NBR 5410) ----------
let carregadorInited = false;
let ultimoResultadoCarregador = null;

function initCarregador() {
  if (carregadorInited) return;
  carregadorInited = true;

  $("c-ficha-codigo").value = gerarCodigoProposta("EVSE");

  document.querySelectorAll("#painel-carregador input, #painel-carregador select").forEach((el) => {
    el.addEventListener("input", computeCarregador);
  });

  // Enterrado usa solo a 20°C como referência; os demais métodos usam ar a 30°C — atualiza o
  // padrão do campo de temperatura ao trocar de método, a menos que o usuário já tenha digitado
  // um valor próprio (mesmo padrão usado no campo de ICMS por UF).
  $("c-temperatura").addEventListener("input", () => ($("c-temperatura").dataset.touched = "1"));
  $("c-metodo").addEventListener("change", () => {
    if (!$("c-temperatura").dataset.touched) $("c-temperatura").value = $("c-metodo").value === "D" ? 20 : 30;
    computeCarregador();
  });

  $("c-export-pdf").addEventListener("click", exportarPdfCarregador);
  $("c-salvar").addEventListener("click", () => salvarSimulacao("carregador", "painel-carregador", "c-cliente", "c-salvar-status"));

  computeCarregador();
}

function computeCarregador() {
  const potenciaKw = Number($("c-potencia").value) || 0;
  if (potenciaKw === 0) {
    $("c-result-cards").innerHTML = `<div class="sm:col-span-2 lg:col-span-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
      ⚠ Preencha a "Potência do carregador (kW)" para calcular o dimensionamento.
    </div>`;
    $("c-condutores").innerHTML = "";
    $("c-protecoes").innerHTML = "";
    $("c-avisos").innerHTML = "";
    ultimoResultadoCarregador = null;
    return;
  }

  const r = calcularDimensionamentoEletrico({
    potenciaKw,
    tensaoV: Number($("c-tensao").value) || 220,
    tipoLigacao: $("c-ligacao").value,
    fatorPotencia: Number($("c-fp").value) || 0.98,
    fatorContinuidade: Number($("c-fator-continuidade").value) || 1.25,
    material: $("c-material").value,
    distanciaM: Number($("c-distancia").value) || 0,
    quedaMaxPercent: Number($("c-queda-max").value) || 4,
    metodoInstalacao: $("c-metodo").value,
    temperaturaAmbiente: Number($("c-temperatura").value),
    circuitosAgrupados: Number($("c-agrupamento").value) || 1,
  });

  $("c-result-cards").innerHTML = `
    ${cardHtml("Corrente de projeto", `${num(r.correnteProjeto, 1)} A`)}
    ${cardHtml("Seção do cabo (fase)", `${r.secaoFaseMm2} mm² (${MATERIAIS_CONDUTOR_LABEL[r.material]})`)}
    ${cardHtml("Disjuntor recomendado", `${r.disjuntorA} A · curva ${r.disjuntorCurva}`)}
    ${cardHtml("Queda de tensão calculada", `${num(r.quedaTensaoPercent, 2)}%`)}
  `;

  $("c-condutores").innerHTML = `
    ${linhaHtml("Material do condutor", MATERIAIS_CONDUTOR_LABEL[r.material])}
    ${linhaHtml("Corrente nominal do carregador", `${num(r.correnteNominal, 1)} A`)}
    ${linhaHtml(`Corrente de projeto (carga contínua, ×${num(r.fatorContinuidade, 2)})`, `${num(r.correnteProjeto, 1)} A`)}
    ${linhaHtml("Fator de correção (temp. × agrupamento)", num(r.fatorTemp * r.fatorAgrup, 2))}
    ${linhaHtml("Seção do cabo — fase", `${r.secaoFaseMm2} mm²`)}
    ${linhaHtml("Seção do cabo — neutro", `${r.secaoNeutroMm2} mm²`)}
    ${linhaHtml("Seção do cabo — terra (PE)", `${r.secaoTerraMm2} mm²`)}
    ${linhaHtml("Capacidade de condução corrigida (Iz)", `${num(r.capacidadeCaboA, 1)} A`)}
    ${linhaHtml("Eletroduto recomendado", r.eletroduto)}
  `;

  $("c-protecoes").innerHTML = `
    ${linhaHtml("Disjuntor", `${r.disjuntorA} A, curva ${r.disjuntorCurva}`)}
    ${linhaHtml("DPS", `Classe ${r.dps.classe} · Uc ${r.dps.ucV} V · In ${r.dps.inKa} kA · Imáx ${r.dps.imaxKa} kA`)}
    ${linhaHtml("DR (proteção diferencial-residual)", `Tipo ${r.dr.tipo} · ${r.dr.sensibilidadeMa} mA · ${r.dr.nominalA} A`)}
  `;

  $("c-avisos").innerHTML = r.avisos.length
    ? r.avisos.map((a) => `<div class="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 mb-2">⚠ ${a}</div>`).join("")
    : "";

  ultimoResultadoCarregador = r;
}

async function exportarPdfCarregador() {
  if (!ultimoResultadoCarregador) return;
  const r = ultimoResultadoCarregador;
  const cliente = $("c-cliente").value || "Cliente";

  const parametros = [
    ["Potência do carregador", `${num(Number($("c-potencia").value), 1)} kW`],
    ["Tensão de alimentação", `${$("c-tensao").value} V`],
    ["Tipo de ligação", $("c-ligacao").selectedOptions[0].text],
    ["Fator de potência (cosφ)", num(Number($("c-fp").value), 2)],
    ["Fator de continuidade (carga contínua)", `×${num(r.fatorContinuidade, 2)}`],
    ["Material do condutor", MATERIAIS_CONDUTOR_LABEL[r.material]],
    ["Distância do QDC ao carregador", `${num(Number($("c-distancia").value), 1)} m`],
    ["Método de instalação", $("c-metodo").selectedOptions[0].text],
    ["Temperatura ambiente/solo", `${num(Number($("c-temperatura").value), 0)} °C`],
    ["Circuitos agrupados", $("c-agrupamento").value],
    ["Queda de tensão máxima admissível", `${num(Number($("c-queda-max").value), 1)}%`],
  ];

  const resultado = [
    ["Corrente nominal do carregador", `${num(r.correnteNominal, 1)} A`],
    ["Corrente de projeto", `${num(r.correnteProjeto, 1)} A`],
    ["Fator de correção (temp. × agrupamento)", num(r.fatorTemp * r.fatorAgrup, 2)],
    ["Seção do cabo — fase", `${r.secaoFaseMm2} mm²`],
    ["Seção do cabo — neutro", `${r.secaoNeutroMm2} mm²`],
    ["Seção do cabo — terra (PE)", `${r.secaoTerraMm2} mm²`],
    ["Capacidade de condução corrigida (Iz)", `${num(r.capacidadeCaboA, 1)} A`],
    ["Eletroduto recomendado", r.eletroduto],
    ["Queda de tensão calculada", `${num(r.quedaTensaoPercent, 2)}%`],
  ];

  const protecoes = [
    ["Disjuntor", `${r.disjuntorA} A, curva ${r.disjuntorCurva}`],
    ["DPS", `Classe ${r.dps.classe} · Uc ${r.dps.ucV} V · In ${r.dps.inKa} kA · Imáx ${r.dps.imaxKa} kA`],
    ["DR (proteção diferencial-residual)", `Tipo ${r.dr.tipo} · ${r.dr.sensibilidadeMa} mA · ${r.dr.nominalA} A`],
  ];

  await gerarDatasheetPdf({
    subtitulo: "Dimensionamento Elétrico — Carregador Veicular (NBR 5410)",
    codigo: $("c-ficha-codigo").value || "—",
    cliente,
    responsavelNome: $("c-responsavel-nome").value,
    responsavelCargo: $("c-responsavel-cargo").value,
    email: $("c-email").value,
    introducao: `Ficha técnica de referência para o circuito dedicado do carregador veicular de ${cliente}, dimensionado a partir dos critérios gerais da NBR 5410 (ampacidade, quedas de tensão e proteções).${$("c-observacoes").value ? ` Observações: ${$("c-observacoes").value}` : ""}`,
    tabelas: [
      { titulo: "1. Parâmetros de Entrada", head: ["Parâmetro", "Valor"], body: parametros },
      { titulo: "2. Condutores e Eletroduto", head: ["Item", "Especificação"], body: resultado },
      { titulo: "3. Proteções", head: ["Item", "Especificação"], body: protecoes },
    ],
    avisos: r.avisos,
    notaRodape:
      "Dimensionamento de referência a partir dos critérios gerais da NBR 5410 (ampacidade — métodos B1/C/D/F, isolação PVC 70°C — e fatores de correção de temperatura/agrupamento), para pré-orçamento e conversa comercial. Não substitui projeto elétrico executivo assinado por engenheiro responsável (ART). Ampacidade e resistividade do alumínio estimadas a partir da tabela de cobre (fator ~0,78) — confirme com a tabela oficial. Conexões em alumínio exigem conectores bimetálicos e composto antioxidante. DR fixado em Tipo A partindo do princípio de que o carregador já traz proteção interna Tipo B/RDC-DD — confirme na ficha técnica do equipamento. Confirme sempre seção final, disjuntor, DPS e DR com o projetista responsável.",
    fileName: `ficha-tecnica-carregador-${(cliente || "cliente").replace(/\s+/g, "-").toLowerCase()}.pdf`,
  });
}
