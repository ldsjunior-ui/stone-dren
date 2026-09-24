/* Stone Dren · camada de efeitos e microinterações (par de effects.css).
 *
 * Cada bloco é opcional: se o gancho não existe na página, ele simplesmente não faz nada.
 * Regras que valem para todos os blocos:
 *  · prefers-reduced-motion: nada se move sozinho, fica o estado final estático;
 *  · efeitos de cursor (magnético, tilt, spotlight) só com mouse (hover + pointer fine);
 *  · loops de requestAnimationFrame param fora da tela e com a aba oculta;
 *  · no DOM só se anima transform e opacity; medidas são lidas em eventos ou no resize,
 *    nunca intercaladas com escritas dentro do mesmo quadro;
 *  · listeners de rolagem e ponteiro são passivos.
 * Idempotente: carregar de novo ou chamar StoneDrenFx.refresh() não duplica nada.
 */
(function () {
  "use strict";
  var win = window, doc = document, root = doc.documentElement;
  if (win.StoneDrenFx) { try { win.StoneDrenFx.refresh(); } catch (e) {} return; }

  /* ---------- utilidades ---------- */
  function mq(q) { return win.matchMedia ? win.matchMedia(q) : { matches: false }; }
  var reduceMQ = mq("(prefers-reduced-motion: reduce)");
  var fineMQ = mq("(hover: hover) and (pointer: fine)");
  var reduce = !!reduceMQ.matches;
  function fine() { return !!fineMQ.matches && !reduce; }
  function qsa(sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sy() { return win.pageYOffset || root.scrollTop || 0; }
  function sx() { return win.pageXOffset || root.scrollLeft || 0; }
  var raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var hasIO = "IntersectionObserver" in win;
  var EASE = "cubic-bezier(.16,1,.3,1)";
  function onMQChange(m, fn) {
    if (!m) return;
    if (m.addEventListener) m.addEventListener("change", fn);
    else if (m.addListener) m.addListener(fn);
  }

  // dispara uma vez quando o elemento entra na tela
  function once(el, cb, opts) {
    if (!hasIO) { cb(); return; }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); cb(); return; }
      }
    }, opts || { rootMargin: "0px 0px -10% 0px", threshold: 0.2 });
    io.observe(el);
  }
  // avisa sempre que o elemento entra ou sai da tela (para pausar loops)
  function watch(el, cb, margin) {
    if (!hasIO) { cb(true); return; }
    new IntersectionObserver(function (entries) {
      cb(entries[entries.length - 1].isIntersecting);
    }, { rootMargin: margin || "120px 0px" }).observe(el);
  }

  /* ---------- um único listener de rolagem e um de resize, com rAF ---------- */
  var scrollTasks = [], measureTasks = [], stopTasks = [], visTasks = [];
  var scrollQueued = false, resizeQueued = false;
  function flushScroll() {
    scrollQueued = false;
    var y = sy();
    for (var i = 0; i < scrollTasks.length; i++) scrollTasks[i](y);
  }
  function flushResize() {
    resizeQueued = false;
    for (var i = 0; i < measureTasks.length; i++) measureTasks[i](); // só leituras
    flushScroll();                                                    // depois as escritas
  }
  win.addEventListener("scroll", function () { if (!scrollQueued) { scrollQueued = true; raf(flushScroll); } }, { passive: true });
  win.addEventListener("resize", function () { if (!resizeQueued) { resizeQueued = true; raf(flushResize); } }, { passive: true });
  doc.addEventListener("visibilitychange", function () {
    for (var i = 0; i < visTasks.length; i++) visTasks[i](!doc.hidden);
  });
  // só a faixa corrida espera a fonte (para remedir a largura); nenhum texto fica escondido esperando isso
  var fontsReady = new Promise(function (res) {
    var done = false;
    function go() { if (!done) { done = true; res(); } }
    setTimeout(go, 900);
    try { if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(go, go); else go(); } catch (e) { go(); }
  });

  /* ---------- 1. barra de progresso de rolagem ----------
   * Indicador de posição ligado direto à rolagem (não anda sozinho), por isso
   * continua ativo também em reduced-motion. */
  function initProgress() {
    var bar = doc.querySelector(".scroll-progress > span");
    if (!bar || bar.__fx) return;
    bar.__fx = true;
    var max = 1;
    function measure() { max = Math.max(1, root.scrollHeight - win.innerHeight); }
    measure();
    measureTasks.push(measure);
    if ("ResizeObserver" in win) {
      // a página muda de altura (calculadora, FAQ aberto): remede sem forçar layout
      new ResizeObserver(function () { measure(); if (!scrollQueued) { scrollQueued = true; raf(flushScroll); } }).observe(doc.body);
    }
    var last = -1;
    scrollTasks.push(function (y) {
      var p = clamp(y / max, 0, 1);
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
    });
  }

  /* ---------- 2. header some ao descer e volta ao subir ---------- */
  function initHeader() {
    var header = doc.getElementById("siteHeader");
    if (!header || header.__fx || reduce) return;
    header.__fx = true;
    var nav = doc.getElementById("navLinks");
    var lastY = sy(), acc = 0, hidden = false;
    header.classList.add("fx-autohide");
    function set(h) {
      if (h === hidden) return;
      hidden = h;
      header.classList.toggle("fx-hide", h);
    }
    // foco de teclado dentro do header segura ele visível (clique de mouse num link não conta)
    function keyboardFocusInside() {
      try { return !!header.querySelector(":focus-visible"); }
      catch (e) { return header.contains(doc.activeElement); }
    }
    header.addEventListener("focusin", function () { if (keyboardFocusInside()) set(false); });
    stopTasks.push(function () { set(false); header.classList.remove("fx-autohide"); });
    scrollTasks.push(function (y) {
      if (reduce) return;
      var dy = y - lastY;
      lastY = y;
      if (y < 160) { acc = 0; set(false); return; }
      // nunca esconder com o menu mobile aberto ou com o foco dentro do header
      if ((nav && nav.classList.contains("is-open")) || keyboardFocusInside()) { acc = 0; set(false); return; }
      if ((dy > 0 && acc < 0) || (dy < 0 && acc > 0)) acc = 0; // mudou de direção
      acc += dy;
      if (acc > 28) set(true);
      else if (acc < -14) set(false);
    });
  }

  /* ---------- 3. parallax leve do conteúdo do hero ---------- */
  function initHeroParallax() {
    var hero = doc.querySelector(".hero");
    var inner = hero && hero.querySelector(".hero-inner");
    if (!inner || inner.__fxPar || reduce) return;
    inner.__fxPar = true;
    inner.classList.add("fx-parallax");
    var cue = hero.querySelector(".scroll-cue");
    var header = doc.getElementById("siteHeader");
    // top/h: hero · cTop/cH: conteúdo sem o deslocamento atual · shift: translate aplicado agora
    // room: folga entre a base do conteúdo e a base do hero. O hero tem overflow:hidden,
    // então o deslocamento nunca passa dessa folga: nenhum texto é cortado pela borda.
    var top = 0, h = 1, cTop = 0, cH = 1, vh = 1, headH = 0, k = 0.2, fade = true, shift = 0, lastO = 1, room = 0;
    var ROOM_SAFE = 14; // sombra do texto da faixa de números (0 1px 8px) mais uma margem
    function measure() {
      var y = sy(), r = hero.getBoundingClientRect(), c = inner.getBoundingClientRect();
      top = r.top + y; h = Math.max(1, r.height);
      cTop = c.top + y - shift; cH = Math.max(1, c.height);
      room = Math.max(0, (top + h) - (cTop + cH) - ROOM_SAFE);
      vh = win.innerHeight || root.clientHeight || 1;
      headH = header ? header.offsetHeight : 0;
      k = win.innerWidth < 720 ? 0.12 : 0.2;
      // hero mais alto que a tela (celular): o conteúdo só desloca, nunca esmaece
      fade = h <= vh * 1.02 && win.innerWidth >= 720;
    }
    // desloca como antes (d * k) no começo e freia suave até a folga: room · tanh(x / room)
    function capShift(x) {
      if (x <= 0 || room <= 0) return 0;
      var e = Math.exp(-2 * x / room);
      return room * (1 - e) / (1 + e);
    }
    measure();
    measureTasks.push(measure);
    if ("ResizeObserver" in win) {
      // a Montserrat chega e o bloco muda de altura: remede (o callback já roda depois do layout)
      new ResizeObserver(function () { measure(); if (!scrollQueued) { scrollQueued = true; raf(flushScroll); } }).observe(inner);
    }
    stopTasks.push(function () { shift = 0; inner.style.transform = ""; inner.style.opacity = ""; if (cue) cue.style.opacity = ""; });
    scrollTasks.push(function (y) {
      if (reduce) return;
      var d = y - top;
      if (d > h * 1.05) return; // hero fora da tela: para de escrever
      shift = capShift(d > 0 ? d * k : 0);
      inner.style.transform = "translate3d(0," + shift.toFixed(1) + "px,0)";
      // Esmaece só quando o conteúdo já está saindo: a base do bloco entrou no
      // terço de cima da tela. Enquanto a pessoa lê no meio da tela, opacidade 1.
      var o = 1;
      if (fade) {
        var bottom = cTop + cH + shift - y;
        o = clamp((bottom - headH) / (vh * 0.3), 0, 1);
      }
      if (Math.abs(o - lastO) > 0.002) { lastO = o; inner.style.opacity = o >= 0.998 ? "" : o.toFixed(3); }
      if (cue) cue.style.opacity = clamp(1 - Math.max(0, d) / h * 5, 0, 1).toFixed(3);
    });
  }

  /* ---------- 4. títulos palavra por palavra ----------
   * Quebra em palavras (nunca letras soltas). O título ganha aria-label com o
   * texto inteiro e cada palavra visual fica aria-hidden, então o leitor de tela
   * lê a frase normal. <em> e demais tags internas são preservadas.
   * O build já entrega os [data-split] divididos (fx_build.py, mesma marcação e
   * mesmas regras); aqui só se divide o que chegar sem isso (ex.: HTML injetado).
   * Separa só em espaço ASCII, tab e quebra de linha: o U+00A0 (&nbsp;) nunca
   * separa. No meio da palavra ele fica dentro dela ("a&nbsp;chuva" é uma palavra).
   * Na ponta de um trecho (ex.: "de&nbsp;<em>piso</em>") ele e a palavra ficam num
   * span.fx-nb (nowrap). Palavra em inline-block só não quebra depois dela quando o
   * PAI é nowrap (medido no Chrome), então a palavra colada na seguinte sem espaço
   * ASCII no meio (outro trecho, outra tag) também ganha um span.fx-nb. Resultado:
   * a divisão nunca cria ponto de quebra que o texto original não tem. */
  var SPLIT_WS = /([ \t\n\r\f]+)/, ONLY_WS = /^[ \t\n\r\f]+$/, EDGE_NBSP = /^(\u00A0*)([\s\S]*?)(\u00A0*)$/;
  function splitHeading(el) {
    // já dividido (pelo build ou antes): conta as palavras para a animação rodar
    if (el.classList.contains("fx-split")) return el.querySelectorAll(".fx-wi").length;
    var label = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!label) return 0;
    var idx = 0;
    var last = null; // última caixa emitida sem espaço ASCII depois dela: { node, nb }
    function word(s) {
      var m = doc.createElement("span");
      m.className = "fx-w";
      m.setAttribute("aria-hidden", "true");
      var w = doc.createElement("span");
      w.className = "fx-wi";
      w.style.setProperty("--i", String(idx++));
      w.textContent = s;
      m.appendChild(w);
      return m;
    }
    function nbWrap(node) {
      var nb = doc.createElement("span");
      nb.className = "fx-nb";
      node.parentNode.insertBefore(nb, node);
      nb.appendChild(node);
    }
    function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      for (var k = 0; k < kids.length; k++) {
        var n = kids[k];
        if (n.nodeType === 3) {
          var parts = n.nodeValue.split(SPLIT_WS);
          var frag = doc.createDocumentFragment();
          for (var p = 0; p < parts.length; p++) {
            var s = parts[p];
            if (!s) continue;
            if (ONLY_WS.test(s)) { frag.appendChild(doc.createTextNode(" ")); last = null; continue; }
            // grudado na caixa anterior (sem espaço ASCII no meio): o pai dela vira nowrap
            if (last && !last.nb) nbWrap(last.node);
            var e = EDGE_NBSP.exec(s);
            if (e[1] || e[3]) {
              var nb = doc.createElement("span");
              nb.className = "fx-nb";
              if (e[1]) nb.appendChild(doc.createTextNode(e[1]));
              if (e[2]) nb.appendChild(word(e[2]));
              if (e[3]) nb.appendChild(doc.createTextNode(e[3]));
              frag.appendChild(nb);
              last = { node: nb, nb: true };
            } else {
              var box = word(e[2]);
              frag.appendChild(box);
              last = { node: box, nb: false };
            }
          }
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName === "BR") {
          last = null;
        } else if (n.nodeType === 1 && !(n.classList && n.classList.contains("fx-w"))) {
          walk(n);
        }
      }
    }
    walk(el);
    el.setAttribute("aria-label", label);
    el.classList.add("fx-split");
    return idx;
  }
  // A entrada é uma animação CSS (keyframes): começa no próximo cálculo de estilo,
  // sem esperar rAF nem timer, e roda no compositor.
  var WORD_STAGGER = 45, WORD_MS = 850;
  function playSplit(el, n, delayMs) {
    var d = delayMs || 0, done = false;
    el.style.setProperty("--fx-d", d + "ms");
    el.classList.add("fx-in");
    // depois da entrada, tira a máscara (acentos e sombra nunca ficam cortados)
    function fin() { if (done) return; done = true; el.classList.add("fx-done"); }
    var ws = el.querySelectorAll(".fx-wi"), last = ws[ws.length - 1];
    if (last) last.addEventListener("animationend", fin, { once: true });
    setTimeout(fin, d + n * WORD_STAGGER + WORD_MS + 250);
  }
  function initSplit(scope) {
    if (reduce) return;
    var list = [];
    qsa("[data-split]", scope).forEach(function (el) {
      if (el.__fxSplit) return;
      el.__fxSplit = true;
      var inHero = !!(el.closest && el.closest(".hero"));
      if (inHero) return; // o h1 do hero entra junto com a coreografia do hero
      var n = splitHeading(el);
      if (n) list.push({ el: el, n: n });
    });
    if (!list.length) return;
    // leituras em lote, depois as escritas. O título que já está na tela (pintado)
    // fica como está: esconder para animar faria ele piscar.
    var vh = win.innerHeight || root.clientHeight || 0;
    list.forEach(function (it) {
      var r = it.el.getBoundingClientRect();
      it.shown = r.width > 0 && r.bottom > 0 && r.top < vh;
    });
    list.forEach(function (it) {
      if (it.shown) return;
      var el = it.el;
      el.classList.add("fx-armed"); // só agora as palavras ficam escondidas (effects.css)
      stopTasks.push(function () { el.classList.add("fx-in", "fx-done"); });
      once(el, function () { playSplit(el, it.n, 80); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.4 });
    });
  }

  /* ---------- 5. entrada do hero no load ----------
   * A coreografia é só CSS (effects.css) e começa no primeiro paint, sem esperar
   * este script: em rede lenta o effects.js chega segundos depois e o hero não
   * pode depender dele. O h1 já vem dividido do build (fx_build.py), entra como
   * um bloco só e nunca nasce transparente: sobe de uma opacidade parcial, então
   * conta como LCP já no primeiro paint. A lede nunca fica transparente, só sobe
   * alguns pixels. Aqui só se lê quanto falta nas próprias animações e, ao terminar, se
   * avisa com 'stonedren:intro-done' (e html.fx-intro-done) para quem tiver
   * trabalho pesado no load poder esperar. */
  var introSignaled = false, INTRO_MS = 1100;
  var HERO_ANIMS = { "fx-rise": 1, "fx-rise-solid": 1, "fx-draw": 1, "fx-title": 1 };
  function signalIntroDone() {
    if (introSignaled) return;
    introSignaled = true;
    root.classList.add("fx-intro-done");
    try { win.dispatchEvent(new Event("stonedren:intro-done")); } catch (e) {}
  }
  // animações de entrada do hero ainda rodando e quanto falta (ms de relógio); null se não der para ler
  function heroAnims(hero) {
    if (!hero.getAnimations) return null;
    try {
      var list = hero.getAnimations({ subtree: true }), run = [], rest = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!HERO_ANIMS[a.animationName] || a.playState === "finished" || a.playState === "idle") continue;
        var t = a.effect.getComputedTiming();
        var left = ((t.endTime || 0) - (t.localTime || 0)) / Math.abs(a.playbackRate || 1);
        if (left > rest) rest = left;
        run.push(a);
      }
      return { list: run, rest: rest };
    } catch (e) { return null; }
  }
  // algo já foi pintado? (então o título já foi visto e não deve mudar de estrutura)
  function painted() {
    try { return !!(win.performance && performance.getEntriesByType && performance.getEntriesByType("paint").length); }
    catch (e) { return true; }
  }
  function initHeroIntro() {
    var hero = doc.querySelector(".hero");
    if (!hero) { signalIntroDone(); return; }
    if (hero.__fxIntro) return;
    hero.__fxIntro = true;
    var h1 = hero.querySelector("h1[data-split]");
    if (h1) h1.__fxSplit = true;
    function fin() {
      hero.classList.add("fx-hero-done"); // tira as animações de entrada, já terminadas
      if (h1) h1.classList.add("fx-done");
      signalIntroDone();
    }
    if (reduce) { fin(); return; }
    // sem o build (HTML sem fx-split): divide aqui só se nada foi pintado ainda;
    // se o título já apareceu, fica como está, sem trocar os nós na frente de quem lê
    if (h1 && !h1.classList.contains("fx-split") && !painted()) splitHeading(h1);
    stopTasks.push(fin);
    var st = heroAnims(hero);
    if (!st || !win.Promise) { setTimeout(fin, INTRO_MS); return; }
    if (!st.list.length) { fin(); return; }
    // limpeza quando as próprias animações terminam (segue qualquer velocidade de reprodução);
    // o aviso sai também pelo relógio, porque quem espera por ele não pode depender de quadros
    Promise.all(st.list.map(function (a) { return a.finished.then(null, function () {}); })).then(fin);
    setTimeout(signalIntroDone, Math.min(st.rest, 4000) + 40);
  }

  /* ---------- 6. contador ----------
   * Só números a partir de 10 (contar até 5 não informa nada) e só os que ainda
   * estão abaixo da tela no load: o que já aparece fica com o valor final, sem
   * piscar. Enquanto conta, o número animado fica aria-hidden e o leitor de tela
   * lê o valor final num texto oculto ao lado. */
  var COUNT_MIN = 10;
  function initCount(scope) {
    var items = [];
    qsa("[data-count]", scope).forEach(function (el) {
      if (el.__fxCount) return;
      el.__fxCount = true;
      var raw = String(el.getAttribute("data-count") || "").replace(",", ".");
      var to = parseFloat(raw);
      if (!isFinite(to)) return;
      if (reduce || Math.abs(to) < COUNT_MIN) return; // fica como está no HTML
      items.push({ el: el, raw: raw, to: to });
    });
    if (!items.length) return;
    var vh = win.innerHeight || root.clientHeight || 0;
    // leituras em lote, depois as escritas
    items.forEach(function (it) { it.below = it.el.getBoundingClientRect().top > vh; });
    items.forEach(function (it) {
      var el = it.el, to = it.to;
      el.classList.add("fx-count");
      if (!it.below) return;
      var finalText = el.textContent;
      var dec = (it.raw.split(".")[1] || "").length;
      var pow = Math.pow(10, dec);
      function fmt(v) {
        try { return v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
        catch (e) { return v.toFixed(dec); }
      }
      var sr = doc.createElement("span");
      sr.className = "fx-sr";
      sr.textContent = finalText;
      el.parentNode.insertBefore(sr, el.nextSibling);
      el.setAttribute("aria-hidden", "true");
      el.textContent = fmt(0); // ainda fora da tela: ninguém vê a troca
      var finished = false;
      function end() { finished = true; el.textContent = finalText; }
      stopTasks.push(end);
      once(el, function () {
        setTimeout(function () {
          var t0 = 0, dur = 1100 + Math.min(900, Math.abs(to) * 3), shown = null;
          function frame(ts) {
            if (finished) return;
            if (!t0) t0 = ts;
            var t = clamp((ts - t0) / dur, 0, 1);
            var e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo
            var v = Math.round(to * e * pow) / pow;
            if (v !== shown) { shown = v; el.textContent = fmt(v); }
            if (t < 1) raf(frame); else end();
          }
          raf(frame);
        }, 150);
      }, { threshold: 0.6 });
    });
  }

  /* ---------- 7. botões magnéticos ---------- */
  function initMagnetic(scope) {
    if (!fine()) return;
    qsa("[data-magnetic]", scope).forEach(function (el) {
      if (el.__fxMag) return;
      el.__fxMag = true;
      el.classList.add("fx-mag");
      var active = false, looping = false, box = null;
      var cx = 0, cy = 0, tx = 0, ty = 0;
      function loop() {
        cx += (tx - cx) * 0.2; cy += (ty - cy) * 0.2;
        // chegou no alvo: escreve a posição final e para (o próximo pointermove religa)
        var settled = Math.abs(tx - cx) < 0.05 && Math.abs(ty - cy) < 0.05;
        if (settled) { cx = tx; cy = ty; }
        if (settled && !active) { cx = cy = 0; looping = false; el.style.transform = ""; return; }
        el.style.transform = "translate3d(" + cx.toFixed(2) + "px," + cy.toFixed(2) + "px,0)";
        if (settled) { looping = false; return; }
        raf(loop);
      }
      function kick() { if (!looping) { looping = true; raf(loop); } }
      function measure() {
        var r = el.getBoundingClientRect();
        // desconta o deslocamento atual para achar o centro "de repouso"
        box = { x: r.left + r.width / 2 - cx + sx(), y: r.top + r.height / 2 - cy + sy(), w: r.width, h: r.height };
      }
      el.addEventListener("pointerenter", function (e) {
        if (e.pointerType !== "mouse" || reduce) return;
        measure(); active = true;
      });
      el.addEventListener("pointermove", function (e) {
        if (!active || !box) return;
        var dx = e.clientX + sx() - box.x, dy = e.clientY + sy() - box.y;
        tx = clamp(dx * 0.3, -10, 10);
        ty = clamp(dy * 0.4, -7, 7) - 2; // -2px mantém o "levanta" do hover original
        kick();
      }, { passive: true });
      el.addEventListener("pointerleave", function () { active = false; tx = ty = 0; kick(); });
    });
  }

  /* ---------- 8. tilt 3D com brilho ---------- */
  function initTilt(scope) {
    if (!fine()) return;
    qsa("[data-tilt]", scope).forEach(function (el) {
      if (el.__fxTilt) return;
      el.__fxTilt = true;
      var strong = el.hasAttribute("data-tilt-strong");
      var MAX = strong ? 10 : 5, LIFT = strong ? 0 : -4;
      el.classList.add("fx-tilt");
      if (strong) el.classList.add("fx-tilt-strong");
      var glows = [];
      if (!strong) {
        // o saco não é um card (fundo transparente), então só os cards ganham brilho e borda acesa
        var g = doc.createElement("span");
        g.className = "fx-glare";
        g.setAttribute("aria-hidden", "true");
        g.innerHTML = '<i class="fx-glow"></i><i class="fx-rim"><i class="fx-glow"></i></i>';
        el.appendChild(g);
        glows = qsa(".fx-glow", g);
      }
      var on = false, looping = false, box = null;
      var cur = { x: 0, y: 0, h: 0 }, tgt = { x: 0, y: 0, h: 0 }, gx = 0, gy = 0;
      function measure() {
        var r = el.getBoundingClientRect();
        box = { l: r.left + sx(), t: r.top + sy(), w: Math.max(1, r.width), h: Math.max(1, r.height) };
      }
      function loop() {
        var k = 0.14;
        cur.x += (tgt.x - cur.x) * k;
        cur.y += (tgt.y - cur.y) * k;
        cur.h += (tgt.h - cur.h) * k;
        var settled = Math.abs(tgt.x - cur.x) < 0.01 && Math.abs(tgt.y - cur.y) < 0.01 && Math.abs(tgt.h - cur.h) < 0.004;
        if (settled) { cur.x = tgt.x; cur.y = tgt.y; cur.h = tgt.h; }
        if (settled && !on) {
          looping = false;
          el.style.transform = "";
          el.classList.remove("fx-tilt-live");
          return;
        }
        el.style.transform = "perspective(1000px) rotateX(" + cur.x.toFixed(3) + "deg) rotateY(" + cur.y.toFixed(3) + "deg) translate3d(0," + (LIFT * cur.h).toFixed(2) + "px,0)";
        for (var i = 0; i < glows.length; i++) glows[i].style.transform = "translate3d(" + gx.toFixed(1) + "px," + gy.toFixed(1) + "px,0)";
        // cursor parado em cima do card: para de escrever até o próximo pointermove
        if (settled) { looping = false; return; }
        raf(loop);
      }
      function kick() {
        if (!looping) { looping = true; el.classList.add("fx-tilt-live"); raf(loop); }
      }
      var rev = el.closest ? el.closest("[data-reveal]") : null;
      function eligible() {
        if (!rev) return true;
        if (!rev.classList.contains("is-visible")) return false;
        // espera a transição de entrada do reveal terminar: o tilt tira a transição
        // de transform do card e, no meio dela, o card pularia até a posição final
        if (rev.getAnimations) {
          try {
            var list = rev.getAnimations();
            for (var i = 0; i < list.length; i++) {
              var p = list[i].transitionProperty;
              if (list[i].playState === "running" && (p === "transform" || p === "opacity" || p === "translate")) return false;
            }
          } catch (e) {}
        }
        return true;
      }
      function start(e) {
        if (e.pointerType !== "mouse" || reduce || !eligible()) return false;
        measure();
        // card alto inclina menos: o texto continua nítido durante o tilt
        if (!strong) MAX = box.h > 320 ? 3.5 : 5;
        on = true; el.classList.add("fx-tilt-on"); return true;
      }
      el.addEventListener("pointerenter", function (e) { start(e); });
      el.addEventListener("pointermove", function (e) {
        if (!on && !start(e)) return;
        var lx = e.clientX + sx() - box.l, ly = e.clientY + sy() - box.t;
        var nx = clamp(lx / box.w, 0, 1) - 0.5, ny = clamp(ly / box.h, 0, 1) - 0.5;
        tgt.y = nx * 2 * MAX;
        tgt.x = -ny * 2 * MAX;
        tgt.h = 1;
        gx = lx; gy = ly;
        kick();
      }, { passive: true });
      el.addEventListener("pointerleave", function () {
        on = false; tgt.x = tgt.y = tgt.h = 0;
        el.classList.remove("fx-tilt-on");
        kick();
      });
    });
  }

  /* ---------- 9. spotlight que segue o cursor ---------- */
  function initSpotlight(scope) {
    if (!fine()) return;
    qsa("[data-spotlight]", scope).forEach(function (sec) {
      if (sec.__fxSpot) return;
      sec.__fxSpot = true;
      var spot = doc.createElement("span");
      spot.className = "fx-spot";
      spot.setAttribute("aria-hidden", "true");
      sec.insertBefore(spot, sec.firstChild);
      sec.classList.add("fx-lift");
      var on = false, looping = false, box = null, fresh = true;
      var cx = 0, cy = 0, tx = 0, ty = 0, px = 0, py = 0;
      function measure() { var r = sec.getBoundingClientRect(); box = { l: r.left + sx(), t: r.top + sy() }; }
      function aim() { tx = px + sx() - box.l; ty = py + sy() - box.t; }
      function loop() {
        cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
        spot.style.transform = "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0)";
        if (Math.abs(tx - cx) < 0.4 && Math.abs(ty - cy) < 0.4) { looping = false; return; }
        raf(loop);
      }
      function kick() { if (!looping) { looping = true; raf(loop); } }
      function start(e) {
        if (e.pointerType !== "mouse" || reduce) return false;
        measure(); px = e.clientX; py = e.clientY; aim();
        if (fresh) { cx = tx; cy = ty; fresh = false; } // nasce onde o cursor entrou, sem varrer a seção
        on = true; spot.classList.add("is-on"); kick();
        return true;
      }
      sec.addEventListener("pointerenter", start);
      sec.addEventListener("pointermove", function (e) {
        if (!on && !start(e)) return;
        px = e.clientX; py = e.clientY; aim(); kick();
      }, { passive: true });
      sec.addEventListener("pointerleave", function () { on = false; fresh = true; spot.classList.remove("is-on"); });
      scrollTasks.push(function () { if (on && box) { aim(); kick(); } });
    });
  }

  /* ---------- 10. faixa corrida infinita ---------- */
  function initMarquee(scope) {
    qsa(".marquee", scope).forEach(function (mqEl) {
      var track = mqEl.querySelector(".marquee-track");
      if (!track || track.__fx) return;
      track.__fx = true;
      if (reduce || !track.animate) return; // estática: o CSS mostra a primeira parte da faixa
      var originals = Array.prototype.slice.call(track.children);
      if (!originals.length) return;
      var SPEED = 44; // px por segundo
      var anim = null, halfW = 0, hovered = false, inView = true, visibleDoc = !doc.hidden;
      var rate = 1, boost = 0, rateLoop = false, lastY = sy(), lastT = 0;
      function build() {
        while (track.children.length > originals.length) track.removeChild(track.lastChild);
        var setW = track.getBoundingClientRect().width;
        if (!setW) return;
        var need = Math.max(mqEl.clientWidth, 360) * 1.2;
        var copies = Math.max(1, Math.ceil(need / setW));
        var frag = doc.createDocumentFragment(), c, i;
        for (c = 1; c < copies; c++) for (i = 0; i < originals.length; i++) frag.appendChild(originals[i].cloneNode(true));
        track.appendChild(frag);
        // segunda metade idêntica: a animação vai de 0 a -50% e emenda sem costura
        var half = Array.prototype.slice.call(track.children);
        var frag2 = doc.createDocumentFragment();
        for (i = 0; i < half.length; i++) frag2.appendChild(half[i].cloneNode(true));
        track.appendChild(frag2);
        halfW = setW * copies;
        var dur = Math.max(14, halfW / SPEED) * 1000;
        var phase = 0;
        if (anim) {
          try { phase = ((anim.currentTime || 0) % anim.effect.getTiming().duration) / anim.effect.getTiming().duration; } catch (e) { phase = 0; }
          anim.cancel();
        }
        anim = track.animate(
          [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(-50%,0,0)" }],
          { duration: dur, iterations: Infinity }
        );
        anim.currentTime = phase * dur;
        apply();
      }
      function apply() {
        if (!anim) return;
        var run = inView && !hovered && visibleDoc && !reduce;
        if (run && anim.playState !== "running") anim.play();
        else if (!run && anim.playState === "running") anim.pause();
      }
      build();
      fontsReady.then(function () { raf(build); }); // remede com a Montserrat carregada
      var rt = 0;
      measureTasks.push(function () {
        clearTimeout(rt);
        rt = setTimeout(function () { if (mqEl.clientWidth * 1.05 > halfW) build(); }, 180);
      });
      mqEl.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") { hovered = true; apply(); } });
      mqEl.addEventListener("pointerleave", function () { hovered = false; apply(); });
      watch(mqEl, function (v) { inView = v; apply(); }, "60px 0px");
      visTasks.push(function (v) { visibleDoc = v; apply(); });
      stopTasks.push(function () { if (anim) { anim.cancel(); anim = null; } });
      // rolagem rápida acelera a faixa um pouco e ela volta ao ritmo sozinha
      function rateFrame() {
        if (!anim) { rateLoop = false; return; }
        boost *= 0.93;
        var target = 1 + boost;
        rate += (target - rate) * 0.2;
        if (Math.abs(rate - 1) < 0.01 && boost < 0.01) { rate = 1; boost = 0; anim.playbackRate = 1; rateLoop = false; return; }
        anim.playbackRate = rate;
        raf(rateFrame);
      }
      scrollTasks.push(function (y) {
        var now = win.performance ? performance.now() : Date.now();
        var dt = lastT ? Math.max(8, now - lastT) : 16;
        var v = Math.abs(y - lastY) / dt * 1000; // px/s
        lastY = y; lastT = now;
        if (!anim || !inView || hovered || reduce) return;
        boost = Math.max(boost, Math.min(2.2, v / 900));
        if (!rateLoop && boost > 0.05) { rateLoop = true; raf(rateFrame); }
      });
    });
  }

  /* ---------- 11. divisores de seção com brilho ---------- */
  function initSeams() {
    qsa(".loja, .rede, .franquia, .faq, .cta-band").forEach(function (sec) {
      if (sec.__fxSeam) return;
      sec.__fxSeam = true;
      var s = doc.createElement("span");
      s.className = "fx-seam";
      s.setAttribute("aria-hidden", "true");
      sec.appendChild(s);
      if (reduce) { s.classList.add("is-in"); return; }
      once(sec, function () { s.classList.add("is-in"); }, { rootMargin: "0px 0px -12% 0px", threshold: 0 });
    });
  }

  /* ---------- 12. fluxo de 5 passos: linha se desenha, números acendem em sequência ---------- */
  function initFlow() {
    qsa("ol.flow[data-flow]").forEach(function (ol) {
      if (ol.__fxFlow || reduce) return;
      ol.__fxFlow = true;
      var lis = Array.prototype.slice.call(ol.children).filter(function (n) { return n.tagName === "LI"; });
      lis.forEach(function (li, i) {
        li.style.setProperty("--fx-i", String(i));
        var g = doc.createElement("span");
        g.className = "fx-step-glow";
        g.setAttribute("aria-hidden", "true");
        li.appendChild(g);
      });
      ol.classList.add("fx-flow");
      once(ol, function () { raf(function () { ol.classList.add("is-drawn"); }); }, { rootMargin: "0px 0px -12% 0px", threshold: 0.35 });
      stopTasks.push(function () { ol.classList.add("is-drawn"); });
    });
  }

  /* ---------- 13. poeira dourada no CTA ---------- */
  function initDust() {
    qsa("canvas.dust").forEach(function (cv) {
      if (cv.__fx || !cv.getContext) return;
      cv.__fx = true;
      var ctx = cv.getContext("2d");
      if (!ctx) return;
      var host = cv.parentElement;
      if (host) host.classList.add("fx-lift"); // conteúdo por cima da poeira
      var W = 0, H = 0, dpr = 1, parts = [], running = false, inView = false, visibleDoc = !doc.hidden, last = 0, clock = 0;
      var sprite = (function () {
        var s = doc.createElement("canvas");
        s.width = s.height = 64;
        var g = s.getContext("2d");
        var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, "rgba(255,244,214,1)");
        gr.addColorStop(0.16, "rgba(244,223,168,.9)");
        gr.addColorStop(0.42, "rgba(217,174,94,.28)");
        gr.addColorStop(1, "rgba(198,138,46,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        return s;
      })();
      function make(anyY) {
        var bokeh = Math.random() < 0.28; // algumas partículas grandes e desfocadas dão profundidade
        return {
          x: Math.random() * W,
          y: anyY ? Math.random() * H : H + 20,
          r: bokeh ? 10 + Math.random() * 14 : 2.6 + Math.random() * 4.4,
          a: bokeh ? 0.07 + Math.random() * 0.1 : 0.45 + Math.random() * 0.45,
          vy: bokeh ? 4 + Math.random() * 6 : 7 + Math.random() * 13,
          sway: 5 + Math.random() * 16,
          ph: Math.random() * 6.283,
          sp: 0.15 + Math.random() * 0.35,
          tw: Math.random() * 6.283
        };
      }
      function resize() {
        var r = cv.getBoundingClientRect();
        W = Math.max(1, r.width); H = Math.max(1, r.height);
        dpr = Math.min(win.devicePixelRatio || 1, 1.5);
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.round(clamp(W * H / 24000, 14, 46));
        if (parts.length > n) parts.length = n;
        while (parts.length < n) parts.push(make(true));
        for (var i = 0; i < parts.length; i++) if (parts[i].x > W) parts[i].x = Math.random() * W;
        draw();
      }
      function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        var fade = H * 0.18;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          var edge = clamp(Math.min(p.y / fade, (H - p.y) / fade), 0, 1);
          var tw = 0.6 + 0.4 * Math.sin(p.tw + clock * p.sp * 2.4);
          var alpha = p.a * tw * edge;
          if (alpha <= 0.003) continue;
          ctx.globalAlpha = alpha;
          var x = p.x + Math.sin(p.ph + clock * p.sp) * p.sway;
          ctx.drawImage(sprite, x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      function step(dt) {
        clock += dt;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          p.y -= p.vy * dt;
          if (p.y < -30) { parts[i] = make(false); parts[i].x = Math.random() * W; }
        }
      }
      function frame(ts) {
        if (!running) return;
        var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
        last = ts;
        step(dt); draw();
        raf(frame);
      }
      function update() {
        var should = inView && visibleDoc && !reduce;
        if (should && !running) { running = true; last = 0; raf(frame); }
        else if (!should) running = false;
      }
      resize();
      if ("ResizeObserver" in win) new ResizeObserver(function () { resize(); }).observe(cv);
      else measureTasks.push(resize);
      if (reduce) return; // um quadro estático, sem movimento
      watch(cv, function (v) { inView = v; update(); }, "80px 0px");
      visTasks.push(function (v) { visibleDoc = v; update(); });
      stopTasks.push(function () { running = false; draw(); });
    });
  }

  /* ---------- 14. troca de cor do saco (loja modelo) ----------
   * O app.js já troca qual saco está visível e dispara 'stonedren:bag'.
   * Aqui o saco antigo gira para fora e o novo entra do outro lado, em 3D,
   * em sequência: o antigo some por completo antes de o novo aparecer, então
   * os dois rótulos nunca ficam sobrepostos. */
  var BAG_OUT_FADE = 170, BAG_OUT_MS = 240, BAG_IN_MS = 640, BAG_IN_FADE = 280;
  function initBag() {
    var stage = doc.getElementById("bagStage");
    if (!stage || stage.__fxBag) return;
    stage.__fxBag = true;
    stage.classList.add("fx-bag");
    var order = qsa(".sw[data-cor]").map(function (b) { return b.getAttribute("data-cor"); });
    function visibleCor() {
      var v = null;
      qsa("[data-bag]", stage).forEach(function (el) { if (!el.hidden) v = el.getAttribute("data-bag"); });
      return v;
    }
    var current = visibleCor();
    var running = [];
    function settle() {
      // estado final sempre coerente com o app.js: só o saco da cor atual visível
      qsa("[data-bag]", stage).forEach(function (el) {
        el.classList.remove("fx-bag-out");
        el.hidden = el.getAttribute("data-bag") !== current;
      });
    }
    stage.addEventListener("stonedren:bag", function (e) {
      var cor = e && e.detail && e.detail.cor;
      if (!cor) return;
      var prev = current;
      current = cor;
      if (!prev || prev === cor || reduce || !stage.animate) return;
      var inEl = stage.querySelector('[data-bag="' + cor + '"]');
      var outEl = stage.querySelector('[data-bag="' + prev + '"]');
      // clique rápido: o saco que sai parte da opacidade em que estava (sem piscar)
      var fromO = 1;
      if (outEl && running.length) { try { fromO = parseFloat(getComputedStyle(outEl).opacity) || 0; } catch (x) { fromO = 1; } }
      running.forEach(function (a) { try { a.cancel(); } catch (x) {} });
      running = [];
      settle();
      if (!inEl) return;
      var dir = order.indexOf(cor) >= order.indexOf(prev) ? 1 : -1;
      var BASE = "perspective(1100px) translate3d(0,0,0) rotateY(0deg) scale(1)";
      function side(s) { return "perspective(1100px) translate3d(" + (s * 9) + "%,0,-40px) rotateY(" + (s * 36) + "deg) scale(.94)"; }
      var gap = 0;
      if (outEl && outEl !== inEl && fromO > 0.01) {
        outEl.hidden = false;
        outEl.classList.add("fx-bag-out");
        // transform e opacidade separados: o saco já está invisível aos 170 ms, enquanto ainda gira
        var a1 = outEl.animate([{ transform: BASE }, { transform: side(-dir) }], { duration: BAG_OUT_MS, easing: "cubic-bezier(.5,0,.9,.45)", fill: "forwards" });
        var a1o = outEl.animate([{ opacity: fromO }, { opacity: 0 }], { duration: BAG_OUT_FADE, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
        running.push(a1, a1o);
        a1.onfinish = function () {
          if (current !== prev) { outEl.classList.remove("fx-bag-out"); outEl.hidden = true; }
          try { a1.cancel(); a1o.cancel(); } catch (x) {}
        };
        gap = BAG_OUT_FADE;
      }
      // o novo só começa quando o antigo já está com opacidade 0
      var a2 = inEl.animate([{ transform: side(dir) }, { transform: BASE }], { duration: BAG_IN_MS, delay: gap, easing: EASE, fill: "backwards" });
      var a2o = inEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BAG_IN_FADE, delay: gap, easing: "cubic-bezier(.2,.6,.3,1)", fill: "backwards" });
      running.push(a2, a2o);
      a2.onfinish = function () { running = []; settle(); };
    });
  }

  /* ---------- 15. FAQ com altura suave ----------
   * Navegadores novos: CSS nativo (::details-content + interpolate-size), zero JS.
   * Os demais: Web Animations na altura do <details>, mantendo o comportamento
   * nativo (Enter/Espaço no summary, atributo open, busca na página). */
  function initFaq() {
    var list = doc.querySelector(".faq-list");
    if (!list || list.__fx) return;
    list.__fx = true;
    var css = false;
    try { css = !!(win.CSS && CSS.supports && CSS.supports("interpolate-size", "allow-keywords") && CSS.supports("selector(::details-content)")); } catch (e) { css = false; }
    if (css) { list.classList.add("fx-faq-css"); return; }
    if (reduce || !list.animate) return;
    list.classList.add("fx-faq-js");
    qsa("details", list).forEach(function (d) {
      var sum = d.querySelector("summary");
      if (!sum) return;
      var anim = null, closing = false;
      function finish(open) {
        d.open = open;
        d.classList.remove("fx-closing");
        d.style.height = ""; d.style.overflow = "";
        anim = null; closing = false;
      }
      function run(from, to, open) {
        if (anim) anim.cancel();
        d.style.overflow = "hidden";
        anim = d.animate({ height: [from + "px", to + "px"] }, { duration: 460, easing: EASE });
        anim.onfinish = function () { finish(open); };
      }
      sum.addEventListener("click", function (e) {
        if (reduce) return;
        e.preventDefault();
        var start = d.offsetHeight;
        if (!d.open || closing) {
          closing = false;
          d.classList.add("fx-closing");
          d.open = true;
          var end = d.offsetHeight;
          run(start, end, true);
          raf(function () { d.classList.remove("fx-closing"); });
        } else {
          closing = true;
          d.classList.add("fx-closing");
          var shut = sum.offsetHeight + (d.offsetHeight - d.clientHeight);
          run(start, shut, false);
        }
      });
    });
  }

  /* ---------- reduced-motion ligado com a página aberta: congela tudo ---------- */
  onMQChange(reduceMQ, function (e) {
    if (!e.matches || reduce) return;
    reduce = true;
    stopTasks.forEach(function (f) { try { f(); } catch (x) {} });
  });
  // mouse conectado depois (tablet com trackpad): liga os efeitos de cursor
  onMQChange(fineMQ, function () { if (fine()) { initMagnetic(); initTilt(); initSpotlight(); } });

  function refresh(scope) {
    initProgress();
    initHeader();
    initHeroIntro();
    initHeroParallax();
    initSplit(scope);
    initCount(scope);
    initMagnetic(scope);
    initTilt(scope);
    initSpotlight(scope);
    initMarquee(scope);
    initSeams();
    initFlow();
    initDust();
    initBag();
    initFaq();
    flushScroll();
  }

  win.StoneDrenFx = { refresh: refresh, introDone: function () { return introSignaled; } };
  refresh();
})();
