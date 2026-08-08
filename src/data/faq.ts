export interface FaqItem {
  question: string;
  answer: string;
}

// Perguntas revisadas a partir do conteúdo original do site, reescritas para
// evitar linguagem de rentabilidade garantida (usar termos como "projetado",
// "estimado", "cenário conservador").
export const investorFaq: FaqItem[] = [
  {
    question: "Preciso ter um terreno para investir em uma usina solar?",
    answer:
      "Não necessariamente. Se você tiver um terreno ou telhado com pelo menos 1.000m², esse espaço pode ser usado no projeto. Caso não tenha, a Maia apresenta alternativas de estrutura para viabilizar o investimento.",
  },
  {
    question: "Qual o valor mínimo para investir?",
    answer:
      "O modelo padrão atual parte de R$300 mil, referente a uma usina de aproximadamente 120kWp. Projetos maiores ou menores podem ser avaliados caso a caso.",
  },
  {
    question: "Qual o retorno projetado de uma usina de investimento?",
    answer:
      "O retorno projetado varia conforme localização, tipo de conexão e condições comerciais do projeto, ficando geralmente entre 1,5% e 2,7% ao mês em cenário conservador. Os indicadores exatos (TIR, VPL, payback) são apresentados no memorando técnico-financeiro de cada projeto.",
  },
  {
    question: "Quanto tempo leva para o investimento se pagar?",
    answer:
      "O payback estimado costuma ficar entre 3 e 4 anos, a depender da produtividade da região, do tipo de conexão e das condições comerciais do projeto específico.",
  },
  {
    question: "A usina fica registrada no meu nome?",
    answer:
      "Sim. Cada usina é registrada com o CPF ou CNPJ do investidor, normalmente por meio de uma estrutura societária dedicada ao projeto (SPE).",
  },
  {
    question: "Quem cuida da operação e manutenção da usina?",
    answer:
      "A Maia oferece suporte contínuo para operação e manutenção do sistema, acompanhando desempenho e cuidando dos aspectos técnicos ao longo da vida útil do ativo.",
  },
  {
    question: "Preciso ser uma empresa para investir?",
    answer:
      "Não. O investimento pode ser feito por pessoa física ou jurídica. Cada caso é avaliado individualmente para definir o modelo tributário e operacional mais adequado.",
  },
  {
    question: "Preciso entender de energia solar para investir?",
    answer:
      "Não é necessário. A Maia cuida da parte técnica, regulatória e operacional do projeto — o investidor acompanha os resultados e recebe os relatórios do andamento.",
  },
  {
    question: "É possível financiar o investimento?",
    answer:
      "Sim. Há linhas de crédito específicas para projetos de energia solar, além da opção de parcelamento em até 18x (juros de 0,53% a.m. no cartão). A Maia orienta sobre as melhores opções conforme o perfil do investidor.",
  },
  {
    question: "Qual a garantia dos equipamentos da usina?",
    answer:
      "As placas fotovoltaicas contam com garantia de fabricação de 10 a 15 anos e garantia de eficiência mínima de 80% ao longo de 25 anos. Os inversores têm garantia mínima de 5 anos, e a instalação, geralmente 1 ano. Manutenção regular é recomendada para preservar a eficiência do sistema.",
  },
  {
    question: "É possível obter receita adicional com créditos de carbono?",
    answer:
      "Sim. A Maia pode estruturar o projeto de créditos de carbono para a usina, com potencial de gerar uma receita líquida anual estimada entre R$10.000 e R$15.000 por usina, ao longo de um período de até 10 anos — valores sujeitos às condições do mercado de carbono.",
  },
  {
    question: "É seguro investir em energia solar?",
    answer:
      "Como qualquer investimento em ativo real, envolve riscos — variação na geração de energia, mudanças regulatórias e condições de mercado. A Maia reduz esses riscos com análise técnica, financeira e regulatória prévia, estrutura societária dedicada (SPE) e acompanhamento contínuo da operação, mas não existe garantia de retorno: os indicadores apresentados são projeções em cenário conservador.",
  },
];

// Rascunho inicial para o público de eficiência energética — revisar com o
// cliente antes de publicar, pois não houve perguntas específicas fornecidas.
export const businessFaq: FaqItem[] = [
  {
    question: "Como sei se minha empresa está pagando mais do que deveria pela energia?",
    answer:
      "O primeiro passo é um diagnóstico energético: a Maia analisa a conta de energia mais recente da empresa — que já traz o histórico de consumo dos últimos 12 meses — para identificar problemas como demanda contratada inadequada, cobrança por ultrapassagem, energia reativa excedente e fator de potência fora do ideal.",
  },
  {
    question: "O que é demanda contratada e por que ela pode gerar cobranças indevidas?",
    answer:
      "É o volume de energia que a empresa se compromete a ter disponível junto à distribuidora. Quando esse valor está mal dimensionado — alto demais ou sujeito a ultrapassagens frequentes — a empresa paga por capacidade que não usa ou é multada por excedê-la.",
  },
  {
    question: "O que é fator de potência e como ele impacta a conta de energia?",
    answer:
      "É um indicador de eficiência no uso da energia elétrica. Quando fica abaixo do mínimo exigido pela distribuidora, gera cobrança adicional. A correção costuma envolver a instalação de bancos de capacitores.",
  },
  {
    question: "Minha empresa precisa gastar acima de R$50 mil por mês em energia para ser atendida?",
    answer:
      "Esse é o perfil onde as soluções de eficiência energética costumam gerar o maior impacto proporcional, mas cada caso é avaliado individualmente a partir do diagnóstico.",
  },
  {
    question: "Quais soluções a Maia pode implementar além da geração solar?",
    answer:
      "Conforme o diagnóstico, a atuação pode incluir revisão da demanda contratada, adequação tarifária, correção do fator de potência, sistemas de armazenamento de energia (BESS), modernização de subestações, automação e gestão de cargas.",
  },
  {
    question: "Como funciona o processo, do diagnóstico até a implementação?",
    answer:
      "A Maia analisa o histórico de consumo e a estrutura elétrica da empresa, apresenta as oportunidades identificadas com os investimentos e economias estimadas para cada medida, e acompanha a implementação das soluções aprovadas.",
  },
  {
    question: "Quanto minha empresa pode economizar?",
    answer:
      "A economia depende do perfil de consumo, da tarifa, da demanda contratada e das condições da instalação. Os valores são calculados individualmente após o diagnóstico energético — em situações com desperdícios relevantes, a redução pode ser expressiva.",
  },
  {
    question: "Que documentos preciso enviar para uma análise preliminar?",
    answer:
      "Basta enviar a conta de energia mais recente da empresa — ela já traz o histórico de consumo dos últimos 12 meses. Com isso, a Maia consegue fazer uma primeira leitura do perfil de consumo e indicar as oportunidades mais prováveis.",
  },
  {
    question: "Como reduzir a conta de energia da minha indústria?",
    answer:
      "O caminho estruturado combina engenharia energética (diagnóstico técnico do consumo e da instalação), gestão de créditos de energia e correção de eventuais distorções na demanda contratada e no fator de potência. A partir desse diagnóstico, a Maia dimensiona as medidas com maior potencial de redução para o perfil específico da indústria.",
  },
  {
    question: "Minha empresa paga multa por ultrapassagem de demanda contratada?",
    answer:
      "Se o consumo ultrapassa com frequência o valor contratado junto à distribuidora, é comum haver cobrança adicional por ultrapassagem de demanda. O primeiro passo é revisar se o valor contratado ainda faz sentido para o perfil atual de consumo — em muitos casos, um ajuste na demanda contratada elimina ou reduz essa cobrança.",
  },
  {
    question: "Vale a pena instalar banco de capacitores na minha empresa?",
    answer:
      "Depende do fator de potência atual da instalação. Quando ele fica abaixo do mínimo exigido pela distribuidora, a empresa paga uma cobrança adicional na conta — nesses casos, o banco de capacitores costuma ter payback rápido. A Maia avalia isso dentro do diagnóstico energético antes de recomendar a instalação.",
  },
  {
    question: "O que é geração distribuída de energia?",
    answer:
      "É o modelo regulamentado pela ANEEL em que a energia é gerada perto de onde é consumida (por exemplo, uma usina solar) e os créditos gerados abatem o consumo da unidade, podendo ser compartilhados entre unidades do mesmo titular ou consórcio. É a base regulatória que viabiliza tanto usinas de investimento quanto soluções de eficiência energética para empresas.",
  },
  {
    question: "Quanto custa migrar para o mercado livre de energia?",
    answer:
      "Não há um valor fixo — depende do perfil de consumo, da demanda contratada e das condições comerciais negociadas com o fornecedor. A Maia avalia se a migração faz sentido para o perfil da empresa dentro do diagnóstico energético, comparando o cenário atual no mercado regulado com as condições estimadas no mercado livre.",
  },
];
