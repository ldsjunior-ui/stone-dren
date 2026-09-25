/* Stone Dren · comportamento global da página (header, menu, WhatsApp, reveal,
 * loja modelo, dialogs, dados da empresa). A calculadora vive em calc.js + calc-ui.js,
 * o 3D em scenes.js e os efeitos em effects.js.
 */
(function () {
  "use strict";
  var SITE = window.STONE_DREN_SITE || {};
  var EMP = SITE.empresa || {};
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- helpers compartilhados (usados também por calc-ui.js) ---------- */
  function waLink(texto) {
    // Só o texto da mensagem vai na URL. Nunca nome, telefone ou outro dado pessoal.
    var n = String(SITE.whatsappComercial || "").replace(/\D/g, "");
    return "https://wa.me/" + n + "?text=" + encodeURIComponent(texto || "");
  }
  window.StoneDren = { site: SITE, waLink: waLink, reduceMotion: reduceMotion };

  /* ---------- WhatsApp: um texto pré-preenchido por tipo de botão ---------- */
  var WA_TEXT = {
    comercial: "Olá! Vim pelo site da Stone Dren e quero falar com o comercial.",
    franquia: "Olá! Vim pelo site da Stone Dren e quero receber a apresentação da franquia.",
    aplicador: "Olá! Sou aplicador e quero me cadastrar na rede Stone Dren.",
    treinamento: "Olá! Quero saber das próximas turmas de treinamento Stone Dren."
  };
  document.querySelectorAll("[data-wa]").forEach(function (a) {
    var t = WA_TEXT[a.getAttribute("data-wa")] || WA_TEXT.comercial;
    a.setAttribute("href", waLink(t));
  });

  /* ---------- dados da empresa nos textos legais ---------- */
  document.querySelectorAll("[data-cfg]").forEach(function (el) {
    var k = el.getAttribute("data-cfg");
    var v = k === "politicaAtualizadaEm" ? SITE.politicaAtualizadaEm : EMP[k];
    if (v == null) return;
    el.textContent = v;
    if (/^\[.*\]$/.test(String(v))) el.classList.add("pending");
  });
  var pend = [];
  if (/^\[/.test(EMP.razaoSocial || "") || /^\[/.test(EMP.cnpj || "")) pend.push("razão social e CNPJ");
  if (/^\[/.test(EMP.emailPrivacidade || "")) pend.push("e-mail de privacidade");
  if (/^\[/.test(EMP.encarregado || "")) pend.push("encarregado de dados (LGPD, art. 41)");
  if (SITE.whatsappConfirmado === false) pend.push("WhatsApp do comercial");
  if (!SITE.leadWebhookUrl) pend.push("destino dos leads (leadWebhookUrl): sem ele, os dados do formulário da calculadora não chegam a lugar nenhum");
  if (pend.length) { try { console.warn("[Stone Dren] PENDENTE antes de publicar (config.js): " + pend.join("; ") + "."); } catch (e) {} }

  /* ---------- header + menu ---------- */
  var header = document.getElementById("siteHeader");
  if (header) {
    function onScroll() { header.classList.toggle("scrolled", window.scrollY > 12); }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    var navToggle = document.getElementById("navToggle");
    var navLinks = document.getElementById("navLinks");
    var navIcon = document.getElementById("navToggleIcon");
    if (navToggle && navLinks && navIcon) {
      function menuOpen() { return navLinks.classList.contains("is-open"); }
      function setMenu(open, focusFirst) {
        navLinks.classList.toggle("is-open", open);
        navToggle.setAttribute("aria-expanded", open ? "true" : "false");
        navToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
        navIcon.innerHTML = open ? '<path d="M6 6l12 12M18 6L6 18"/>' : '<path d="M4 7h16M4 12h16M4 17h16"/>';
        if (open && focusFirst) {
          var first = navLinks.querySelector("a");
          if (first) first.focus();
        }
      }
      // o menu do celular aparece antes do botão no DOM: ao abrir, o foco entra no primeiro link
      navToggle.addEventListener("click", function (e) { setMenu(!menuOpen(), e.detail === 0); });
      navLinks.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !menuOpen()) return;
        var dentro = navLinks.contains(document.activeElement);
        setMenu(false);
        if (dentro || document.activeElement === navToggle) navToggle.focus();
      });
      // o foco saiu do header com o menu aberto (Tab para o conteúdo): fecha, para o painel não cobrir a página
      header.addEventListener("focusout", function (e) {
        if (!menuOpen()) return;
        if (e.relatedTarget && !header.contains(e.relatedTarget)) setMenu(false);
      });
    }
    // o menu mobile nasce exatamente embaixo do header, qualquer que seja a altura real
    function syncHeaderH() { document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px"); }
    window.addEventListener("resize", syncHeaderH);
    syncHeaderH();
  }

  /* ---------- reveal ---------- */
  var reveals = document.querySelectorAll("[data-reveal]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- cores da pedra na loja modelo ---------- */
  var stage = document.getElementById("bagStage");
  document.querySelectorAll(".sw").forEach(function (b) {
    b.addEventListener("click", function () {
      var cor = b.getAttribute("data-cor");
      document.querySelectorAll(".sw").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      if (stage) {
        stage.querySelectorAll("[data-bag]").forEach(function (el) {
          var on = el.getAttribute("data-bag") === cor;
          if (on) el.querySelectorAll("image[data-href]").forEach(function (im) { im.setAttribute("href", im.getAttribute("data-href")); im.removeAttribute("data-href"); });
          el.hidden = !on;
        });
        stage.dispatchEvent(new CustomEvent("stonedren:bag", { bubbles: true, detail: { cor: cor } }));
      }
    });
  });

  /* ---------- dialogs ---------- */
  document.querySelectorAll("[data-open]").forEach(function (b) {
    b.addEventListener("click", function (e) {
      // link com data-open (ex.: política no rodapé): sem JS ou com Ctrl/Cmd abre a página própria
      if (b.tagName === "A" && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
      var d = document.getElementById(b.getAttribute("data-open"));
      if (d && d.showModal) { if (b.tagName === "A") e.preventDefault(); d.showModal(); }
    });
  });
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
    d.querySelectorAll("[data-close]").forEach(function (x) { x.addEventListener("click", function () { d.close(); }); });
  });

  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
