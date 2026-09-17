import { MESES, calcularDimensionamento, calcularCapex, calcularContaMes1, calcularPayback } from "../lib/dimensionamentoSolar.js";
import { calcularBESS, calcularCenariosGrupoA } from "../lib/dimensionamentoBESS.js";

const $ = (id) => document.getElementById(id);
const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pct = (n) => (Number(n) * 100 || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const num = (n, casas = 1) => (Number(n) || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });

// ---------- Seleção de grupo tarifário ----------
document.querySelectorAll(".grupo-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("grupo-selector").classList.add("hidden");
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
  });
});

// ============================================================
// GRUPO B — SOLAR
// ============================================================
let solarInited = false;
let cidades = null;
let chartGeracao, chartPayback;

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

  // Grids de consumo e irradiação
  const consumoDefaults = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const irradiacaoDefaults = [4.7, 5.25, 4.82, 4.7, 4.21, 4.13, 4.15, 4.99, 4.46, 4.6, 4.66, 5.01];
  const consumoGrid = $("s-consumo-grid");
  const irradiacaoGrid = $("s-irradiacao-grid");
  MESES.forEach((mes, i) => {
    consumoGrid.insertAdjacentHTML(
      "beforeend",
      `<div><label class="block text-[10px] text-slate-400">${mes}</label><input data-consumo-idx="${i}" type="number" value="${consumoDefaults[i]}" class="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></div>`
    );
    irradiacaoGrid.insertAdjacentHTML(
      "beforeend",
      `<div><label class="block text-[10px] text-slate-400">${mes}</label><input data-irr-idx="${i}" type="number" step="0.01" value="${irradiacaoDefaults[i]}" class="w-full rounded border border-slate-300 px-1.5 py-1 text-xs" /></div>`
    );
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
  $("s-cidade").addEventListener("input", () => {
    const match = cidades?.find((c) => `${c.municipio} - ${c.uf}`.toLowerCase() === $("s-cidade").value.toLowerCase());
    if (match) {
      $("s-cidade-info").textContent = `Lat ${match.lat.toFixed(2)}° · Long ${match.lng.toFixed(2)}° · Inclinação ideal sugerida: ${Math.abs(match.lat).toFixed(0)}°`;
    } else {
      $("s-cidade-info").textContent = "";
    }
  });

  $("s-simultaneidade").addEventListener("input", () => {
    $("s-simultaneidade-out").textContent = pct($("s-simultaneidade").value);
    computeSolar();
  });

  document.querySelectorAll("#painel-solar input, #painel-solar select").forEach((el) => {
    el.addEventListener("input", computeSolar);
  });

  $("s-export-pdf").addEventListener("click", exportarPdfSolar);

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

  const dim = calcularDimensionamento({
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

  ultimoResultadoSolar = { dim, capex, tarifas, conta, payback, anoInicial };

  $("s-result-cards").innerHTML = `
    ${cardHtml("Potência escolhida", `${num(dim.potenciaEscolhidaKwp, 2)} kWp`)}
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
      labels: MESES,
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

function exportarPdfSolar() {
  if (!ultimoResultadoSolar) return;
  const { dim, capex, conta, payback, anoInicial } = ultimoResultadoSolar;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 20;
  const cliente = $("s-cliente").value || "Cliente";
  const cidade = $("s-cidade").value || "";

  doc.setFontSize(16);
  doc.setTextColor(11, 61, 98);
  doc.text("Proposta Comercial — Sistema de Energia Solar", 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Cliente: ${cliente}    Cidade: ${cidade}    Data: ${new Date().toLocaleDateString("pt-BR")}`, 14, y);
  y += 10;

  const linha = (label, value) => {
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(label, 14, y);
    doc.text(value, 140, y);
    y += 7;
  };
  const titulo = (t) => {
    y += 3;
    doc.setFontSize(12);
    doc.setTextColor(11, 61, 98);
    doc.text(t, 14, y);
    doc.setDrawColor(245, 166, 35);
    doc.line(14, y + 1.5, 196, y + 1.5);
    y += 8;
  };

  titulo("Dimensionamento");
  linha("Potência escolhida", `${num(dim.potenciaEscolhidaKwp, 2)} kWp`);
  linha("Geração média mensal", `${num(dim.geracaoMedia, 0)} kWh`);
  linha("Consumo médio mensal", `${num(dim.consumoMedioMensal, 0)} kWh`);
  linha("Autonomia do sistema", pct(dim.autonomiaPercent));

  titulo("Retorno Financeiro");
  linha("Conta sem solar (mês)", brl2(conta.contaSemSolar));
  linha("Conta com solar (mês)", brl2(conta.contaComSolar));
  linha("Economia mensal", `${brl2(conta.descontoReais)} (${pct(conta.descontoPercent)})`);
  linha("Economia anual (ano 1)", brl(conta.economiaAnual));

  titulo("Investimento");
  linha("Valor final do sistema", brl(capex.valorFinalCliente));
  linha("Payback simples", `${num(payback.paybackSimples, 1)} anos`);
  linha("ROI", pct(payback.roi));
  linha("TIR", payback.irr != null ? pct(payback.irr) : "—");
  linha("VPL", brl(payback.vpl));

  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("Estimativas baseadas em dados informados pelo cliente e índices de irradiação da região. Não substitui análise técnica detalhada.", 14, y, { maxWidth: 182 });

  doc.save(`proposta-solar-${(cliente || "cliente").replace(/\s+/g, "-").toLowerCase()}.pdf`);
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

  const cards = [
    cardHtml("Potência BESS", `${num(bess.potenciaRecomendadaKw, 1)} kW`),
    cardHtml("Capacidade BESS", `${num(bess.capacidadeFinalKwh, 1)} kWh`),
    cardHtml("Economia mensal (ano 1)", brl(cenarios.economiaMensalAno1)),
    cardHtml(
      modoAquisicao === "capex" ? "Payback" : "Economia total do horizonte",
      modoAquisicao === "capex" ? (cenarios.paybackMeses ? `${num(cenarios.paybackMeses, 1)} meses` : "—") : brl(cenarios.economiaTotalHorizonte)
    ),
  ];
  if (modoAquisicao === "eaas" && cenarios.lucroReal) {
    const l1 = cenarios.linhas[0];
    cards.push(cardHtml("Mensalidade EaaS (nominal)", brl2(l1.mensalidadeEaasNominal)));
    cards.push(cardHtml("Mensalidade EaaS (líquida, Lucro Real)", brl2(l1.mensalidadeEaasLiquida)));
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

function exportarPdfBess() {
  if (!ultimoResultadoBess) return;
  const { bess, cenarios, modoAquisicao } = ultimoResultadoBess;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 20;
  const cliente = $("b-cliente").value || "Cliente";

  doc.setFontSize(16);
  doc.setTextColor(11, 61, 98);
  doc.text("Proposta Comercial — Eficiência Energética + BESS", 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Cliente: ${cliente}    Data: ${new Date().toLocaleDateString("pt-BR")}`, 14, y);
  y += 10;

  const linha = (label, value) => {
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(label, 14, y);
    doc.text(value, 140, y);
    y += 7;
  };
  const titulo = (t) => {
    y += 3;
    doc.setFontSize(12);
    doc.setTextColor(11, 61, 98);
    doc.text(t, 14, y);
    doc.setDrawColor(245, 166, 35);
    doc.line(14, y + 1.5, 196, y + 1.5);
    y += 8;
  };

  titulo("Dimensionamento do BESS");
  linha("Potência recomendada", `${num(bess.potenciaRecomendadaKw, 1)} kW`);
  linha("Capacidade recomendada", `${num(bess.capacidadeFinalKwh, 1)} kWh`);

  titulo(`Cenário Ano 1${cenarios.usarMercadoLivre ? " — com migração para Mercado Livre" : " — mercado regulado"}`);
  linha("Conta atual (mês)", brl2(cenarios.linhas[0].contaAtual));
  linha(`Conta com BESS${cenarios.usarMercadoLivre ? " + Mercado Livre" : ""} (mês)`, brl2(cenarios.linhas[0].contaComBess));
  linha("Economia mensal", brl2(cenarios.economiaMensalAno1));
  linha("Economia anual", brl(cenarios.linhas[0].economiaAnual));

  titulo("Investimento");
  if (modoAquisicao === "capex") {
    linha("Investimento", brl(cenarios.investimento));
    linha("Payback", cenarios.paybackMeses ? `${num(cenarios.paybackMeses, 1)} meses` : "—");
  } else {
    linha("Modelo", "Assinatura (EaaS) — sem investimento inicial");
    linha("Mensalidade (nominal)", brl2(cenarios.linhas[0].mensalidadeEaasNominal));
    if (cenarios.lucroReal) {
      linha("Créditos PIS/COFINS + IRPJ/CSLL", pct(1 - cenarios.fatorCreditoTributario));
      linha("Mensalidade líquida (Lucro Real)", brl2(cenarios.linhas[0].mensalidadeEaasLiquida));
    }
  }
  linha(`Economia total (${cenarios.linhas.length} anos)`, brl(cenarios.economiaTotalHorizonte));

  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(
    "Estimativas baseadas em dados informados pelo cliente. A efetividade do BESS em cobrir a energia de ponta decai ao longo da vida útil da bateria. O crédito tributário sobre a mensalidade EaaS (Lucro Real) é uma estimativa e depende do enquadramento fiscal real do cliente — consulte a contabilidade dele antes de apresentar como garantido. Não substitui análise técnica detalhada.",
    14,
    y,
    { maxWidth: 182 }
  );

  doc.save(`proposta-bess-${(cliente || "cliente").replace(/\s+/g, "-").toLowerCase()}.pdf`);
}
