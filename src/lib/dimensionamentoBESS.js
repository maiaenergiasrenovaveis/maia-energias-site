// Motor de cálculo para clientes Grupo A (alta tensão, tarifa binômia com demanda contratada):
// dimensionamento de BESS (peak shaving) e comparação de cenários de conta de energia.
// Portado das planilhas de referência Italac (RO) e Caio (MG) — "Usinas sem Capex".

// Curva de efetividade do BESS em cobrir a energia de ponta ao longo dos anos (degradação da bateria).
// Ano 1 = 100% da energia de ponta é coberta pela bateria; cai progressivamente até ~80% no ano 11.
// Fonte: planilha Italac, aba "10 anos In-Volt" (percentuais ano a ano hardcoded pelo fabricante do BESS).
export const CURVA_EFETIVIDADE_BESS = [1, 0.971, 0.948, 0.927, 0.907, 0.888, 0.87, 0.852, 0.834, 0.817, 0.799];

export function efetividadeBessNoAno(anoRelativo) {
  const idx = anoRelativo - 1;
  if (idx < CURVA_EFETIVIDADE_BESS.length) return CURVA_EFETIVIDADE_BESS[idx];
  return CURVA_EFETIVIDADE_BESS[CURVA_EFETIVIDADE_BESS.length - 1];
}

/**
 * Dimensionamento do banco de baterias (aba "Dimensionamento BESS").
 * @param {object} p
 * @param {number} p.consumoPontaMensal - kWh consumidos na janela de ponta, por mês
 * @param {number} p.diasUteis - default 21
 * @param {number} p.horasPonta - duração da janela de ponta (h/dia), default 3
 * @param {number} p.margemPotencia - default 0.2
 * @param {number} p.rte - round-trip efficiency, default 0.9
 * @param {number} p.dod - depth of discharge, default 0.9
 * @param {number} p.margemCapacidade - reserva para envelhecimento, default 0.15
 */
export function calcularBESS(p) {
  const diasUteis = p.diasUteis ?? 21;
  const horasPonta = p.horasPonta ?? 3;
  const margemPotencia = p.margemPotencia ?? 0.2;
  const rte = p.rte ?? 0.9;
  const dod = p.dod ?? 0.9;
  const margemCapacidade = p.margemCapacidade ?? 0.15;

  const consumoDiario = p.consumoPontaMensal / diasUteis;
  const potenciaMedia = consumoDiario / horasPonta;
  const potenciaRecomendadaKw = potenciaMedia * (1 + margemPotencia);
  const energiaRecargaDiaria = consumoDiario / rte;
  const capacidadeNominalKwh = consumoDiario / dod;
  const capacidadeFinalKwh = capacidadeNominalKwh * (1 + margemCapacidade);

  return {
    consumoDiario,
    potenciaMedia,
    potenciaRecomendadaKw,
    energiaRecargaDiaria,
    capacidadeNominalKwh,
    capacidadeFinalKwh,
  };
}

/**
 * Conta de energia Grupo A para um cenário específico em um dado ano.
 * @param {object} c - componentes da conta
 * @param {number} c.energiaPontaKwh
 * @param {number} c.energiaForaPontaKwh
 * @param {number} c.tarifaPonta - R$/kWh
 * @param {number} c.tarifaForaPonta - R$/kWh
 * @param {number} c.demandaContratadaKw
 * @param {number} c.tarifaDemanda - R$/kW
 * @param {number} c.reativoExcedente - R$/mês (opcional)
 * @param {number} c.iluminacaoPublica - R$/mês
 * @param {number} c.outros - R$/mês
 * @param {boolean} c.mercadoLivre - se true, usa tarifaMercadoLivre em vez das tarifas ponta/fora ponta
 * @param {number} c.tarifaMercadoLivre - R$/kWh
 */
export function calcularContaGrupoA(c) {
  const energiaTotal = c.energiaPontaKwh + c.energiaForaPontaKwh;
  const custoEnergia = c.mercadoLivre
    ? energiaTotal * c.tarifaMercadoLivre
    : c.energiaPontaKwh * c.tarifaPonta + c.energiaForaPontaKwh * c.tarifaForaPonta;
  const custoDemanda = c.demandaContratadaKw * c.tarifaDemanda;
  const total = custoEnergia + custoDemanda + (c.reativoExcedente ?? 0) + (c.iluminacaoPublica ?? 0) + (c.outros ?? 0);
  return { custoEnergia, custoDemanda, total };
}

/**
 * Compara os cenários "Atual" vs "Com BESS" (vs "Com BESS + Mercado Livre" opcional) ao longo do horizonte,
 * aplicando reajuste tarifário anual e a curva de efetividade do BESS.
 * @param {object} p - ver campos abaixo
 */
export function calcularCenariosGrupoA(p) {
  const horizonte = p.horizonteAnos ?? 10;
  const reajusteTarifario = p.reajusteTarifario ?? 0.125; // +12,5% a.a. observado nas planilhas de referência
  const ipca = p.ipca ?? 0.0514;

  const base = {
    energiaPontaKwh: p.energiaPontaKwh,
    energiaForaPontaKwh: p.energiaForaPontaKwh,
    demandaContratadaKw: p.demandaContratadaKw,
    tarifaDemanda: p.tarifaDemanda,
    reativoExcedente: p.reativoExcedente ?? 0,
    iluminacaoPublica: p.iluminacaoPublica ?? 0,
    outros: p.outros ?? 0,
  };

  const linhas = [];
  let tarifaPonta = p.tarifaPonta;
  let tarifaForaPonta = p.tarifaForaPonta;
  let tarifaMercadoLivre = p.tarifaMercadoLivre ?? null;
  let mensalidadeEaas = p.mensalidadeEaasInicial ?? 0;

  for (let i = 0; i < horizonte; i++) {
    const anoRelativo = i + 1;
    if (i > 0) {
      tarifaPonta *= 1 + reajusteTarifario;
      tarifaForaPonta *= 1 + reajusteTarifario;
      if (tarifaMercadoLivre != null) tarifaMercadoLivre *= 1 + reajusteTarifario;
      mensalidadeEaas *= 1 + ipca;
    }

    const atual = calcularContaGrupoA({
      ...base,
      tarifaPonta,
      tarifaForaPonta,
      mercadoLivre: false,
    });

    const efetividade = efetividadeBessNoAno(anoRelativo);
    const comBess = calcularContaGrupoA({
      ...base,
      energiaPontaKwh: base.energiaPontaKwh * (1 - efetividade),
      demandaContratadaKw: p.demandaContratadaKwPosBess ?? base.demandaContratadaKw,
      tarifaPonta,
      tarifaForaPonta,
      mercadoLivre: false,
    });

    let comBessMercadoLivre = null;
    if (p.usarMercadoLivre && tarifaMercadoLivre != null) {
      comBessMercadoLivre = calcularContaGrupoA({
        ...base,
        energiaPontaKwh: base.energiaPontaKwh * (1 - efetividade),
        demandaContratadaKw: p.demandaContratadaKwPosBess ?? base.demandaContratadaKw,
        tarifaMercadoLivre,
        mercadoLivre: true,
      });
    }

    const melhorComBess = comBessMercadoLivre && comBessMercadoLivre.total < comBess.total ? comBessMercadoLivre : comBess;
    const custoComBessTotal = melhorComBess.total + (p.modoAquisicao === "eaas" ? mensalidadeEaas : 0);

    const economiaMensal = atual.total - custoComBessTotal;

    linhas.push({
      ano: (p.anoInicial ?? new Date().getFullYear()) + i,
      anoRelativo,
      efetividadeBess: efetividade,
      contaAtual: atual.total,
      contaComBess: custoComBessTotal,
      usouMercadoLivre: melhorComBess === comBessMercadoLivre,
      mensalidadeEaas: p.modoAquisicao === "eaas" ? mensalidadeEaas : 0,
      economiaMensal,
      economiaAnual: economiaMensal * 12,
    });
  }

  const economiaMensalAno1 = linhas[0].economiaMensal;
  const investimento = p.modoAquisicao === "eaas" ? 0 : p.investimentoBess ?? 0;
  const paybackMeses = investimento > 0 && economiaMensalAno1 > 0 ? investimento / economiaMensalAno1 : null;
  const economiaTotalHorizonte = linhas.reduce((acc, l) => acc + l.economiaAnual, 0);

  return { linhas, economiaMensalAno1, investimento, paybackMeses, economiaTotalHorizonte };
}

/**
 * Comparação de formas de aquisição (aba "Table Data"): à vista, leasing, leasing com benefício tributário.
 * @param {number} investimentoAVista - R$
 * @param {number} economiaMensalBruta - R$/mês
 * @param {object} leasing - { parcelaMensal, parcelaComBeneficio, meses }
 */
export function compararFormasAquisicao(investimentoAVista, economiaMensalBruta, leasing) {
  const aVista = {
    tipo: "à vista",
    investimento: investimentoAVista,
    paybackMeses: investimentoAVista / economiaMensalBruta,
  };
  const leasingPadrao = {
    tipo: "leasing",
    parcelaMensal: leasing.parcelaMensal,
    meses: leasing.meses,
    resultadoMensal: economiaMensalBruta - leasing.parcelaMensal,
  };
  const leasingBeneficio = leasing.parcelaComBeneficio
    ? {
        tipo: "leasing com benefício tributário",
        parcelaMensal: leasing.parcelaComBeneficio,
        meses: leasing.meses,
        resultadoMensal: economiaMensalBruta - leasing.parcelaComBeneficio,
      }
    : null;
  return { aVista, leasingPadrao, leasingBeneficio };
}
