// Gerador de proposta comercial em PDF (client-side, jsPDF + jspdf-autotable),
// compartilhado entre o módulo Solar (Grupo B) e o módulo BESS/Eficiência (Grupo A).
// Layout segue o modelo de proposta fornecido pela Maia: capa/identificação,
// resumo executivo, diagnóstico, escopo, tabela financeira + gráfico, condições
// comerciais, cronograma e aceite.

import { site } from "../data/site.ts";

const NAVY = [11, 61, 98];
const NAVY_DARK = [7, 42, 69];
const ORANGE = [245, 166, 35];
const GRAY_TEXT = [50, 50, 50];
const GRAY_MUTED = [130, 130, 130];
const PAGE_W = 210;
const MARGIN_L = 16;
const MARGIN_R = 16;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const BOTTOM_LIMIT = 275;

let logoDataUrlPromise = null;
function carregarLogo() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch("/logo.png")
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      )
      .then(
        (dataUrl) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ dataUrl, ratio: img.naturalHeight / img.naturalWidth });
            img.onerror = () => resolve(null);
            img.src = dataUrl;
          })
      )
      .catch(() => null);
  }
  return logoDataUrlPromise;
}

function brl(n) {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

class Builder {
  constructor(doc, logo) {
    this.doc = doc;
    this.logo = logo;
    this.y = 18;
  }

  ensure(altura) {
    if (this.y + altura > BOTTOM_LIMIT) {
      this.doc.addPage();
      this.y = 18;
    }
  }

  titulo(texto) {
    this.ensure(14);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(12.5);
    this.doc.setTextColor(...NAVY);
    this.doc.text(texto, MARGIN_L, this.y);
    this.doc.setDrawColor(...ORANGE);
    this.doc.setLineWidth(0.6);
    this.doc.line(MARGIN_L, this.y + 1.8, PAGE_W - MARGIN_R, this.y + 1.8);
    this.y += 7.5;
  }

  paragrafo(texto) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(10);
    this.doc.setTextColor(...GRAY_TEXT);
    const linhas = this.doc.splitTextToSize(texto, CONTENT_W);
    this.ensure(linhas.length * 5 + 2);
    this.doc.text(linhas, MARGIN_L, this.y);
    this.y += linhas.length * 5 + 4;
  }

  bullets(itens) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(10);
    this.doc.setTextColor(...GRAY_TEXT);
    itens.forEach((item) => {
      const linhas = this.doc.splitTextToSize(item, CONTENT_W - 6);
      this.ensure(linhas.length * 5 + 1.5);
      this.doc.setFillColor(...ORANGE);
      this.doc.circle(MARGIN_L + 1, this.y - 1.3, 0.8, "F");
      this.doc.text(linhas, MARGIN_L + 5, this.y);
      this.y += linhas.length * 5 + 1.5;
    });
    this.y += 2.5;
  }

  tabela(head, body) {
    this.ensure(14);
    this.doc.autoTable({
      startY: this.y,
      head: [head],
      body,
      margin: { left: MARGIN_L, right: MARGIN_R },
      styles: { font: "helvetica", fontSize: 9.5, textColor: GRAY_TEXT, cellPadding: 3 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 249, 252] },
    });
    this.y = this.doc.lastAutoTable.finalY + 8;
  }

  imagemGrafico(canvas, alturaMm = 65) {
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png", 1.0);
      const larguraMm = CONTENT_W;
      this.ensure(alturaMm + 4);
      this.doc.setDrawColor(226, 232, 240);
      this.doc.roundedRect(MARGIN_L, this.y, larguraMm, alturaMm, 2, 2, "S");
      this.doc.addImage(dataUrl, "PNG", MARGIN_L + 2, this.y + 2, larguraMm - 4, alturaMm - 4, undefined, "FAST");
      this.y += alturaMm + 8;
    } catch {
      // Canvas tainted ou indisponível — segue sem o gráfico em vez de quebrar o PDF.
    }
  }

  assinaturas(clienteLabel, empresaLabel) {
    this.ensure(30);
    const colW = (CONTENT_W - 10) / 2;
    const yLine = this.y + 16;
    this.doc.setDrawColor(150, 150, 150);
    this.doc.line(MARGIN_L, yLine, MARGIN_L + colW, yLine);
    this.doc.line(MARGIN_L + colW + 10, yLine, MARGIN_L + colW + 10 + colW, yLine);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9.5);
    this.doc.setTextColor(...GRAY_TEXT);
    this.doc.text(clienteLabel, MARGIN_L, yLine + 5);
    this.doc.text(empresaLabel, MARGIN_L + colW + 10, yLine + 5);
    this.y = yLine + 12;
  }
}

function desenharCabecalho(doc, logo, { subtitulo, codigoProposta, dataProposta }) {
  if (logo) {
    // A arte do logo.png tem bastante espaço em branco acima/abaixo e o texto
    // "ENERGIAS RENOVÁVEIS" é uma legenda pequena por baixo de "MAIA" — precisa de
    // um tamanho generoso pra essa legenda ficar legível, não só pra não cortar.
    const w = 22;
    const h = w * logo.ratio;
    doc.addImage(logo.dataUrl, "PNG", MARGIN_L, 6, w, h);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text("PROPOSTA COMERCIAL", PAGE_W - MARGIN_R, 18, { align: "right" });
  doc.setFontSize(10.5);
  doc.setTextColor(...NAVY_DARK);
  doc.text(subtitulo, PAGE_W - MARGIN_R, 24, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY_MUTED);
  doc.text(`Proposta ${codigoProposta}  ·  ${dataProposta}`, PAGE_W - MARGIN_R, 29.5, { align: "right" });
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_L, 33, PAGE_W - MARGIN_R, 33);
}

function desenharRodapes(doc) {
  const total = doc.internal.getNumberOfPages();
  const endereco = site.addresses[0];
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_L, 285, PAGE_W - MARGIN_R, 285);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY_MUTED);
    doc.text(`${site.legalName} · CNPJ ${site.cnpj} · ${site.whatsappDisplay} · ${endereco.city}/${endereco.state}`, MARGIN_L, 290);
    doc.text(`Página ${i}/${total}`, PAGE_W - MARGIN_R, 290, { align: "right" });
  }
}

/**
 * @param {object} opts
 * @param {string} opts.subtitulo - ex: "Sistema de Energia Solar Fotovoltaica"
 * @param {string} opts.codigoProposta
 * @param {string} opts.cliente
 * @param {string} opts.responsavelNome
 * @param {string} opts.responsavelCargo
 * @param {string} opts.email
 * @param {string} opts.resumoExecutivo
 * @param {string[]} opts.diagnostico
 * @param {string[]} opts.escopo
 * @param {[string,string][]} opts.tabelaFinanceira
 * @param {HTMLCanvasElement|null} opts.graficoCanvas
 * @param {HTMLCanvasElement|null} [opts.graficoSecundario] - segundo gráfico opcional, exibido logo após o principal
 * @param {{titulo: string, head: string[], body: (string|number)[][]}} [opts.tabelaSecundaria] - tabela opcional adicional na seção 4 (ex.: detalhamento mês a mês)
 * @param {number} opts.investimentoTotal
 * @param {string} opts.formaPagamento
 * @param {number} opts.prazoExecucaoDias
 * @param {number} opts.validadeDias
 * @param {string[]} opts.cronograma
 * @param {string} opts.notaRodape
 * @param {string} opts.fileName
 */
export async function gerarPropostaPdf(opts) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logo = await carregarLogo();

  const hoje = new Date();
  const dataProposta = hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  desenharCabecalho(doc, logo, { subtitulo: opts.subtitulo, codigoProposta: opts.codigoProposta, dataProposta });

  const b = new Builder(doc, logo);
  b.y = 39;

  // Preparado para
  doc.setFillColor(246, 249, 252);
  doc.roundedRect(MARGIN_L, b.y, CONTENT_W, 20, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text("PREPARADO PARA", MARGIN_L + 4, b.y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...GRAY_TEXT);
  doc.text(`Cliente: ${opts.cliente || "—"}`, MARGIN_L + 4, b.y + 12);
  const acLine = [opts.responsavelNome && `A/C: ${opts.responsavelNome}`, opts.responsavelCargo, opts.email].filter(Boolean).join("   ·   ");
  doc.text(acLine || "—", MARGIN_L + 4, b.y + 17);
  b.y += 26;

  b.titulo("1. Resumo Executivo");
  b.paragrafo(opts.resumoExecutivo);

  b.titulo("2. Diagnóstico Técnico (o cenário atual)");
  b.bullets(opts.diagnostico);

  b.titulo("3. Escopo da Solução Proposta");
  b.bullets(opts.escopo);

  doc.addPage();
  b.y = 18;

  b.titulo("4. Estimativa de Redução e Payback");
  b.tabela(["Indicador financeiro", "Valor estimado"], opts.tabelaFinanceira);
  b.imagemGrafico(opts.graficoCanvas);
  if (opts.graficoSecundario) b.imagemGrafico(opts.graficoSecundario, 60);
  if (opts.tabelaSecundaria) {
    b.paragrafo(opts.tabelaSecundaria.titulo);
    b.tabela(opts.tabelaSecundaria.head, opts.tabelaSecundaria.body);
  }

  b.titulo("5. Investimento e Condições Comerciais");
  b.tabela(
    ["Item", "Condição"],
    [
      ["Valor total do projeto", brl(opts.investimentoTotal)],
      ["Forma de pagamento", opts.formaPagamento || "—"],
      ["Prazo de execução", `${opts.prazoExecucaoDias} dias úteis a partir da assinatura do contrato`],
      ["Validade desta proposta", `${opts.validadeDias} dias`],
    ]
  );

  b.titulo("6. Cronograma Estimado de Implementação");
  b.bullets(opts.cronograma);

  b.titulo("7. Aceite da Proposta");
  b.paragrafo("Para darmos início ao projeto, por favor assine e date o campo abaixo:");
  b.assinaturas(`${opts.cliente || "Cliente"}${opts.responsavelCargo ? " — " + opts.responsavelCargo : ""}`, `${site.legalName}`);

  if (opts.notaRodape) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY_MUTED);
    const linhas = doc.splitTextToSize(opts.notaRodape, CONTENT_W);
    b.ensure(linhas.length * 3.5 + 2);
    doc.text(linhas, MARGIN_L, b.y);
  }

  desenharRodapes(doc);
  doc.save(opts.fileName);
}
