import { MESES, calcularDimensionamento, calcularAreaModulos, calcularModulosQueCabem, calcularCapex, calcularContaMes1, calcularPayback } from "../lib/dimensionamentoSolar.js";
import { calcularBESS, calcularCenariosGrupoA } from "../lib/dimensionamentoBESS.js";
import { gerarPropostaPdf } from "./pdfProposta.js";

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

// ---------- Seleção de grupo tarifário ----------
document.querySelectorAll(".grupo-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("grupo-selector").classList.add("hidden");
    $("simulacoes-salvas-wrap").classList.add("hidden");
    if (btn.dataset.grupo === "B") {
      $("painel-solar").classList.remove("hidden");
      initSolar();
    } else {
      $("painel-bess").classList.remove("hidden");
      initBess();
    }
  });
});
document.querySelectorAll(".voltar-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("painel-solar").classList.add("hidden");
    $("painel-bess").classList.add("hidden");
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
  } else {
    $("painel-bess").classList.remove("hidden");
    initBess();
    aplicarCamposPainel("painel-bess", row.dados);
    computeBess();
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
          <span class="text-[10px] font-bold uppercase tracking-wide ${r.tipo === "solar" ? "text-maia-blue-dark" : "text-maia-orange-dark"}">${r.tipo === "solar" ? "Grupo B · Solar" : "Grupo A · BESS"}</span>
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

  computeSolar();
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
  if (consumoMensal.every((v) => v === 0)) return;

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
  let area = calcularAreaModulos(dim.potenciaEscolhidaKwp, moduloParams);
  const tipoInstalacao = $("s-tipo-instalacao").value;
  const areaDisponivel = Number($("s-area-disponivel").value) || 0;
  let limitadoPorArea = false;
  const potenciaDesejadaKwp = dim.potenciaEscolhidaKwp;

  if (areaDisponivel > 0) {
    const areaNecessariaEscolhida = tipoInstalacao === "solo" ? area.areaNecessariaSolo : area.areaNecessariaTelhado;
    const cabe = areaDisponivel >= areaNecessariaEscolhida;
    if (cabe) {
      $("s-area-comparacao").innerHTML = `<span class="text-emerald-600 font-semibold">✓ Cabe</span> — sobram ${num(areaDisponivel - areaNecessariaEscolhida, 0)} m² de folga.`;
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

  ultimoResultadoSolar = { dim, area, tipoInstalacao, limitadoPorArea, potenciaDesejadaKwp, capex, tarifas, conta, payback, anoInicial };

  $("s-result-cards").innerHTML = `
    ${cardHtml(limitadoPorArea ? "Potência real (limitada pela área)" : "Potência escolhida", `${num(dim.potenciaEscolhidaKwp, 2)} kWp`)}
    ${cardHtml("Geração média mensal", `${num(dim.geracaoMedia, 0)} kWh`)}
    ${cardHtml("Autonomia do sistema", pct(dim.autonomiaPercent))}
    ${cardHtml("Valor final do sistema", brl(capex.valorFinalCliente))}
  `;

  $("s-conta-mes1").innerHTML = `
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
  const { dim, area, tipoInstalacao, limitadoPorArea, potenciaDesejadaKwp, capex, conta, payback } = ultimoResultadoSolar;
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
    investimentoTotal: capex.valorFinalCliente,
    formaPagamento: $("s-forma-pagamento").value,
    prazoExecucaoDias: $("s-prazo-execucao").value || "—",
    validadeDias: $("s-validade-proposta").value || "—",
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

  $("b-export-pdf").addEventListener("click", exportarPdfBess);
  $("b-salvar").addEventListener("click", () => salvarSimulacao("bess", "painel-bess", "b-cliente", "b-salvar-status"));

  computeBess();
}

function computeBess() {
  const consumoPontaMensal = Number($("b-energia-ponta").value) || 0;
  if (consumoPontaMensal === 0) return;

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
