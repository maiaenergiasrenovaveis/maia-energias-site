export const site = {
  name: "Maia Energias Renováveis",
  legalName: "Maia Energias Renováveis",
  cnpj: "32.538.005/0001-69",
  whatsapp: "5511981220711",
  whatsappDisplay: "+55 11 98122-0711",
  email: "contato@maiaenergiasrenovaveis.com.br",
  social: {
    facebook: "https://facebook.com/maiaenergias",
    instagram: "https://instagram.com/maiaenergias/",
  },
  addresses: [
    {
      label: "São Paulo",
      street: "Avenida Imirim, 368, CJ03",
      city: "São Paulo",
      state: "SP",
      country: "BR",
    },
    {
      label: "Natal",
      street: "Rua Desembargador Silvério Soares, 1018",
      city: "Natal",
      state: "RN",
      country: "BR",
    },
  ],
} as const;

export function whatsappLink(message: string) {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
}
