/* Stone Dren · páginas de apoio (calculadora-teste.html e ativar-email.html).
 * Mostra se o envio por e-mail está ativo, copia o código do Apps Script e testa a conexão.
 * Nada de dado pessoal passa por aqui.
 */
(function () {
  "use strict";
  var site = window.STONE_DREN_SITE || {};

  // mesma regra da calculadora: só a URL de um app da Web do Google Apps Script
  function urlEnvio() {
    var u = String(site.emailWebhookUrl || "").trim();
    return /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+\/|macros\/)s\/[A-Za-z0-9_-]+\/exec$/.test(u) ? u : "";
  }
  function conferir(u) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var relogio = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    var o = { method: "GET", credentials: "omit" };
    if (ctrl) o.signal = ctrl.signal;
    return fetch(u, o).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(relogio);
      return j && j.servico === "stone-dren-email" ? j : Promise.reject(new Error("resposta inesperada"));
    }, function (e) { clearTimeout(relogio); throw e; });
  }

  /* ---------- faixa da página de teste ---------- */
  var est = document.getElementById("pgEstado");
  if (est) {
    var u = urlEnvio();
    if (!u) {
      est.setAttribute("data-estado", "previa");
      est.innerHTML = "Envio por e-mail: <b>ainda não ativado</b>. Por enquanto, ao pedir o cálculo, você vê a prévia do e-mail que vai chegar. <a href=\"ativar-email.html\">Como ativar</a>";
    } else {
      conferir(u).then(function (j) {
        if (j.ligado) {
          est.setAttribute("data-estado", "ativo");
          est.innerHTML = "Envio por e-mail: <b>ativo</b>" + (j.teste ? ", em modo de teste" : "") + ".";
        } else {
          est.setAttribute("data-estado", "desligado");
          est.innerHTML = "Envio por e-mail: <b>desligado</b> no momento. A calculadora continua funcionando e a lista pode ir pelo WhatsApp.";
        }
      }).catch(function () {
        est.setAttribute("data-estado", "sem-resposta");
        est.innerHTML = "Envio por e-mail: <b>o servidor não respondeu</b> agora. A calculadora funciona; se o envio falhar, a lista pode ir pelo WhatsApp.";
      });
    }
  }

  /* ---------- copiar o código (ativar-email.html) ---------- */
  var bCopiar = document.getElementById("pgCopiar");
  var cod = document.getElementById("pgCodigo");
  var stCopia = document.getElementById("pgCopiaSt");
  function avisar(msg) { if (stCopia) stCopia.textContent = msg; }
  function selecionar() {
    try {
      var r = document.createRange();
      r.selectNodeContents(cod);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return s;
    } catch (e) { return null; }
  }
  if (bCopiar && cod) {
    bCopiar.addEventListener("click", function () {
      var texto = cod.textContent;
      var ok = function () { avisar("Código copiado (" + texto.split("\n").length + " linhas). Cole no Código.gs, no lugar do que estiver lá."); };
      var alternativo = function () {
        var s = selecionar();
        var foi = false;
        try { foi = !!(s && document.execCommand && document.execCommand("copy")); } catch (e) { foi = false; }
        if (foi) ok(); else avisar("O código ficou selecionado. Use Ctrl+C (no Mac Cmd+C) para copiar.");
      };
      try {
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(ok, alternativo);
        else alternativo();
      } catch (e) { alternativo(); }
    });
  }

  /* ---------- testar a conexão (ativar-email.html) ---------- */
  var bTestar = document.getElementById("pgTestar");
  var stCon = document.getElementById("pgConexaoSt");
  if (bTestar && stCon) {
    if (!urlEnvio()) {
      var txt = document.getElementById("pgConexaoTxt");
      if (txt) txt.textContent = "A página ainda não tem a URL do envio. Depois que o Leonardo colocar a URL, este botão confere se o envio responde.";
    }
    bTestar.addEventListener("click", function () {
      var u2 = urlEnvio();
      if (!u2) { stCon.textContent = "Ainda não há URL configurada na página."; return; }
      stCon.textContent = "Conferindo.";
      bTestar.disabled = true;
      conferir(u2).then(function (j) {
        stCon.textContent = "O envio respondeu: serviço no ar, " + (j.ligado ? "ligado" : "desligado") + (j.teste ? ", em modo de teste" : "") + ".";
      }).catch(function () {
        stCon.textContent = "O envio não respondeu como esperado. Confira na implantação se \"Quem pode acessar\" está como Qualquer pessoa e se a URL termina em /exec.";
      }).then(function () { bTestar.disabled = false; });
    });
  }
})();
