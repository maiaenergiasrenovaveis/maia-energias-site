// Dados de DEMONSTRAÇÃO para o Portal de Monitoramento de Eletropostos (SP).
// Estrutura pronta para ser alimentada pela API da Tupi (Tupinambá) — os valores
// abaixo são ilustrativos, não coletados em tempo real.

export const regions = [
  { code: "RMSP", name: "Grande São Paulo" },
  { code: "CAMP", name: "Campinas" },
  { code: "VALE", name: "Vale do Paraíba" },
  { code: "LIT", name: "Litoral" },
  { code: "INT", name: "Interior" },
] as const;

export type RegionCode = (typeof regions)[number]["code"];

export const marketKpis = {
  mercadoDC: 1284,
  coberturaMonitorados: 612,
  receitaMercadoMensal: 6842300,
  demandaMedia7d: 19,
  atualizadoEm: "2026-07-30T10:30:00-03:00",
};

export const regionStats: Record<
  RegionCode,
  { estacoesDC: number; receita30d: number; monitorado: number; total: number; frotaVE: number; vesPorConector: number; ocupPct: number }
> = {
  RMSP: { estacoesDC: 612, receita30d: 3541200, monitorado: 298, total: 612, frotaVE: 41820, vesPorConector: 58, ocupPct: 22 },
  CAMP: { estacoesDC: 187, receita30d: 968400, monitorado: 96, total: 187, frotaVE: 12630, vesPorConector: 51, ocupPct: 18 },
  VALE: { estacoesDC: 143, receita30d: 712300, monitorado: 71, total: 143, frotaVE: 8940, vesPorConector: 47, ocupPct: 15 },
  LIT: { estacoesDC: 118, receita30d: 689900, monitorado: 58, total: 118, frotaVE: 6710, vesPorConector: 44, ocupPct: 21 },
  INT: { estacoesDC: 224, receita30d: 930500, monitorado: 89, total: 224, frotaVE: 15230, vesPorConector: 49, ocupPct: 16 },
};

export interface Station {
  id: string;
  nome: string;
  rede: string;
  cidade: string;
  regiao: RegionCode;
  lat: number;
  lng: number;
  potenciaKw: number;
  ocupacaoPct: number;
  horasDia: number;
  precoKwh: number;
  receita30d: number;
}

export const stations: Station[] = [
  { id: "s1", nome: "Shopping Iguatemi - 01", rede: "Ipiranga", cidade: "São Paulo", regiao: "RMSP", lat: -23.5673, lng: -46.6890, potenciaKw: 120, ocupacaoPct: 38, horasDia: 15.2, precoKwh: 2.29, receita30d: 61200 },
  { id: "s2", nome: "Rodovia Anchieta - Km 18", rede: "Shell Recharge", cidade: "São Bernardo do Campo", regiao: "RMSP", lat: -23.6914, lng: -46.5646, potenciaKw: 180, ocupacaoPct: 44, horasDia: 18.9, precoKwh: 2.39, receita30d: 58700 },
  { id: "s3", nome: "Marginal Tietê - Hub 60kW", rede: "Enel X", cidade: "São Paulo", regiao: "RMSP", lat: -23.5205, lng: -46.6333, potenciaKw: 60, ocupacaoPct: 61, horasDia: 22.4, precoKwh: 1.99, receita30d: 47800 },
  { id: "s4", nome: "Shopping Parque D. Pedro", rede: "Voltbras", cidade: "Campinas", regiao: "CAMP", lat: -22.8756, lng: -47.0532, potenciaKw: 90, ocupacaoPct: 33, horasDia: 14.1, precoKwh: 2.19, receita30d: 41300 },
  { id: "s5", nome: "Anel Viário - Posto Sul", rede: "Ipiranga", cidade: "São José dos Campos", regiao: "VALE", lat: -23.1896, lng: -45.8841, potenciaKw: 60, ocupacaoPct: 29, horasDia: 12.7, precoKwh: 2.09, receita30d: 33900 },
  { id: "s6", nome: "Orla de Santos - Ponta da Praia", rede: "ZEV", cidade: "Santos", regiao: "LIT", lat: -23.9803, lng: -46.3006, potenciaKw: 60, ocupacaoPct: 52, horasDia: 19.8, precoKwh: 2.15, receita30d: 39600 },
  { id: "s7", nome: "Shopping Iguatemi Ribeirão", rede: "Enel X", cidade: "Ribeirão Preto", regiao: "INT", lat: -21.1775, lng: -47.8103, potenciaKw: 80, ocupacaoPct: 27, horasDia: 11.4, precoKwh: 2.05, receita30d: 29700 },
  { id: "s8", nome: "Rodovia Castelo Branco - Km 61", rede: "Shell Recharge", cidade: "Sorocaba", regiao: "INT", lat: -23.5015, lng: -47.4526, potenciaKw: 150, ocupacaoPct: 35, horasDia: 15.9, precoKwh: 2.25, receita30d: 45100 },
  { id: "s9", nome: "Guarulhos - Cumbica Hub", rede: "BYD", cidade: "Guarulhos", regiao: "RMSP", lat: -23.4356, lng: -46.4731, potenciaKw: 240, ocupacaoPct: 41, horasDia: 17.6, precoKwh: 2.35, receita30d: 68400 },
  { id: "s10", nome: "Alphaville - Posto Central", rede: "Voltbras", cidade: "Barueri", regiao: "RMSP", lat: -23.4952, lng: -46.8342, potenciaKw: 60, ocupacaoPct: 46, horasDia: 18.0, precoKwh: 2.19, receita30d: 40200 },
];

export const networkStats = [
  { rede: "Ipiranga", estacoes: 214, kwInst: 24680, ocupMedia: 27, precoMedio: 2.21, kwh30d: 612400, receita30d: 1353400 },
  { rede: "Shell Recharge", estacoes: 176, kwInst: 21120, ocupMedia: 31, precoMedio: 2.29, kwh30d: 588900, receita30d: 1349000 },
  { rede: "Enel X", estacoes: 138, kwInst: 11040, ocupMedia: 24, precoMedio: 2.02, kwh30d: 349200, receita30d: 705800 },
  { rede: "Voltbras", estacoes: 92, kwInst: 7360, ocupMedia: 29, precoMedio: 2.16, kwh30d: 271600, receita30d: 586700 },
  { rede: "BYD", estacoes: 61, kwInst: 12200, ocupMedia: 22, precoMedio: 2.35, kwh30d: 246800, receita30d: 579980 },
  { rede: "ZEV", estacoes: 58, kwInst: 4640, ocupMedia: 34, precoMedio: 2.12, kwh30d: 198300, receita30d: 420400 },
  { rede: "Tupi Rede", estacoes: 47, kwInst: 3760, ocupMedia: 26, precoMedio: 1.98, kwh30d: 141200, receita30d: 279600 },
  { rede: "Outras redes", estacoes: 98, kwInst: 8820, ocupMedia: 19, precoMedio: 2.08, kwh30d: 189700, receita30d: 394500 },
];

export const powerDistribution = [
  { faixa: "≤30 kW", conectores: 218 },
  { faixa: "40 kW", conectores: 396 },
  { faixa: "60 kW", conectores: 742 },
  { faixa: "80-120 kW", conectores: 518 },
  { faixa: "≥150 kW", conectores: 164 },
];

export interface ProspectedLocation {
  id: string;
  nome: string;
  cidade: string;
  regiao: RegionCode;
  lat: number;
  lng: number;
  score: number;
  status: "Recebido" | "Em análise" | "Aprovado" | "Implantação" | "Instalado";
  geracaoSolar: "Aceita locar" | "Não aceita" | "Sem espaço" | "Não sei";
  cadastrado: string;
}

export const prospectedLocations: ProspectedLocation[] = [
  { id: "l1", nome: "Posto Vale Verde - BR-116 km 234", cidade: "São Paulo", regiao: "RMSP", lat: -23.63, lng: -46.62, score: 91, status: "Aprovado", geracaoSolar: "Aceita locar", cadastrado: "2026-07-08" },
  { id: "l2", nome: "Shopping Metrô Tatuapé", cidade: "São Paulo", regiao: "RMSP", lat: -23.5403, lng: -46.5771, score: 85, status: "Aprovado", geracaoSolar: "Aceita locar", cadastrado: "2026-07-09" },
  { id: "l3", nome: "Posto Rota do Café - Km 12", cidade: "Campinas", regiao: "CAMP", lat: -22.905, lng: -47.061, score: 68, status: "Em análise", geracaoSolar: "Não sei", cadastrado: "2026-07-17" },
  { id: "l4", nome: "Terminal Rodoviário - Vale do Paraíba", cidade: "Taubaté", regiao: "VALE", lat: -23.026, lng: -45.555, score: 59, status: "Em análise", geracaoSolar: "Não sei", cadastrado: "2026-07-17" },
  { id: "l5", nome: "Posto Litoral Sul - Anchieta km 55", cidade: "Cubatão", regiao: "LIT", lat: -23.895, lng: -46.425, score: 55, status: "Em análise", geracaoSolar: "Não aceita", cadastrado: "2026-07-22" },
  { id: "l6", nome: "Shopping Sorocaba", cidade: "Sorocaba", regiao: "INT", lat: -23.489, lng: -47.443, score: 47, status: "Em análise", geracaoSolar: "Sem espaço", cadastrado: "2026-07-22" },
  { id: "l7", nome: "Posto Bandeirantes - Km 88", cidade: "Jundiaí", regiao: "CAMP", lat: -23.186, lng: -46.897, score: 76, status: "Recebido", geracaoSolar: "Aceita locar", cadastrado: "2026-07-28" },
  { id: "l8", nome: "Rodovia Dutra - Posto Norte", cidade: "São José dos Campos", regiao: "VALE", lat: -23.179, lng: -45.887, score: 71, status: "Recebido", geracaoSolar: "Aceita locar", cadastrado: "2026-07-28" },
  { id: "l9", nome: "Praia Grande - Av. Presidente Kennedy", cidade: "Praia Grande", regiao: "LIT", lat: -24.005, lng: -46.402, score: 63, status: "Recebido", geracaoSolar: "Não sei", cadastrado: "2026-07-28" },
  { id: "l10", nome: "Posto Anhanguera - Km 289", cidade: "Ribeirão Preto", regiao: "INT", lat: -21.177, lng: -47.810, score: 58, status: "Recebido", geracaoSolar: "Aceita locar", cadastrado: "2026-07-29" },
];

export const locationStatusCounts = () => {
  const counts: Record<ProspectedLocation["status"], number> = {
    "Recebido": 0, "Em análise": 0, "Aprovado": 0, "Implantação": 0, "Instalado": 0,
  };
  for (const l of prospectedLocations) counts[l.status]++;
  return counts;
};
