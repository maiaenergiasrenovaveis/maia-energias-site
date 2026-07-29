export interface Testimonial {
  name: string;
  text: string;
  source: string;
}

export const testimonials: Testimonial[] = [
  {
    name: "Rafael Maia",
    text: "Muito confiável, recomendo como investimento, tive um ótimo atendimento e comunicação, tudo muito claro.",
    source: "Google Meu Negócio",
  },
  {
    name: "Pablo Xavier",
    text: "Empresa comprometida em entregar a melhor experiência ao cliente.",
    source: "Google Meu Negócio",
  },
  {
    name: "Luciano Bezerra",
    text: "Empresa séria e comprometida com os clientes. Atendimento personalizado e muito explicativo! Já sou investidor. Além de trabalharem com energia solar, possuem grande experiência no mercado de hidrogeração. Recomendo!",
    source: "Google Meu Negócio",
  },
];

export const aggregateRating = {
  ratingValue: 5.0,
  reviewCount: 9,
};
