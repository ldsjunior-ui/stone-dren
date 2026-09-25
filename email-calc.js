/* Stone Dren · e-mail do cálculo (puro, sem DOM).
 *
 * Um só modelo para dois lugares: a prévia na página (window.StoneDrenEmail) e o
 * servidor do Google Apps Script, que refaz o cálculo com o mesmo calc.js e envia
 * este e-mail. No Node (testes) sai por module.exports.
 *
 * Entrada: o resultado de StoneDrenCalc.calcularObra(obra), o lead e as opções.
 * Saída: { assunto, html, texto }. Todo texto vindo da pessoa passa por esc().
 * HTML de e-mail: tabelas e estilo inline, sem script, sem CSS externo.
 */
(function (root) {
  "use strict";

  function motor() {
    if (root && root.StoneDrenCalc) return root.StoneDrenCalc;
    if (typeof StoneDrenCalc !== "undefined") return StoneDrenCalc; // Apps Script: variável global do Code.gs
    if (typeof require === "function") return require("./calc.js");
    return null;
  }

  var COR = {
    fundo: "#F5F1E8", cartao: "#FFFFFF", navy: "#0A1526", navy2: "#101E36", texto: "#1B2433",
    suave: "#5B6474", linha: "#E6DFD0", ouro: "#C68A2E", ouroTexto: "#7A5412", aviso: "#FFF7E6"
  };
  var FONTE = "Montserrat, Arial, Helvetica, sans-serif";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // número e unidade não se separam na quebra de linha
  function nb(s) { return String(s).replace(/(\d) (mm|cm|m²|m³|kg|sacos?|kits?|painéis|painel)(?![\wÀ-ÿ²³])/g, "$1\u00a0$2"); }
  function e(s) { return nb(esc(s)); }
  function soDigitos(v) { return String(v || "").replace(/\D/g, ""); }
  function linkWhats(numero, texto) {
    var n = soDigitos(numero);
    return n ? "https://wa.me/" + n + (texto ? "?text=" + encodeURIComponent(texto) : "") : "";
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function pendente(v) { return !v || /^\[.*\]$/.test(String(v)); }

  /* ---------- blocos ---------- */

  function botao(href, rotulo) {
    if (!href) return "";
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr><td style="border-radius:8px;background:' + COR.ouro + ';">' +
      '<a href="' + esc(href) + '" target="_blank" style="display:inline-block;padding:13px 22px;font-family:' + FONTE + ';font-size:15px;font-weight:700;color:' + COR.navy + ';text-decoration:none;border-radius:8px;">' + e(rotulo) + '</a></td></tr></table>';
  }
  function titulo(t) {
    return '<p style="margin:22px 0 8px;font-family:' + FONTE + ';font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:' + COR.ouroTexto + ';">' + e(t) + '</p>';
  }
  function paragrafo(t, estilo) {
    return '<p style="margin:0 0 12px;font-family:' + FONTE + ';font-size:15px;line-height:1.6;color:' + COR.texto + ';' + (estilo || "") + '">' + t + '</p>';
  }
  function linhaMaterial(nome, detalhe, qtd, qtd2) {
    return '<tr>' +
      '<td style="padding:12px 0;border-top:1px solid ' + COR.linha + ';font-family:' + FONTE + ';vertical-align:top;">' +
      '<b style="display:block;font-size:15px;color:' + COR.texto + ';">' + e(nome) + '</b>' +
      (detalhe ? '<span style="display:block;margin-top:2px;font-size:13px;line-height:1.45;color:' + COR.suave + ';">' + e(detalhe) + '</span>' : '') +
      '</td>' +
      '<td style="padding:12px 0 12px 12px;border-top:1px solid ' + COR.linha + ';font-family:' + FONTE + ';text-align:right;vertical-align:top;white-space:nowrap;">' +
      '<b style="display:block;font-size:16px;color:' + COR.navy + ';">' + e(qtd) + '</b>' +
      (qtd2 ? '<span style="display:block;margin-top:2px;font-size:12px;color:' + COR.suave + ';">' + e(qtd2) + '</span>' : '') +
      '</td></tr>';
  }

  function tabelaMateriais(C, r) {
    var t = r.totais, T = C.TABELA;
    var h = "";
    if (t) {
      var cor = r.corRotulo.toLowerCase();
      h += linhaMaterial("Pedra natural " + cor, "Sacos de " + t.pedra.sacoKg + " kg (peso do saco a confirmar), perda de " + C.fmtAuto(T.pedra.perda * 100) + "% incluída", C.qtd(t.pedra.sacos, "saco", "sacos"), C.fmtKg(t.pedra.kg));
      h += linhaMaterial("Resina " + t.resina.curto + " com endurecedor", cap(T.resina.kitPremissa) + ".", C.qtd(t.resina.kits, "kit", "kits"), C.fmtKg(t.resina.kg) + " misturada");
      if (t.brita) h += linhaMaterial("Brita para a base", "Base sobre solo, sacos de " + t.brita.sacoKg + " kg" + (t.brita.granel ? ". Acima de " + T.brita.granelAcimaM3 + " m³, vale comprar a granel" : ""), C.qtd(t.brita.sacos, "saco", "sacos"), C.fmtKg(t.brita.kg) + " · " + C.fmtM3(t.brita.m3));
      if (t.malha) h += linhaMaterial("Malha POP " + t.malha.painelRotulo, cap(T.malha.premissa) + ".", C.qtd(t.malha.paineis, "painel", "painéis"), "para " + C.fmtAuto(t.malha.areaM2) + " m² de laje");
      if (t.laje) h += linhaMaterial("Laje de concreto armado de " + T.laje.cm + " cm", "Garagem sobre solo. O concreto depende do projeto da base", "Não calculada", "consulte a equipe técnica");
    }
    if (r.consulte) h += linhaMaterial("Ambientes a consultar", "Garagem direto sobre brita não entra nesta versão do cálculo. A equipe técnica indica a base e as quantidades", "Consulte a equipe", C.fmtAuto(r.areaConsulteM2) + " m² fora do cálculo");
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + h + '</table>';
  }

  function porAmbiente(C, r) {
    var itens = [];
    r.ambientes.forEach(function (a, i) {
      if (a.estado === "incompleto") return;
      var nome = C.nomeAmbiente(a, i);
      var meta = a.usoRotulo + " · " + a.baseRotulo.toLowerCase() + " · " + C.fmtAuto(a.areaM2) + " m² · " + C.fmtMm(a.espessuraMm);
      var det;
      if (a.estado === "consulte") det = a.motivo;
      else {
        det = "Pedra " + C.fmtKg(a.pedra.kg) + " (" + C.qtd(a.pedra.sacos, "saco", "sacos") + "), resina " + C.fmtKg(a.resina.kg) +
          (a.brita ? ", brita " + C.fmtKg(a.brita.kg) + " em camada de " + a.brita.cm + " cm" : "") +
          (a.malha ? ", malha " + C.qtd(a.malha.paineis, "painel", "painéis") : "") +
          (a.laje ? ", laje de " + C.TABELA.laje.cm + " cm não calculada" : "") + "." +
          (a.abaixoDoMinimo ? " Espessura abaixo da referência de " + a.espessuraMinimaMm + " mm." : "") +
          (a.aConfirmar ? " Consumo de referência a confirmar." : "");
      }
      itens.push('<tr><td style="padding:10px 0;border-top:1px solid ' + COR.linha + ';font-family:' + FONTE + ';">' +
        '<b style="display:block;font-size:14px;color:' + COR.texto + ';">' + e(nome) + '</b>' +
        '<span style="display:block;font-size:12px;color:' + COR.suave + ';margin:2px 0 4px;">' + e(meta) + '</span>' +
        '<span style="display:block;font-size:13px;line-height:1.5;color:' + COR.texto + ';">' + e(det) + '</span></td></tr>');
    });
    if (!itens.length) return "";
    return titulo("Por ambiente") + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + itens.join("") + '</table>';
  }

  function blocoAviso(C, r) {
    var av = C.aviso(r);
    if (!av) return "";
    var h = titulo("Premissas e aviso");
    h += '<div style="background:' + COR.aviso + ';border-radius:10px;padding:14px 16px;">';
    h += '<p style="margin:0 0 10px;font-family:' + FONTE + ';font-size:13px;line-height:1.6;color:' + COR.texto + ';">' + e(av.paragrafos[0]) + '</p>';
    if (av.premissas.length) {
      h += '<ul style="margin:0 0 10px;padding-left:18px;font-family:' + FONTE + ';font-size:13px;line-height:1.6;color:' + COR.texto + ';">' +
        av.premissas.map(function (p) { return '<li style="margin:0 0 4px;">' + e(p) + '</li>'; }).join("") + '</ul>';
    }
    if (av.base) h += '<p style="margin:0 0 10px;font-family:' + FONTE + ';font-size:13px;line-height:1.6;color:' + COR.texto + ';">' + e(av.base) + '</p>';
    h += '<p style="margin:0;font-family:' + FONTE + ';font-size:13px;line-height:1.6;color:' + COR.texto + ';">' + e(av.paragrafos[1]) + '</p>';
    h += '</div>';
    return h;
  }

  function recomendados(C, r) {
    var rec = C.recomendadosDaObra(r);
    var t = r.totais;
    var pend = t && t.aConfirmar;
    if (!rec.length && !pend) return "";
    var h = titulo("Recomendado, não incluso");
    if (rec.length) h += '<ul style="margin:0 0 8px;padding-left:18px;font-family:' + FONTE + ';font-size:14px;line-height:1.6;color:' + COR.texto + ';">' +
      rec.map(function (x) { return '<li><b>' + e(x.rotulo) + '</b> ' + e(x.texto) + '</li>'; }).join("") + '</ul>';
    if (pend) h += paragrafo(e("Entorno de piscina: consumo de referência a confirmar."), "font-size:13px;color:" + COR.suave + ";");
    return h;
  }

  function faixaTeste(opts) {
    if (!opts.teste) return "";
    return '<tr><td style="background:' + COR.aviso + ';padding:10px 24px;font-family:' + FONTE + ';font-size:12px;line-height:1.5;color:' + COR.ouroTexto + ';text-align:center;">' +
      'Este e-mail faz parte de um teste da calculadora Stone Dren.</td></tr>';
  }

  function moldura(conteudo, preheader, opts) {
    var logo = opts.siteUrl ? '<img src="' + esc(opts.siteUrl.replace(/\/?$/, "/") + "img/stone-mark-128.png") + '" width="36" height="36" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:10px;">' : "";
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Stone Dren</title></head>' +
      '<body style="margin:0;padding:0;background:' + COR.fundo + ';">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(preheader) + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + COR.fundo + ';"><tr><td align="center" style="padding:24px 12px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:' + COR.cartao + ';border-radius:14px;overflow:hidden;">' +
      '<tr><td style="background:' + COR.navy + ';padding:18px 24px;">' + logo +
      '<span style="font-family:' + FONTE + ';font-size:20px;font-weight:800;letter-spacing:.5px;color:#EFE7D6;vertical-align:middle;">Stone <span style="color:' + COR.ouro + ';">Dren</span></span></td></tr>' +
      faixaTeste(opts) +
      '<tr><td style="padding:24px;">' + conteudo + '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }

  function rodapeCliente(C, opts) {
    var emp = opts.empresa || {};
    var ident = [];
    if (!pendente(emp.razaoSocial)) ident.push(esc(emp.razaoSocial));
    if (!pendente(emp.cnpj)) ident.push("CNPJ " + esc(emp.cnpj));
    var priv = !pendente(emp.emailPrivacidade) ? " Para pedir acesso, correção ou exclusão dos seus dados, escreva para " + esc(emp.emailPrivacidade) + "." : "";
    return '<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ' + COR.linha + ';font-family:' + FONTE + ';font-size:12px;line-height:1.6;color:' + COR.suave + ';">' +
      e(C.SEGURANCA) + '</p>' +
      '<p style="margin:10px 0 0;font-family:' + FONTE + ';font-size:12px;line-height:1.6;color:' + COR.suave + ';">' +
      'Você recebeu este e-mail porque pediu o cálculo na calculadora Stone Dren.' + priv + (ident.length ? " " + ident.join(" · ") + "." : "") + '</p>';
  }

  /* ---------- e-mail para a pessoa que fez o cálculo ----------
   * Vai para um endereço que ninguém confirmou: por isso NÃO leva nenhum texto digitado
   * (nem o nome da pessoa, nem os nomes dos ambientes). Sem isso, qualquer um poderia usar a
   * calculadora para mandar um texto próprio a terceiros pela conta da Stone Dren. Os nomes
   * seguem só na cópia do comercial. */

  function semTextoLivre(r) {
    var c = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
    c.ambientes = (r.ambientes || []).map(function (a) {
      var x = {};
      for (var j in a) if (Object.prototype.hasOwnProperty.call(a, j)) x[j] = a[j];
      x.nome = "";
      return x;
    });
    return c;
  }

  function montarEmailCliente(rOriginal, lead, opts) {
    var C = motor();
    opts = opts || {};
    lead = lead || {};
    var r = semTextoLivre(rOriginal);
    var t = r.totais;
    var area = t ? C.fmtAuto(t.areaM2) + " m²" : C.fmtAuto(r.areaConsulteM2) + " m² a avaliar";
    var assunto = (opts.teste ? "[Teste] " : "") + "Seu cálculo Stone Dren: " + area;
    var wa = linkWhats(opts.whatsapp, C.mensagemWhatsApp(r));

    var sub = t
      ? C.fmtAuto(t.areaM2) + " m² · " + r.calculados + (r.calculados === 1 ? " ambiente" : " ambientes") + " · resina " + t.resina.curto + " · pedra " + r.corRotulo.toLowerCase()
      : C.fmtAuto(r.areaConsulteM2) + " m² · " + r.consulte + (r.consulte === 1 ? " ambiente" : " ambientes") + " a consultar com a equipe técnica";

    var h = "";
    h += paragrafo(e("Olá. Aqui está a estimativa de materiais da sua obra, do jeito que você montou na calculadora."));
    h += '<p style="margin:0 0 4px;font-family:' + FONTE + ';font-size:22px;font-weight:800;color:' + COR.navy + ';">Seu cálculo</p>';
    h += '<p style="margin:0 0 14px;font-family:' + FONTE + ';font-size:14px;color:' + COR.suave + ';">' + e(sub) + (opts.quando ? '<br>' + e("Cálculo de " + opts.quando) : '') + '</p>';
    h += titulo("Materiais estimados") + tabelaMateriais(C, r);
    h += recomendados(C, r);
    h += porAmbiente(C, r);
    h += blocoAviso(C, r);
    h += titulo("Próximo passo");
    h += paragrafo(e("Para confirmar as quantidades e pedir o orçamento, fale com o comercial. A mensagem já vai com o resumo do cálculo."));
    h += botao(wa, "Falar com o comercial no WhatsApp");
    h += rodapeCliente(C, opts);

    var texto = C.textoLista(r) + (wa ? "\n\nFalar com o comercial no WhatsApp: " + wa : "") +
      "\n\nVocê recebeu este e-mail porque pediu o cálculo na calculadora Stone Dren.";
    if (opts.teste) texto = "Este e-mail faz parte de um teste da calculadora Stone Dren.\n\n" + texto;
    return { assunto: assunto, html: moldura(h, "Estimativa de materiais: " + area + ".", opts), texto: texto };
  }

  /* ---------- aviso para o comercial (novo contato) ---------- */

  function linhaDado(k, v) {
    return '<tr><td style="padding:6px 12px 6px 0;font-family:' + FONTE + ';font-size:13px;color:' + COR.suave + ';vertical-align:top;white-space:nowrap;">' + e(k) + '</td>' +
      '<td style="padding:6px 0;font-family:' + FONTE + ';font-size:14px;color:' + COR.texto + ';">' + v + '</td></tr>';
  }

  function montarEmailComercial(r, lead, opts) {
    var C = motor();
    opts = opts || {};
    lead = lead || {};
    var t = r.totais;
    var area = t ? C.fmtAuto(t.areaM2) + " m²" : C.fmtAuto(r.areaConsulteM2) + " m² a avaliar";
    var assunto = (opts.teste ? "[Teste] " : "") + "Novo cálculo Stone Dren: " + String(lead.nome || "sem nome").slice(0, 60) + " · " + String(lead.cidadeUf || "").slice(0, 40) + " · " + area;
    var zap = soDigitos(lead.whatsapp);
    var zapIntl = zap.length === 10 || zap.length === 11 ? "55" + zap : zap;
    var h = "";
    h += '<p style="margin:0 0 6px;font-family:' + FONTE + ';font-size:20px;font-weight:800;color:' + COR.navy + ';">Novo cálculo na calculadora</p>';
    h += paragrafo(e("Alguém montou uma obra e pediu o cálculo" + (lead.email ? ", que foi enviado para o e-mail abaixo." : ".") + " Os dados vieram do formulário do site."), "color:" + COR.suave + ";font-size:14px;");
    h += '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
      linhaDado("Nome", e(lead.nome || "")) +
      linhaDado("WhatsApp", zap ? '<a href="' + esc(linkWhats(zapIntl, "")) + '" target="_blank" style="color:' + COR.ouroTexto + ';">' + e(lead.whatsapp) + '</a>' : "") +
      (lead.email ? linhaDado("E-mail", '<a href="mailto:' + esc(lead.email) + '" style="color:' + COR.ouroTexto + ';">' + e(lead.email) + '</a>') : "") +
      linhaDado("Cidade/UF", e(lead.cidadeUf || "")) +
      linhaDado("Perfil", e(lead.perfil || "")) +
      linhaDado("Novidades", e(lead.optin ? "Aceitou receber" : "Não marcou")) +
      linhaDado("Área", e(area)) +
      (opts.quando ? linhaDado("Quando", e(opts.quando)) : "") +
      (opts.pagina ? linhaDado("Página", e(opts.pagina)) : "") +
      '</table>';
    h += titulo("Materiais estimados") + tabelaMateriais(C, r);
    h += porAmbiente(C, r);
    h += '<p style="margin:20px 0 0;font-family:' + FONTE + ';font-size:12px;line-height:1.6;color:' + COR.suave + ';">' +
      e((lead.email ? "Responder este e-mail escreve para a pessoa. " : "A pessoa não deixou e-mail: o contato é pelo WhatsApp acima. ") + "Tabela de consumo " + C.TABELA.rotulo + ".") + '</p>';

    var texto = "Novo cálculo na calculadora Stone Dren\n\n" +
      "Nome: " + (lead.nome || "") + "\nWhatsApp: " + (lead.whatsapp || "") + (lead.email ? "\nE-mail: " + lead.email : "") +
      "\nCidade/UF: " + (lead.cidadeUf || "") + "\nPerfil: " + (lead.perfil || "") + "\nNovidades: " + (lead.optin ? "aceitou" : "não marcou") +
      "\n\n" + C.textoLista(r);
    return { assunto: assunto, html: moldura(h, "Novo cálculo: " + area + ".", opts), texto: texto };
  }

  var api = {
    montarEmailCliente: montarEmailCliente,
    montarEmailComercial: montarEmailComercial,
    _esc: esc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.StoneDrenEmail = api;
})(typeof window !== "undefined" ? window : null);
