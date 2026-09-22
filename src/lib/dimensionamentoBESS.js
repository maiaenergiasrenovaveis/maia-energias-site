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
 * @param {number} c.tarifaMercadoLivre - R$/kWh (só a energia/TE negociada no Mercado Livre)
 * @param {number} c.tarifaTusd - R$/kWh (fio/TUSD, sempre pago à distribuidora local — mesmo no Mercado Livre)
 */
export function calcularContaGrupoA(c) {
  const energiaTotal = c.energiaPontaKwh + c.energiaForaPontaKwh;
  // No Mercado Livre só a energia (TE) é negociada livremente; o TUSD continua sendo
  // pago à distribuidora local independente de onde a energia é comprada.
  const custoEnergia = c.mercadoLivre
    ? energiaTotal * (c.tarifaMercadoLivre + (c.tarifaTusd ?? 0))
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
  const usarMercadoLivre = !!(p.usarMercadoLivre && p.tarifaMercadoLivre != null);
  // O BESS não é 100% eficiente: pra descarregar X kWh na ponta, ele precisa CARREGAR X/rte kWh
  // antes (a perda de round-trip vira calor, não desaparece) — e essa recarga é puxada da rede
  // fora de ponta (mesma lógica de "energiaRecargaDiaria" já usada no dimensionamento de
  // potência/capacidade em calcularBESS, só que aqui aplicada ao IMPACTO NA CONTA, que antes
  // não considerava essa energia extra nenhuma).
  const rte = p.rte > 0 ? p.rte : 0.9;
  const corrigirReativo = !!p.corrigirReativo;
  const geracaoSolarMensalKwh = p.geracaoSolarMensalKwh ?? 0;

  const base = {
    energiaPontaKwh: p.energiaPontaKwh,
    energiaForaPontaKwh: p.energiaForaPontaKwh,
    demandaContratadaKw: p.demandaContratadaKw,
    tarifaDemanda: p.tarifaDemanda,
    reativoExcedente: p.reativoExcedente ?? 0,
    iluminacaoPublica: p.iluminacaoPublica ?? 0,
    outros: p.outros ?? 0,
  };

  // Crédito tributário sobre a mensalidade EaaS para clientes no regime Lucro Real:
  // a mensalidade é uma despesa operacional dedutível, então parte do valor pago
  // retorna como crédito de PIS/COFINS e de IRPJ+CSLL. Só se aplica ao modo EaaS.
  const lucroReal = !!p.lucroReal;
  const creditoPisCofins = p.creditoPisCofinsPercent ?? 0.0925;
  const creditoIrpjCsll = p.creditoIrpjCsllPercent ?? 0.34;
  const fatorCreditoTributario = lucroReal ? 1 - creditoPisCofins - creditoIrpjCsll : 1;

  const linhas = [];
  let tarifaPonta = p.tarifaPonta;
  let tarifaForaPonta = p.tarifaForaPonta;
  let tarifaMercadoLivre = p.tarifaMercadoLivre ?? null;
  let tarifaTusd = p.tarifaTusd ?? 0;
  let mensalidadeEaas = p.mensalidadeEaasInicial ?? 0;

  for (let i = 0; i < horizonte; i++) {
    const anoRelativo = i + 1;
    if (i > 0) {
      tarifaPonta *= 1 + reajusteTarifario;
      tarifaForaPonta *= 1 + reajusteTarifario;
      if (tarifaMercadoLivre != null) tarifaMercadoLivre *= 1 + reajusteTarifario;
      tarifaTusd *= 1 + reajusteTarifario; // TUSD é regulado, reajusta junto com as demais tarifas de rede
      mensalidadeEaas *= 1 + ipca;
    }

    const atual = calcularContaGrupoA({
      ...base,
      tarifaPonta,
      tarifaForaPonta,
      mercadoLivre: false,
    });

    const efetividade = efetividadeBessNoAno(anoRelativo);
    const energiaDeslocadaPeloBess = base.energiaPontaKwh * efetividade;
    const energiaCargaBess = energiaDeslocadaPeloBess / rte;
    // Energia fora ponta com BESS = a que já era consumida + a recarga do BESS (puxada fora de
    // ponta, mais barata) − a geração solar do mês (compensação líquida, sem passar de zero).
    const energiaForaPontaComBess = Math.max(0, base.energiaForaPontaKwh + energiaCargaBess - geracaoSolarMensalKwh);
    // Cenário "com BESS": se a migração para Mercado Livre está marcada, ela é
    // aplicada aqui (substitui as tarifas ponta/fora ponta reguladas pela tarifa
    // ML sobre toda a energia) — não é um "pega o mais barato" automático, é a
    // combinação que o usuário escolheu modelar.
    const comBess = calcularContaGrupoA({
      ...base,
      energiaPontaKwh: base.energiaPontaKwh - energiaDeslocadaPeloBess,
      energiaForaPontaKwh: energiaForaPontaComBess,
      demandaContratadaKw: p.demandaContratadaKwPosBess ?? base.demandaContratadaKw,
      reativoExcedente: corrigirReativo ? 0 : base.reativoExcedente,
      tarifaPonta,
      tarifaForaPonta,
      tarifaMercadoLivre,
      tarifaTusd,
      mercadoLivre: usarMercadoLivre,
    });

    const mensalidadeEaasLiquida = mensalidadeEaas * fatorCreditoTributario;
    const custoAquisicaoMensal = p.modoAquisicao === "eaas" ? mensalidadeEaasLiquida : 0;
    const custoComBessTotal = comBess.total + custoAquisicaoMensal;

    // Economia de energia (efeito do BESS/ML na conta) — sempre a mesma, não depende
    // de como o cliente paga o equipamento. O resultado líquido é que muda: no CAPEX
    // o financiamento não entra na conta mensal (é o investimento, tratado à parte no
    // payback); no EaaS a mensalidade é descontada da economia mês a mês.
    const economiaEnergiaMensal = atual.total - comBess.total;
    const resultadoLiquidoMensal = atual.total - custoComBessTotal;

    linhas.push({
      ano: (p.anoInicial ?? new Date().getFullYear()) + i,
      anoRelativo,
      efetividadeBess: efetividade,
      contaAtual: atual.total,
      contaComBess: custoComBessTotal,
      usouMercadoLivre: usarMercadoLivre,
      mensalidadeEaasNominal: p.modoAquisicao === "eaas" ? mensalidadeEaas : 0,
      mensalidadeEaasLiquida: p.modoAquisicao === "eaas" ? mensalidadeEaasLiquida : 0,
      economiaEnergiaMensal,
      economiaEnergiaAnual: economiaEnergiaMensal * 12,
      resultadoLiquidoMensal,
      resultadoLiquidoAnual: resultadoLiquidoMensal * 12,
    });
  }

  const economiaEnergiaMensalAno1 = linhas[0].economiaEnergiaMensal;
  const resultadoLiquidoMensalAno1 = linhas[0].resultadoLiquidoMensal;
  // A usina solar é sempre um investimento à parte (CAPEX), mesmo quando o BESS em si é
  // contratado como EaaS — por isso soma independente do modoAquisicao, diferente do
  // investimento do BESS (que só entra aqui se for CAPEX; em EaaS ele vira mensalidade).
  const investimentoBess = p.modoAquisicao === "eaas" ? 0 : p.investimentoBess ?? 0;
  const investimentoSolar = p.investimentoSolar ?? 0;
  const investimento = investimentoBess + investimentoSolar;
  const paybackMeses = investimento > 0 && economiaEnergiaMensalAno1 > 0 ? investimento / economiaEnergiaMensalAno1 : null;
  const economiaEnergiaTotalHorizonte = linhas.reduce((acc, l) => acc + l.economiaEnergiaAnual, 0);
  const resultadoLiquidoTotalHorizonte = linhas.reduce((acc, l) => acc + l.resultadoLiquidoAnual, 0);

  return {
    linhas,
    economiaEnergiaMensalAno1,
    resultadoLiquidoMensalAno1,
    investimento,
    investimentoBess,
    investimentoSolar,
    paybackMeses,
    economiaEnergiaTotalHorizonte,
    resultadoLiquidoTotalHorizonte,
    usarMercadoLivre,
    lucroReal,
    fatorCreditoTributario,
  };
}

/**
 * Decompõe a economia do Grupo A em passos sucessivos ("escadinha"), na ordem em que as
 * reduções normalmente acontecem no projeto: 1) ajuste da demanda contratada (peak shaving
 * reduz o pico, permitindo contratar uma demanda menor); 2) zerar o consumo de energia
 * comprado da distribuidora no horário de ponta (líquido da recarga do BESS, que é puxada
 * fora de ponta com perda de round-trip — ver `rte` abaixo); 3) correção do fator de potência,
 * se marcada (o mesmo inversor do BESS costuma eliminar o reativo excedente); 4) geração
 * solar, se informada (compensa energia fora ponta); 5) migração para o Mercado Livre, se
 * marcada. Passos 3-5 só entram na lista se o respectivo dado for informado/marcado — a lista
 * de passos é dinâmica, não fixa. Cada passo usa as tarifas do ano 1 (sem reajuste), pra bater
 * com contaAtual/contaComBess de linhas[0] em calcularCenariosGrupoA — é só outra forma de
 * olhar pro mesmo número, não um cálculo paralelo.
 * @param {number} [p.rte] - round-trip efficiency do BESS (fração, ex.: 0.9) usada pra achar a
 *   energia extra puxada da rede pra recarregar a bateria (energiaPontaKwh / rte)
 * @param {boolean} [p.corrigirReativo] - se true, zera o reativo excedente a partir do passo 2
 * @param {number} [p.geracaoSolarMensalKwh] - geração solar estimada do mês, abate energiaForaPontaKwh
 */
export function calcularEscadaReducoesGrupoA(p) {
  const baseFixo = {
    tarifaDemanda: p.tarifaDemanda,
    iluminacaoPublica: p.iluminacaoPublica ?? 0,
    outros: p.outros ?? 0,
  };
  const usarMercadoLivre = !!(p.usarMercadoLivre && p.tarifaMercadoLivre != null);
  const demandaPosBess = p.demandaContratadaKwPosBess ?? p.demandaContratadaKw;
  const rte = p.rte > 0 ? p.rte : 0.9;
  const corrigirReativo = !!p.corrigirReativo;
  const geracaoSolarMensalKwh = p.geracaoSolarMensalKwh ?? 0;

  let estado = {
    demandaContratadaKw: p.demandaContratadaKw,
    energiaPontaKwh: p.energiaPontaKwh,
    energiaForaPontaKwh: p.energiaForaPontaKwh,
    reativoExcedente: p.reativoExcedente ?? 0,
    mercadoLivre: false,
  };
  const calcularTotal = () =>
    calcularContaGrupoA({
      ...baseFixo,
      ...estado,
      tarifaPonta: p.tarifaPonta,
      tarifaForaPonta: p.tarifaForaPonta,
      tarifaMercadoLivre: p.tarifaMercadoLivre,
      tarifaTusd: p.tarifaTusd ?? 0,
    }).total;

  const passos = [{ label: "Atual", total: calcularTotal() }];
  // Um passo sem efeito prático (ex.: "Ajuste de demanda" quando a demanda pós-BESS informada é
  // igual à atual) só polui a escadinha sem agregar informação — pula em vez de mostrar "− R$ 0".
  const passo = (label) => {
    const total = calcularTotal();
    const reducao = passos[passos.length - 1].total - total;
    if (Math.abs(reducao) < 0.01) return;
    passos.push({ label, total, reducao });
  };

  estado = { ...estado, demandaContratadaKw: demandaPosBess };
  passo("Ajuste de demanda");

  const energiaCargaBess = p.energiaPontaKwh / rte;
  estado = { ...estado, energiaPontaKwh: 0, energiaForaPontaKwh: estado.energiaForaPontaKwh + energiaCargaBess };
  passo("Zerar consumo na ponta");

  if (corrigirReativo && estado.reativoExcedente > 0) {
    estado = { ...estado, reativoExcedente: 0 };
    passo("Correção do fator de potência");
  }

  if (geracaoSolarMensalKwh > 0) {
    estado = { ...estado, energiaForaPontaKwh: Math.max(0, estado.energiaForaPontaKwh - geracaoSolarMensalKwh) };
    passo("Geração solar");
  }

  if (usarMercadoLivre) {
    estado = { ...estado, mercadoLivre: true };
    passo("Migração para o Mercado Livre");
  }

  const final = passos[passos.length - 1];
  passos.push({ label: "Final", total: final.total });

  return { passos, usarMercadoLivre, reducaoTotal: passos[0].total - final.total };
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
