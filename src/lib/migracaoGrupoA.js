// Motor de cálculo para a migração de Grupo B (baixa tensão) para Grupo A (alta tensão)
// motivada por aumento de carga, com opção de Mercado Livre já embutida no cenário Grupo A.
// Sem planilha de referência para este caso — lógica construída a partir do conhecimento
// de tarifação (Grupo B: tarifa única por kWh, sem demanda; Grupo A: tarifa binômia com
// demanda contratada) e validada por conferência manual, não por um arquivo original.
//
// Decisão de modelagem importante: a comparação "Grupo B vs Grupo A" é feita SEMPRE no
// mesmo nível de consumo (o projetado, pós-aumento de carga) — isso isola o efeito da
// estrutura tarifária do efeito do próprio aumento de carga. A "conta atual" (consumo de
// hoje, antes do aumento) é mostrada só como referência/contexto, não entra na comparação.

import { calcularContaGrupoA } from "./dimensionamentoBESS.js";

/**
 * Conta de energia como Grupo B (tarifa única por kWh, sem demanda contratada).
 * @param {object} c
 * @param {number} c.consumoKwh
 * @param {number} c.tarifaGrupoB - R$/kWh (TE+TUSD já combinados, tarifa convencional B1/B3)
 * @param {number} c.iluminacaoPublica - R$/mês
 * @param {number} c.outros - R$/mês
 */
export function calcularContaGrupoB(c) {
  const custoEnergia = c.consumoKwh * c.tarifaGrupoB;
  const total = custoEnergia + (c.iluminacaoPublica ?? 0) + (c.outros ?? 0);
  return { custoEnergia, total };
}

/**
 * Investimento de infraestrutura para migrar de Grupo B para Grupo A: subestação/cabine
 * primária própria, transformador, projeto e conexão junto à distribuidora — mais o
 * equipamento que motivou o aumento de carga em si (na prática, quase sempre um carregador
 * veicular), já com instalação incluída (preço final/turnkey), pra a proposta cobrir o
 * investimento completo (subestação + carregador), não só a parte de conexão.
 */
export function calcularInvestimentoMigracao(c) {
  const transformador = c.transformador ?? 0;
  const obraCivil = c.obraCivil ?? 0;
  const projetoArt = c.projetoArt ?? 0;
  const medicaoProtecao = c.medicaoProtecao ?? 0;
  const taxaDistribuidora = c.taxaDistribuidora ?? 0;
  const outros = c.outros ?? 0;
  const cargaValor = c.cargaValor ?? 0;
  const total = transformador + obraCivil + projetoArt + medicaoProtecao + taxaDistribuidora + outros + cargaValor;
  return { transformador, obraCivil, projetoArt, medicaoProtecao, taxaDistribuidora, outros, cargaValor, total };
}

/**
 * Compara, ano a ano, a conta como Grupo B vs Grupo A (com Mercado Livre opcional) no MESMO
 * nível de consumo projetado (pós-aumento de carga), e calcula o payback do investimento de
 * migração (subestação/conexão) com base nessa diferença.
 * @param {object} p
 * @param {number} p.consumoAtualKwh - consumo médio mensal HOJE (Grupo B), só para referência
 * @param {number} p.tarifaGrupoBAtual - R$/kWh, tarifa Grupo B (usada tanto na conta atual quanto na projetada)
 * @param {number} p.energiaPontaKwhProjetado - consumo mensal projetado na ponta, pós-aumento
 * @param {number} p.energiaForaPontaKwhProjetado - consumo mensal projetado fora de ponta, pós-aumento
 * @param {number} p.demandaContratadaKw - nova demanda contratada (Grupo A)
 * @param {number} p.tarifaPonta - R$/kWh (Grupo A, mercado regulado)
 * @param {number} p.tarifaForaPonta - R$/kWh (Grupo A, mercado regulado)
 * @param {number} p.tarifaDemanda - R$/kW
 * @param {boolean} p.usarMercadoLivre
 * @param {number} p.tarifaMercadoLivre - R$/kWh, só energia (TE)
 * @param {number} p.tarifaTusd - R$/kWh, encargo de fio (continua devido mesmo no ML)
 * @param {number} p.iluminacaoPublica
 * @param {number} p.outros
 * @param {number} [p.multaUltrapassagem] - R$/mês, multa por ultrapassagem de demanda no cenário Grupo A
 * @param {number} p.investimentoMigracao - R$
 * @param {number} p.horizonteAnos
 * @param {number} p.reajusteTarifario - %a.a., aplicado às tarifas dos dois grupos
 */
export function calcularCenariosMigracao(p) {
  const horizonte = p.horizonteAnos ?? 10;
  const reajusteTarifario = p.reajusteTarifario ?? 0.08;
  const usarMercadoLivre = !!(p.usarMercadoLivre && p.tarifaMercadoLivre != null);

  const contaAtualGrupoB = calcularContaGrupoB({
    consumoKwh: p.consumoAtualKwh,
    tarifaGrupoB: p.tarifaGrupoBAtual,
    iluminacaoPublica: p.iluminacaoPublica,
    outros: p.outros,
  });

  const consumoProjetadoTotal = p.energiaPontaKwhProjetado + p.energiaForaPontaKwhProjetado;

  let tarifaGrupoB = p.tarifaGrupoBAtual;
  let tarifaPonta = p.tarifaPonta;
  let tarifaForaPonta = p.tarifaForaPonta;
  let tarifaDemanda = p.tarifaDemanda;
  let tarifaMercadoLivre = p.tarifaMercadoLivre ?? null;
  let tarifaTusd = p.tarifaTusd ?? 0;

  const linhas = [];
  let economiaAcumulada = 0;

  for (let i = 0; i < horizonte; i++) {
    const anoRelativo = i + 1;
    if (i > 0) {
      tarifaGrupoB *= 1 + reajusteTarifario;
      tarifaPonta *= 1 + reajusteTarifario;
      tarifaForaPonta *= 1 + reajusteTarifario;
      tarifaDemanda *= 1 + reajusteTarifario;
      if (tarifaMercadoLivre != null) tarifaMercadoLivre *= 1 + reajusteTarifario;
      tarifaTusd *= 1 + reajusteTarifario;
    }

    const grupoBProjetado = calcularContaGrupoB({
      consumoKwh: consumoProjetadoTotal,
      tarifaGrupoB,
      iluminacaoPublica: p.iluminacaoPublica,
      outros: p.outros,
    });

    const grupoAProjetado = calcularContaGrupoA({
      energiaPontaKwh: p.energiaPontaKwhProjetado,
      energiaForaPontaKwh: p.energiaForaPontaKwhProjetado,
      demandaContratadaKw: p.demandaContratadaKw,
      tarifaPonta,
      tarifaForaPonta,
      tarifaDemanda,
      tarifaMercadoLivre,
      tarifaTusd,
      mercadoLivre: usarMercadoLivre,
      reativoExcedente: p.reativoExcedente ?? 0,
      multaUltrapassagem: p.multaUltrapassagem ?? 0,
      iluminacaoPublica: p.iluminacaoPublica,
      outros: p.outros,
    });

    const economiaMensal = grupoBProjetado.total - grupoAProjetado.total;
    economiaAcumulada += economiaMensal * 12;

    linhas.push({
      ano: (p.anoInicial ?? new Date().getFullYear()) + i,
      anoRelativo,
      contaGrupoBProjetada: grupoBProjetado.total,
      contaGrupoAProjetada: grupoAProjetado.total,
      economiaMensal,
      economiaAnual: economiaMensal * 12,
      economiaAcumulada,
    });
  }

  const economiaMensalAno1 = linhas[0].economiaMensal;
  const investimento = p.investimentoMigracao ?? 0;
  const paybackMeses = investimento > 0 && economiaMensalAno1 > 0 ? investimento / economiaMensalAno1 : null;

  return {
    contaAtualGrupoB,
    consumoProjetadoTotal,
    usarMercadoLivre,
    linhas,
    economiaMensalAno1,
    investimento,
    paybackMeses,
    economiaTotalHorizonte: economiaAcumulada,
  };
}
