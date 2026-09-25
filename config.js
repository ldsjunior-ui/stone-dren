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

  // Envio do cálculo por e-mail (só nas páginas com a calculadora marcada data-email, como a
  // calculadora-teste.html). É a URL do app da Web do Google Apps Script (apps-script/Code.gs),
  // no formato https://script.google.com/macros/s/.../exec. Vazio = a página mostra só a prévia do e-mail.
  emailWebhookUrl: "",

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

  politicaAtualizadaEm: "setembro de 2026",
  // data da última revisão do conteúdo do site, mantida à mão (aparece no rodapé; nunca a data do build)
  conteudoAtualizadoEm: "setembro de 2026",

  // CHAVE DE LANÇAMENTO (SEO e GEO). Com "ligado" em false tudo sai como prévia: noindex em toda
  // página, sem canonical, sem sitemap e sem llms.txt. Para lançar: dados da empresa sem colchetes,
  // WhatsApp confirmado, urlFinal com a RAIZ do domínio final (https e barra no fim), hospedagem
  // ("github-pages" grava o CNAME, "outra" não grava), decisão sobre robôs de treino de IA
  // (bloquearTreinoDeIA verdadeiro ou falso) e só então "ligado" verdadeiro e ./publicar.sh --lancamento.
  // O build e a trava (trava_lancamento.py) recusam o lançamento e listam o que falta.
  // perfisOficiais: só perfis que existem, no formato { nome: "Instagram", url: "https://..." }.
  // indexNowChave: opcional, 8 a 128 letras ou números (gera o arquivo da chave e avisa o Bing a cada publicação).
  lancamento: {
    ligado: false,
    urlFinal: "",
    urlPrevia: "https://ldsjunior-ui.github.io/stone-dren/",
    hospedagem: "",
    bloquearTreinoDeIA: null,
    perfisOficiais: [],
    indexNowChave: ""
  }
};
