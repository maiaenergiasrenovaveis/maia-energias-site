// Motor de cálculo de dimensionamento solar + viabilidade financeira (Lei 14.300).
// Portado célula a célula da planilha de referência da Trineva (PLANILHA_DIMENSIONAMENTO_ORCAMENTO.xlsx),
// validado numericamente contra os valores em cache do arquivo original.

export const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

// Cronograma de fio B da Lei 14.300/2022 (% da tarifa de fio B cobrada sobre energia injetada).
// A partir de 2028 a cobrança é integral (100%).
const FIO_B_SCHEDULE = { 2023: 0.15, 2024: 0.3, 2025: 0.45, 2026: 0.6, 2027: 0.75 };
export function fioBPercent(ano) {
  if (ano in FIO_B_SCHEDULE) return FIO_B_SCHEDULE[ano];
  if (ano < 2023) return 0;
  return 1;
}

// Taxa de disponibilidade mínima (kWh) por tipo de ligação.
export function taxaDisponibilidadeKwh(rede) {
  return { Monofásica: 30, Bifásica: 50, Trifásica: 100 }[rede] ?? 100;
}

/**
 * Dimensionamento do sistema (aba "Dimensionamento").
 * @param {object} p
 * @param {number[]} p.consumoMensal - até 12 valores de consumo (kWh), média histórica
 * @param {string} p.rede - 'Monofásica' | 'Bifásica' | 'Trifásica'
 * @param {number[]} p.irradiacaoMensal - 12 valores kWh/m².dia (Índice de Sol Pleno)
 * @param {number} p.perdas - fração (ex: 0.23)
 * @param {number} p.perdasAdicionais - fração (orientação/sombreamento)
 * @param {number|null} p.potenciaEscolhidaKwp - override manual (kWp); se null, usa a sugerida
 */
export function calcularDimensionamento(p) {
  const taxaDisp = taxaDisponibilidadeKwh(p.rede);
  const consumoMedioMensal = p.consumoMensal.reduce((a, b) => a + b, 0) / p.consumoMensal.length;
  const consumoMedioDiario = consumoMedioMensal / 30;
  const consumoSemTaxa = consumoMedioMensal - taxaDisp;

  const irradiacaoMedia = p.irradiacaoMensal.reduce((a, b) => a + b, 0) / p.irradiacaoMensal.length;
  const fatorPerdas = 1 - (p.perdas + p.perdasAdicionais);

  // R21: potência necessária para cobrir o consumo médio diário (sem a taxa mínima)
  const potenciaSugeridaKwp = consumoSemTaxa / 30 / (irradiacaoMedia * fatorPerdas);
  const potenciaEscolhidaKwp = p.potenciaEscolhidaKwp ?? potenciaSugeridaKwp;

  // Geração mensal (Q34:Q45): potência escolhida x irradiação do mês x 30 dias x fator de perdas
  const geracaoMensal = p.irradiacaoMensal.map((irr) => potenciaEscolhidaKwp * irr * 30 * fatorPerdas);
  const geracaoMedia = geracaoMensal.reduce((a, b) => a + b, 0) / geracaoMensal.length;

  const diferencaGeracaoConsumo = geracaoMedia - consumoSemTaxa;
  // D36: kWh ainda pago na conta (SUMIF das duas parcelas negativas: déficit de geração e taxa mínima)
  const kwhPagoNaConta = -(Math.min(diferencaGeracaoConsumo, 0) + Math.min(-taxaDisp, 0));

  const autonomiaPercent = (taxaDisp + geracaoMedia) / consumoMedioMensal;

  return {
    taxaDisp,
    consumoMedioMensal,
    consumoMedioDiario,
    consumoSemTaxa,
    irradiacaoMedia,
    fatorPerdas,
    potenciaSugeridaKwp,
    potenciaEscolhidaKwp,
    geracaoMensal,
    geracaoMedia,
    kwhPagoNaConta,
    autonomiaPercent,
  };
}

// Fator de utilização da área (área ocupada / área total necessária) por tipo de instalação.
// Telhado: módulos ficam praticamente contíguos (só folga de manutenção/borda) — pouca perda de área.
// Solo: fileiras precisam de espaçamento maior entre si pra não sombrear a fileira de trás —
// regra prática do mercado (~1,7-2,2x a área dos módulos, dependendo da latitude/inclinação).
export const FATOR_UTILIZACAO_AREA = { telhado: 0.7, solo: 0.5 };

/**
 * Número de módulos e área necessária a partir da potência ESCOLHIDA do sistema
 * (não recalcula a potência — usa a mesma já decidida em calcularDimensionamento).
 * @param {number} potenciaEscolhidaKwp
 * @param {object} p
 * @param {number} p.moduloWp - potência do módulo (Wp), default 650
 * @param {number} p.moduloAreaM2 - área do módulo (m²), default 3.055
 */
export function calcularAreaModulos(potenciaEscolhidaKwp, p) {
  const moduloWp = p.moduloWp ?? 650;
  const moduloAreaM2 = p.moduloAreaM2 ?? 3.055;
  const numeroModulos = Math.ceil((potenciaEscolhidaKwp * 1000) / moduloWp);
  const areaCoberta = numeroModulos * moduloAreaM2;
  return {
    numeroModulos,
    areaCoberta,
    areaNecessariaTelhado: areaCoberta / FATOR_UTILIZACAO_AREA.telhado,
    areaNecessariaSolo: areaCoberta / FATOR_UTILIZACAO_AREA.solo,
  };
}

/**
 * Quantos módulos cabem numa área real disponível, pro tipo de instalação escolhido
 * (inverso de calcularAreaModulos: aqui a área é o limite, não a potência).
 * @param {number} areaDisponivelM2
 * @param {"telhado"|"solo"} tipoInstalacao
 * @param {object} p
 * @param {number} p.moduloWp
 * @param {number} p.moduloAreaM2
 */
export function calcularModulosQueCabem(areaDisponivelM2, tipoInstalacao, p) {
  const moduloWp = p.moduloWp ?? 650;
  const moduloAreaM2 = p.moduloAreaM2 ?? 3.055;
  const fator = FATOR_UTILIZACAO_AREA[tipoInstalacao] ?? FATOR_UTILIZACAO_AREA.telhado;
  const areaCobertaPossivel = areaDisponivelM2 * fator;
  const numeroModulos = Math.floor(areaCobertaPossivel / moduloAreaM2);
  const potenciaMaximaKwp = (numeroModulos * moduloWp) / 1000;
  return { numeroModulos, potenciaMaximaKwp };
}

/**
 * CAPEX / precificação (bloco "CUSTOS" da aba "Dados Iniciais").
 */
export function calcularCapex(c) {
  const lucroEquipamento = c.valorKit * c.lucroEquipamentoPercent;
  const margem = c.valorKit * c.margemPercent;
  const maoDeObra = lucroEquipamento + c.materialInstalacaoAc + c.projetoArt + c.instalacao + c.frete + c.outros + margem;
  const impostoMaoDeObra = maoDeObra * c.impostoMaoDeObraPercent;
  const valorFinalCliente = c.valorKit + lucroEquipamento + c.materialInstalacaoAc + c.projetoArt + c.instalacao + c.frete + c.outros + margem + impostoMaoDeObra;
  return { lucroEquipamento, margem, maoDeObra, impostoMaoDeObra, valorFinalCliente };
}

/**
 * Conta de energia mês 1: sem solar vs com solar (aba "CONTA NOVA LEI"), Lei 14.300.
 */
export function calcularContaMes1(dim, tarifas, ano) {
  const kwh = dim.consumoMedioMensal;
  // A planilha original assume implicitamente que o sistema gera o suficiente pra
  // cobrir todo o consumo (comum quando dimensionado pela própria demanda) — mas
  // quando a potência é menor que o ideal (ex: limitada pela área do local), só a
  // fração realmente coberta pela geração entra na compensação da Lei 14.300; o
  // restante é cobrado à tarifa cheia, sem nenhum benefício. Prorateando por essa
  // cobertura (em vez de recalcular as bases do zero) mantém as duas fórmulas
  // originais intactas quando o sistema já é adequado (cobertura = 100%).
  const coberturaGeracao = dim.consumoSemTaxa > 0 ? Math.min(1, dim.geracaoMedia / dim.consumoSemTaxa) : 0;
  const consumoNaoCompensado = dim.consumoSemTaxa * (1 - coberturaGeracao);

  // Duas bases distintas de "kWh injetado" (replicadas literalmente da planilha),
  // agora prorateadas pela cobertura real de geração:
  // (1) para o crédito de TUSD/ICMS: consumo - taxa de disponibilidade (kWh)
  // (2) para a cobrança de Fio B: consumo × (1 - % simultaneidade)
  const kwhCreditoTusd = dim.consumoSemTaxa * coberturaGeracao;
  const kwhInjetadoFioB = kwh * (1 - tarifas.simultaneidadePercent) * coberturaGeracao;
  const kwhSimultaneo = kwh * tarifas.simultaneidadePercent;

  const icmsSobreTusdPorKwh = tarifas.tusdSemImposto * tarifas.icmsPercent;
  const fioBPercentAno = fioBPercent(ano);
  const fioBBaseGrossedUp = (fioBPercentAno * tarifas.fioBRate) / ((1 - tarifas.icmsPercent) * (1 - tarifas.pisCofinsPercent));

  // Conta sem solar (D35): TE + TUSD (com imposto) sobre todo o consumo + iluminação pública
  const semSolarTe = kwh * tarifas.teComImposto;
  const semSolarTusd = kwh * tarifas.tusdComImposto;
  const contaSemSolar = semSolarTe + semSolarTusd + tarifas.iluminacaoPublica;

  // Conta com solar (F35): ICMS s/TUSD do crédito + tarifa mínima + iluminação pública + fio B
  // sobre o injetado + o que não foi compensado (sistema menor que o consumo), à tarifa cheia.
  const creditoTusd = kwhCreditoTusd * tarifas.tusdComImposto;
  const icmsSobreTusdCredito = creditoTusd * icmsSobreTusdPorKwh;
  const tarifaMinima = dim.taxaDisp * (tarifas.teComImposto + tarifas.tusdComImposto);
  const fioB = kwhInjetadoFioB * fioBBaseGrossedUp;
  const custoNaoCompensado = consumoNaoCompensado * (tarifas.teComImposto + tarifas.tusdComImposto);
  const contaComSolar = icmsSobreTusdCredito + tarifaMinima + tarifas.iluminacaoPublica + fioB + custoNaoCompensado;

  const descontoReais = contaSemSolar - contaComSolar;
  const descontoPercent = descontoReais / contaSemSolar;

  return {
    kwh,
    kwhCreditoTusd,
    kwhInjetadoFioB,
    kwhSimultaneo,
    consumoNaoCompensado,
    contaSemSolar,
    contaComSolar,
    descontoReais,
    descontoPercent,
    economiaAnual: descontoReais * 12,
    fioBBaseGrossedUp,
  };
}

/**
 * Viabilidade financeira 25 anos (aba "PAYBACK NOVA LEI").
 */
export function calcularPayback(dim, tarifas, capex, anoInicial, financeiro) {
  const horizonte = financeiro.horizonteAnos ?? 25;
  const taxaInflacaoEnergia = financeiro.taxaInflacaoEnergia ?? 0.1;
  const tma = financeiro.tma ?? 0.1;
  const investimento = capex.valorFinalCliente;

  // Mesmo ajuste de calcularContaMes1: sem isso, o payback assumiria que o sistema
  // sempre cobre 100% do consumo, mesmo quando a potência ficou menor que o ideal
  // (ex: limitada pela área do local).
  const coberturaGeracao = dim.consumoSemTaxa > 0 ? Math.min(1, dim.geracaoMedia / dim.consumoSemTaxa) : 0;
  const kwhInjetado = dim.consumoMedioMensal * (1 - tarifas.simultaneidadePercent) * coberturaGeracao;
  const icmsSobreTusdPorKwh = tarifas.tusdSemImposto * tarifas.icmsPercent;

  const linhas = [];
  let economiaAcumulada = 0;
  let economiaAcumuladaDescontada = 0;
  let contaSemSistemaAnual = dim.consumoMedioMensal * (tarifas.teSemImposto + tarifas.tusdSemImposto) * 12;
  let taxaDispAnualAtual = 12 * dim.taxaDisp * (tarifas.teSemImposto + tarifas.tusdSemImposto);
  let custoNaoCompensadoAnualAtual = dim.consumoSemTaxa * (1 - coberturaGeracao) * (tarifas.teSemImposto + tarifas.tusdSemImposto) * 12;

  for (let i = 0; i < horizonte; i++) {
    const ano = anoInicial + i;
    const anoRelativo = i + 1;
    if (i > 0) {
      contaSemSistemaAnual *= 1 + taxaInflacaoEnergia;
      taxaDispAnualAtual *= 1 + taxaInflacaoEnergia;
      custoNaoCompensadoAnualAtual *= 1 + taxaInflacaoEnergia;
    }
    const fioBDescontoRate = fioBPercent(ano) * tarifas.fioBRate;
    const contaComSistemaAnual =
      taxaDispAnualAtual +
      tarifas.iluminacaoPublica * 12 +
      kwhInjetado * icmsSobreTusdPorKwh * 12 +
      kwhInjetado * fioBDescontoRate * 12 +
      custoNaoCompensadoAnualAtual;

    const economia = contaSemSistemaAnual - contaComSistemaAnual;
    economiaAcumulada += economia;
    const economiaDescontada = economia / Math.pow(1 + tma, anoRelativo);
    economiaAcumuladaDescontada += economiaDescontada;

    linhas.push({
      ano,
      anoRelativo,
      contaSemSistema: contaSemSistemaAnual,
      contaComSistema: contaComSistemaAnual,
      economia,
      economiaAcumulada,
      economiaAcumuladaDescontada,
      saldoPositivo: economiaAcumuladaDescontada - investimento > 0,
    });
  }

  const fluxoCaixa = [-investimento, ...linhas.map((l) => l.economia)];
  const paybackSimples = investimento / linhas[0].economia;
  // ROI (C24): (economia nominal acumulada em 25 anos - investimento) / investimento
  const roi = (economiaAcumulada - investimento) / investimento;
  const irr = calcularTir(fluxoCaixa);
  const vpl = calcularVpl(tma, linhas.map((l) => l.economia)) - investimento;

  // Payback descontado: primeiro ano em que a economia acumulada descontada supera o investimento
  const anoPaybackDescontado = linhas.find((l) => l.economiaAcumuladaDescontada >= investimento)?.anoRelativo ?? null;

  return { linhas, investimento, paybackSimples, roi, irr, vpl, anoPaybackDescontado, economiaTotal25anos: economiaAcumulada };
}

function calcularVpl(taxa, fluxos) {
  return fluxos.reduce((acc, cf, i) => acc + cf / Math.pow(1 + taxa, i + 1), 0);
}

function calcularTir(fluxos) {
  let lo = -0.99,
    hi = 5.0;
  const npvAt = (r) => fluxos.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
  if (npvAt(lo) * npvAt(hi) > 0) return null;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const v = npvAt(mid);
    if (Math.abs(v) < 1e-6) return mid;
    if (npvAt(lo) * v < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
