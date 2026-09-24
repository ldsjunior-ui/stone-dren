/* Stone Dren · hero: vídeo em loop infinito ATRÁS do piso 3D, misturado por luz (mix-blend-mode: screen).
 * O preto do vídeo some e só a luz dele (céu, chuva, feixes, reflexos) soma na cena.
 * 5 opções geradas no Grok Imagine com o modo Loop (o vídeo começa e termina na mesma imagem).
 *   ?fundo=1..5  escolhe a opção · ?fundo=0 desliga · ?opcoes mostra o seletor para comparar
 * Carrega depois do load (não pesa no primeiro paint), pausa fora da tela e com a aba oculta,
 * respeita movimento reduzido e economia de dados (só a imagem parada).
 */
(function () {
  "use strict";
  var OPCOES = {
    1: { slug: "nevoa", nome: "Névoa e feixes de luz" },
    2: { slug: "bokeh", nome: "Luzes da cidade na chuva" },
    3: { slug: "reflexos", nome: "Reflexos na água" },
    4: { slug: "chuva", nome: "Chuva na contraluz" },
    5: { slug: "tempestade", nome: "Tempestade dourada" }
  };
  var PADRAO = 4; // abre sem parâmetro na URL: chuva na contraluz (soma com a chuva do 3D e é a mais forte no celular)

  var video = document.getElementById("hero-loop");
  var hero = video && video.closest(".hero");
  if (!video || !hero) return;

  var doc = document.documentElement;
  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
  var pedido = params && params.has("fundo") ? parseInt(params.get("fundo"), 10) : PADRAO;
  var mostrarSeletor = !!(params && (params.has("opcoes") || params.has("fundo")));

  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var conn = navigator.connection || {};
  var economia = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "");
  var visivel = true, carregado = false, atual = 0;

  function reduzido() { return !!(mq && mq.matches); }
  function pequeno() { return (window.innerWidth || 1280) <= 700; }
  function minusculo() { return (window.innerWidth || 1280) < 340; }

  function aplicar(n) {
    atual = OPCOES[n] ? n : 0;
    video.classList.remove("is-on");
    try { video.pause(); } catch (e) {}
    if (!atual) {
      doc.removeAttribute("data-hero-loop");
      video.removeAttribute("src"); video.removeAttribute("poster");
      try { video.load(); } catch (e) {}
      marcarSeletor();
      return;
    }
    var o = OPCOES[atual];
    doc.setAttribute("data-hero-loop", o.slug);
    if (minusculo()) {
      // abaixo de 340 px o parágrafo já fica perto do limite de contraste sem vídeo: não carrega nada
      video.removeAttribute("src"); video.removeAttribute("poster");
      try { video.load(); } catch (e) {}
      marcarSeletor();
      return;
    }
    var base = "video/hero-" + o.slug;
    video.setAttribute("poster", base + "-poster.jpg");
    if (reduzido() || economia) {
      // sem movimento: a primeira imagem do loop, parada, com a mesma mistura
      video.removeAttribute("src");
      try { video.load(); } catch (e) {}
      video.classList.add("is-on");
    } else {
      video.src = base + (pequeno() ? "-480.mp4" : "-720.mp4");
      tocar();
    }
    marcarSeletor();
  }

  function tocar() {
    if (!atual || reduzido() || economia || !video.getAttribute("src")) return;
    if (!visivel || document.hidden) { try { video.pause(); } catch (e) {} return; }
    var p = video.play();
    if (p && p.catch) p.catch(function () { video.classList.add("is-on"); }); // autoplay bloqueado: fica o pôster
  }

  video.addEventListener("playing", function () { video.classList.add("is-on"); });

  // pausa fora da tela e com a aba oculta (economiza bateria e GPU)
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (ents) {
      visivel = ents[0].isIntersecting;
      if (visivel) tocar(); else { try { video.pause(); } catch (e) {} }
    }, { rootMargin: "80px" }).observe(hero);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { try { video.pause(); } catch (e) {} } else tocar();
  });
  if (mq) {
    var mudou = function () { if (carregado) aplicar(atual); };
    if (mq.addEventListener) mq.addEventListener("change", mudou); else if (mq.addListener) mq.addListener(mudou);
  }

  // seletor para comparar as 5 opções (só aparece com ?opcoes ou ?fundo na URL)
  var seletor = null;
  function marcarSeletor() {
    if (!seletor) return;
    var bs = seletor.querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute("aria-pressed", String(+bs[i].getAttribute("data-n") === atual));
    var leg = seletor.querySelector(".hl-nome");
    if (leg) leg.textContent = atual ? OPCOES[atual].nome : "Sem vídeo";
  }
  function montarSeletor() {
    seletor = document.createElement("div");
    seletor.className = "hero-loop-picker";
    seletor.setAttribute("role", "group");
    seletor.setAttribute("aria-label", "Fundo do topo: comparar as opções");
    var html = '<span class="hl-tit">Fundo</span>';
    for (var n = 0; n <= 5; n++) {
      var nome = n ? OPCOES[n].nome : "Sem vídeo";
      html += '<button type="button" data-n="' + n + '" title="' + nome + '" aria-label="' + (n ? "Opção " + n + ": " : "") + nome + '">' + (n || "0") + "</button>";
    }
    html += '<span class="hl-nome" aria-live="polite"></span>';
    seletor.innerHTML = html;
    seletor.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-n]");
      if (!b) return;
      var n = +b.getAttribute("data-n");
      aplicar(n);
      try {
        var u = new URL(location.href);
        u.searchParams.set("fundo", String(n));
        history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch (e) {}
    });
    document.body.appendChild(seletor);
  }

  function iniciar() {
    carregado = true;
    if (mostrarSeletor) montarSeletor();
    aplicar(pedido);
  }
  // depois do load e de um respiro: o vídeo nunca disputa banda com o primeiro paint
  function quandoOcioso() {
    if (window.requestIdleCallback) requestIdleCallback(iniciar, { timeout: 1500 });
    else setTimeout(iniciar, 600);
  }
  if (document.readyState === "complete") quandoOcioso();
  else window.addEventListener("load", quandoOcioso, { once: true });
})();
