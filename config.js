/* Stone Dren · configuração do site (dados do negócio, não da calculadora).
 * Tudo que está entre colchetes é PENDENTE e precisa vir do cliente antes de publicar.
 * A tabela de consumo da calculadora mora em calc.js, versionada.
 */
window.STONE_DREN_SITE = {
  // PENDENTE: número do comercial Stone Dren. Este é o do Washington Insumos, usado só no rascunho.
  whatsappComercial: "5561991795986",
  whatsappConfirmado: false,

  // Opcional: URL que recebe o lead (Google Apps Script, Formspree etc.). Vazio = só WhatsApp.
  leadWebhookUrl: "",

  // Identificação do controlador (LGPD) e do franqueador (Lei 13.966/2019).
  empresa: {
    razaoSocial: "[RAZÃO SOCIAL]",
    cnpj: "[00.000.000/0000-00]",
    endereco: "[endereço completo, CEP]",
    email: "[contato@dominio.com.br]",
    emailPrivacidade: "[privacidade@dominio.com.br]",
    encarregado: "[nome do encarregado de dados]",
    cidadeUnidadeModelo: "Goiânia/GO"
  },

  politicaAtualizadaEm: "setembro de 2026"
};
