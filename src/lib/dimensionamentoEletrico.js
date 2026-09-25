// Dimensionamento de referência do circuito dedicado do carregador veicular (motivo mais comum
// da migração Grupo B -> Grupo A por aumento de carga), conforme critérios gerais da NBR 5410.
//
// IMPORTANTE — isto é uma ferramenta de PRÉ-DIMENSIONAMENTO para a equipe comercial, não um
// projeto elétrico executivo. Os valores de ampacidade/fatores de correção usados abaixo são os
// da NBR 5410 (Tabela 36 — métodos de referência B1 e C, cobre, isolação PVC 70°C, e Tabelas 40/42
// para os fatores de temperatura e agrupamento), reproduzidos de memória/fontes técnicas públicas,
// não copiados de uma via oficial da norma. O resultado final (seção, disjuntor, DPS, DR) deve
// sempre ser conferido e assinado (ART) por um engenheiro eletricista antes da execução — em
// especial se a corrente de projeto ficar perto do limite de uma tabela, se houver mais de um
// carregador no mesmo eletroduto/QDC, ou se o esquema de aterramento (TN-S/TN-C-S/TT) da unidade
// não for o padrão assumido aqui.

// Tabela 36 — ampacidade (A) por seção (mm²), cobre, PVC 70°C, sem agrupamento.
// B1/C/F usam ambiente a 30°C como referência; D (enterrado) usa solo a 20°C — ver FATOR_TEMPERATURA_*.
const AMPACIDADE = {
  B1: {
    2: { 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76, 25: 101, 35: 125, 50: 151, 70: 192, 95: 232, 120: 269, 150: 300, 185: 341, 240: 400, 300: 458 },
    3: { 1.5: 15.5, 2.5: 21, 4: 28, 6: 36, 10: 50, 16: 68, 25: 89, 35: 110, 50: 134, 70: 171, 95: 207, 120: 239, 150: 262, 185: 296, 240: 348, 300: 396 },
  },
  C: {
    2: { 1.5: 19.5, 2.5: 27, 4: 36, 6: 46, 10: 63, 16: 85, 25: 112, 35: 138, 50: 168, 70: 213, 95: 258, 120: 299, 150: 344, 185: 392, 240: 461, 300: 530 },
    3: { 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76, 25: 96, 35: 119, 50: 144, 70: 184, 95: 223, 120: 259, 150: 299, 185: 341, 240: 403, 300: 464 },
  },
  // Método D1 — cabo multipolar diretamente enterrado no solo (resistividade térmica de
  // referência 2,5 K.m/W, profundidade padrão — não ajustável nesta calculadora).
  D: {
    2: { 1.5: 26, 2.5: 34, 4: 44, 6: 56, 10: 73, 16: 93, 25: 117, 35: 138, 50: 162, 70: 197, 95: 227, 120: 251, 150: 272, 185: 296, 240: 327, 300: 356 },
    3: { 1.5: 22, 2.5: 29, 4: 37, 6: 48, 10: 62, 16: 79, 25: 99, 35: 117, 50: 138, 70: 167, 95: 193, 120: 213, 150: 231, 185: 252, 240: 278, 300: 303 },
  },
  // Método F — cabo isolado ao ar livre, espaçado (afastado de parede/superfícies, sobre
  // suportes/isoladores) — típico de trecho aéreo entre QDC e um posto de recarga externo.
  F: {
    2: { 1.5: 22, 2.5: 30, 4: 40, 6: 51, 10: 70, 16: 94, 25: 119, 35: 148, 50: 180, 70: 232, 95: 282, 120: 328, 150: 379, 185: 434, 240: 514, 300: 593 },
    3: { 1.5: 19, 2.5: 26, 4: 35, 6: 44, 10: 61, 16: 82, 25: 104, 35: 129, 50: 157, 70: 202, 95: 245, 120: 285, 150: 330, 185: 378, 240: 447, 300: 516 },
  },
};

export const METODOS_INSTALACAO = {
  B1: "Eletroduto embutido em alvenaria/parede",
  C: "Eletroduto ou cabo aparente / bandeja não perfurada",
  D: "Enterrado no solo (direto ou em eletroduto enterrado)",
  F: "Aéreo / ao ar livre (cabo isolado, espaçado, sem eletroduto)",
};

const METODOS_ENTERRADOS = new Set(["D"]);

export const MATERIAIS_CONDUTOR = { cobre: "Cobre", aluminio: "Alumínio" };

// Ampacidade do alumínio não é uma tabela própria aqui — é estimada a partir da tabela de cobre
// acima por um fator ~0,78 (relação aproximada e amplamente usada como referência rápida entre
// as colunas de cobre e alumínio da própria Tabela 36 da NBR5410; a norma tabela os dois
// materiais separadamente com pequenas variações por seção que este fator único não replica
// exatamente — para o dimensionamento final, usar a tabela oficial). Resistividade também é
// maior (~1,64x a do cobre), o que penaliza mais a queda de tensão em alumínio a igual seção.
const FATOR_AMPACIDADE_ALUMINIO = 0.78;
const RESISTIVIDADE = { cobre: 0.0225, aluminio: 0.037 }; // Ω·mm²/m, ~70°C (aprox.)
// Condutor de alumínio abaixo de 16mm² não é prática usual em instalações fixas no Brasil
// (fragilidade mecânica/conectores) — cobre permanece com o mínimo de 2,5mm² da NBR5410 p/ força.
const SECAO_MINIMA = { cobre: 2.5, aluminio: 16 };

const SECOES_PADRAO = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
// Degraus de disjuntor em caixa moldada mais comuns nos catálogos usados no Brasil (WEG DWmax,
// Siemens 3VA, Schneider Compact NSX) — de 125A pra cima o degrau padrão é 160A, não 150/175A
// (isso é mais uma convenção norte-americana/NEMA; raramente aparece em catálogo por aqui).
const DISJUNTORES_PADRAO = [10, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125, 160, 200, 225, 250, 315, 400, 500, 630];
// DR (interruptor diferencial-residual) — degraus comerciais típicos. Precisa ir tão longe
// quanto DISJUNTORES_PADRAO: um DR com corrente nominal MENOR que o disjuntor que ele protege
// fica subdimensionado para a corrente normal do circuito (não é só uma questão de sensibilidade
// a fuga — o DR também conduz a corrente de carga o tempo todo).
const DR_PADRAO = [25, 40, 63, 80, 100, 125, 160, 200, 250, 300, 400];

// Tabela 40 — fator de correção de temperatura, isolação PVC.
const FATOR_TEMPERATURA_AR = { 10: 1.22, 15: 1.17, 20: 1.12, 25: 1.06, 30: 1.0, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71, 55: 0.61, 60: 0.5 }; // referência: ar a 30°C
const FATOR_TEMPERATURA_SOLO = { 10: 1.1, 15: 1.05, 20: 1.0, 25: 0.95, 30: 0.89, 35: 0.84, 40: 0.77, 45: 0.71, 50: 0.63 }; // referência: solo a 20°C

// Tabela 42/43 — fator de agrupamento (circuitos em camada única, em contato/mesma vala).
const FATOR_AGRUPAMENTO_AR = { 1: 1.0, 2: 0.8, 3: 0.7, 4: 0.65, 5: 0.6, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.5 };
const FATOR_AGRUPAMENTO_SOLO = { 1: 1.0, 2: 0.75, 3: 0.65, 4: 0.6, 5: 0.55, 6: 0.5, 7: 0.45, 8: 0.43, 9: 0.41 };

// Margem para carga contínua (carregamento > 1h) — NÃO é um número fixado pela NBR 5410 em si
// (a norma não trata de carregador veicular especificamente); é a mesma margem de 125% que a
// NEC americana (625.41/210.19) exige explicitamente para circuitos de EVSE, e que fabricantes/
// integradores costumam adotar por aqui também como boa prática. Por não ser uma exigência
// obrigatória e numerada da NBR 5410, é editável no formulário (não fixo no código).
const FATOR_CONTINUIDADE_PADRAO = 1.25;

const ELETRODUTO_POR_SECAO = [
  { max: 2.5, label: '3/4" (20 mm)' },
  { max: 6, label: '3/4" (20 mm)' },
  { max: 10, label: '1" (25 mm)' },
  { max: 16, label: '1.1/4" (32 mm)' },
  { max: 25, label: '1.1/4" (32 mm)' },
  { max: 35, label: '1.1/2" (40 mm)' },
  { max: 50, label: '1.1/2" (40 mm)' },
  { max: 70, label: '2" (50 mm)' },
  { max: 95, label: '2" (50 mm)' },
  { max: 120, label: '2.1/2" (63 mm)' },
  { max: 150, label: '2.1/2" (63 mm)' },
  { max: 185, label: '3" (75 mm)' },
  { max: 240, label: '3" (75 mm)' },
  { max: 300, label: '4" (100 mm)' },
];

function interpolar(tabela, x) {
  const chaves = Object.keys(tabela).map(Number).sort((a, b) => a - b);
  if (x <= chaves[0]) return tabela[chaves[0]];
  if (x >= chaves[chaves.length - 1]) return tabela[chaves[chaves.length - 1]];
  for (let i = 0; i < chaves.length - 1; i++) {
    const a = chaves[i];
    const b = chaves[i + 1];
    if (x >= a && x <= b) {
      const t = (x - a) / (b - a);
      return tabela[a] + t * (tabela[b] - tabela[a]);
    }
  }
  return 1;
}

export function calcularCorrenteCarregador({ potenciaKw, tensaoV, tipoLigacao, fatorPotencia }) {
  const potenciaW = potenciaKw * 1000;
  const fp = fatorPotencia > 0 ? fatorPotencia : 1;
  if (tipoLigacao === "trifasico") return potenciaW / (Math.sqrt(3) * tensaoV * fp);
  return potenciaW / (tensaoV * fp); // monofásico (F+N) ou bifásico (F+F)
}

function quedaTensaoPercent({ correnteA, distanciaM, secaoMm2, tensaoV, tipoLigacao, resistividade }) {
  const fatorCircuito = tipoLigacao === "trifasico" ? Math.sqrt(3) : 2; // 2 = ida e volta (mono/bifásico)
  const quedaV = (fatorCircuito * resistividade * distanciaM * correnteA) / secaoMm2;
  return (quedaV / tensaoV) * 100;
}

function secaoParaEletroduto(secaoMm2, metodoInstalacao) {
  if (metodoInstalacao === "F") return "não aplicável (cabo isolado ao ar livre, sem eletroduto)";
  const linha = ELETRODUTO_POR_SECAO.find((l) => secaoMm2 <= l.max);
  return linha ? linha.label : "consultar projetista (seção acima da tabela de referência)";
}

function secaoTerra(secaoFaseMm2) {
  if (secaoFaseMm2 <= 16) return secaoFaseMm2;
  if (secaoFaseMm2 <= 35) return 16;
  return secaoFaseMm2 / 2;
}

/**
 * Dimensionamento de referência (NBR 5410) do circuito dedicado do carregador veicular.
 * @param {object} p
 * @param {number} p.potenciaKw - potência do carregador (kW)
 * @param {number} p.tensaoV - tensão de alimentação do circuito (V)
 * @param {"monofasico"|"bifasico"|"trifasico"} p.tipoLigacao
 * @param {number} p.fatorPotencia - cosφ do carregador (0-1)
 * @param {number} p.distanciaM - distância do QDC até o carregador (m, ida)
 * @param {number} p.quedaMaxPercent - queda de tensão máxima admissível (%), NBR5410 recomenda ~4% para circuitos terminais
 * @param {"B1"|"C"|"D"|"F"} p.metodoInstalacao
 * @param {number} p.temperaturaAmbiente - °C (ambiente do ar para B1/C/F, do solo para D)
 * @param {number} p.circuitosAgrupados - nº de circuitos no mesmo eletroduto/bandeja/vala (mín. 1)
 * @param {number} [p.fatorContinuidade] - margem para carga contínua (padrão 1,25 — ver nota acima; não é um valor fixado pela NBR5410)
 * @param {"cobre"|"aluminio"} [p.material] - material do condutor (padrão cobre)
 * @param {boolean} [p.carregadorTemProtecaoInterna] - se o carregador já tem DR Tipo B (ou RDC-DD
 *   conforme IEC 62955) integrado de fábrica. A NBR 17019:2022 nunca dispensa o DR EXTERNO, mas
 *   permite que ele seja Tipo A quando essa proteção interna contra corrente de fuga contínua já
 *   existe no próprio equipamento; sem essa confirmação, o DR externo precisa ser Tipo B. Padrão
 *   false (opção mais segura) — só vira "A" se o usuário confirmar a proteção interna do carregador.
 */
export function calcularDimensionamentoEletrico(p) {
  const avisos = [];
  const tipoLigacao = p.tipoLigacao || "monofasico";
  const condutoresCarregados = tipoLigacao === "trifasico" ? 3 : 2;
  const metodo = p.metodoInstalacao || "B1";
  const material = p.material === "aluminio" ? "aluminio" : "cobre";
  const fatorMaterial = material === "aluminio" ? FATOR_AMPACIDADE_ALUMINIO : 1;
  const resistividade = RESISTIVIDADE[material];
  const secaoMinima = SECAO_MINIMA[material];
  const tabelaBase = AMPACIDADE[metodo][condutoresCarregados];
  const tabela = Object.fromEntries(Object.entries(tabelaBase).map(([secao, ampacidade]) => [secao, ampacidade * fatorMaterial]));
  const enterrado = METODOS_ENTERRADOS.has(metodo);
  const fatorContinuidade = p.fatorContinuidade > 0 ? p.fatorContinuidade : FATOR_CONTINUIDADE_PADRAO;

  const correnteNominal = calcularCorrenteCarregador({
    potenciaKw: p.potenciaKw,
    tensaoV: p.tensaoV,
    tipoLigacao,
    fatorPotencia: p.fatorPotencia,
  });
  const correnteProjeto = correnteNominal * fatorContinuidade;

  const temperaturaRef = enterrado ? 20 : 30;
  const tabelaTemp = enterrado ? FATOR_TEMPERATURA_SOLO : FATOR_TEMPERATURA_AR;
  const tabelaAgrup = enterrado ? FATOR_AGRUPAMENTO_SOLO : FATOR_AGRUPAMENTO_AR;
  const fatorTemp = interpolar(tabelaTemp, p.temperaturaAmbiente ?? temperaturaRef);
  const agrupados = Math.max(1, Math.round(p.circuitosAgrupados ?? 1));
  const fatorAgrup = agrupados >= 9 ? tabelaAgrup[9] : tabelaAgrup[agrupados] ?? 1;
  const fatorCorrecao = fatorTemp * fatorAgrup;

  const quedaMax = p.quedaMaxPercent ?? 4;

  let secaoEscolhida = null;
  let capacidadeCabo = 0;
  let quedaTensao = 0;
  for (const secao of SECOES_PADRAO) {
    if (secao < secaoMinima) continue;
    const capacidade = tabela[secao] * fatorCorrecao;
    const queda = quedaTensaoPercent({ correnteA: correnteProjeto, distanciaM: p.distanciaM || 0, secaoMm2: secao, tensaoV: p.tensaoV, tipoLigacao, resistividade });
    if (capacidade >= correnteProjeto && queda <= quedaMax) {
      secaoEscolhida = secao;
      capacidadeCabo = capacidade;
      quedaTensao = queda;
      break;
    }
  }
  if (!secaoEscolhida) {
    avisos.push(
      "Corrente de projeto acima da maior seção de referência desta tabela (300 mm²) ou queda de tensão não atendida — consulte um engenheiro eletricista (pode ser necessário circuito com condutores em paralelo)."
    );
    const maior = SECOES_PADRAO[SECOES_PADRAO.length - 1];
    secaoEscolhida = maior;
    capacidadeCabo = tabela[maior] * fatorCorrecao;
    quedaTensao = quedaTensaoPercent({ correnteA: correnteProjeto, distanciaM: p.distanciaM || 0, secaoMm2: maior, tensaoV: p.tensaoV, tipoLigacao, resistividade });
  }

  let disjuntor = DISJUNTORES_PADRAO.find((d) => d >= correnteProjeto) ?? null;
  if (disjuntor && disjuntor > capacidadeCabo) {
    // sobe a seção do cabo até acomodar o próximo disjuntor padrão (In ≤ Iz)
    for (const secao of SECOES_PADRAO) {
      if (secao <= secaoEscolhida) continue;
      const capacidade = tabela[secao] * fatorCorrecao;
      if (capacidade >= disjuntor) {
        secaoEscolhida = secao;
        capacidadeCabo = capacidade;
        quedaTensao = quedaTensaoPercent({ correnteA: correnteProjeto, distanciaM: p.distanciaM || 0, secaoMm2: secao, tensaoV: p.tensaoV, tipoLigacao, resistividade });
        break;
      }
    }
  }
  if (!disjuntor) {
    avisos.push(`Corrente de projeto acima do maior disjuntor padrão desta tabela (${DISJUNTORES_PADRAO[DISJUNTORES_PADRAO.length - 1]} A) — consulte um engenheiro eletricista.`);
    disjuntor = DISJUNTORES_PADRAO[DISJUNTORES_PADRAO.length - 1];
  }

  const ucCandidatos = [175, 255, 275, 320, 385, 440];
  const ucMinimo = p.tensaoV * 1.15;
  const dpsUc = ucCandidatos.find((v) => v >= ucMinimo) ?? ucCandidatos[ucCandidatos.length - 1];
  const dpsImaxKa = p.potenciaKw > 22 ? 40 : 20;

  // O DR precisa suportar pelo menos a corrente nominal do disjuntor que ele protege (ele
  // conduz a corrente de carga o tempo todo, não só a de fuga) — nunca um valor abaixo disso.
  let drNominal = DR_PADRAO.find((d) => d >= disjuntor) ?? null;
  if (!drNominal) {
    avisos.push(
      `Disjuntor (${disjuntor} A) acima do maior DR de caixa moldada padrão desta tabela (${DR_PADRAO[DR_PADRAO.length - 1]} A) — nesse patamar normalmente se usa um relé de proteção diferencial com TC toroidal em vez de um DR compacto; consulte um engenheiro eletricista.`
    );
    drNominal = DR_PADRAO[DR_PADRAO.length - 1];
  }

  // NBR 17019:2022 não dispensa o DR externo em nenhum caso — a diferença é só o TIPO exigido.
  // Corrente de fuga contínua (DC) de um carregador em falha não é detectada por um DR comum
  // (Tipo AC/A), que satura com componente contínua; daí a exigência de Tipo B, A MENOS que o
  // próprio carregador já detecte e interrompa essa fuga internamente (DR Tipo B integrado, ou
  // um RDC-DD conforme IEC 62955) — nesse caso o DR externo só precisa cobrir fuga CA normal,
  // e pode ser Tipo A.
  const carregadorTemProtecaoInterna = !!p.carregadorTemProtecaoInterna;
  const tipoDr = carregadorTemProtecaoInterna ? "A" : "B";
  if (carregadorTemProtecaoInterna) {
    avisos.push(
      "DR externo Tipo A assumido com base na informação de que o carregador já possui proteção interna equivalente a DR Tipo B/RDC-DD (IEC 62955) — confirme essa característica na ficha técnica do fabricante antes de aplicar em campo."
    );
  } else {
    avisos.push(
      "DR externo Tipo B (padrão mais seguro, conforme NBR 17019:2022) — se o fabricante confirmar que o carregador já possui DR Tipo B/RDC-DD integrado, o DR externo pode ser rebaixado para Tipo A."
    );
  }

  return {
    tipoLigacao,
    material,
    condutoresCarregados,
    correnteNominal,
    fatorContinuidade,
    correnteProjeto,
    fatorTemp,
    fatorAgrup,
    quedaTensaoPercent: quedaTensao,
    quedaMaxPercent: quedaMax,
    secaoFaseMm2: secaoEscolhida,
    // Carregador trifásico normalmente tem neutro (3F+N) — eletrônica interna e circuitos de
    // controle do carregador costumam precisar de fase-neutro, então o neutro é dimensionado
    // igual à fase por padrão (também evita subdimensionar diante de harmônicas de 3ª ordem).
    secaoNeutroMm2: secaoEscolhida,
    secaoTerraMm2: secaoTerra(secaoEscolhida),
    capacidadeCaboA: capacidadeCabo,
    eletroduto: secaoParaEletroduto(secaoEscolhida, metodo),
    disjuntorA: disjuntor,
    disjuntorCurva: "C",
    dps: { classe: "II", ucV: dpsUc, inKa: 5, imaxKa: dpsImaxKa },
    dr: { tipo: tipoDr, sensibilidadeMa: 30, nominalA: drNominal },
    avisos,
  };
}
