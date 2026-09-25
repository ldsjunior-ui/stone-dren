/* Stone Dren · interface da calculadora V2 (script clássico).
 *
 * Depende de calc.js (window.StoneDrenCalc, o motor) e de app.js
 * (window.StoneDren: site, waLink, reduceMotion). Monta os cartões de
 * ambiente, o painel ao vivo (indicadores, rosca, barras, corte em escala e a
 * amostra 3D opcional), o portão do lead e o resultado.
 *
 * Privacidade: o lead fica só em memória. O localStorage guarda apenas a obra
 * (uso, base, espessura e medidas de cada ambiente, resina e cor). O nome livre
 * do ambiente fica só em memória: pode conter dado pessoal. Nada de dado
 * pessoal em URL ou no console.
 * Portão: antes do lead, nenhuma quantidade real é escrita no DOM.
 */
(function () {
  "use strict";

  var C = window.StoneDrenCalc;
  var SD = window.StoneDren || {};
  var root = document.getElementById("calcApp");
  if (!C || !root) return;

  var T = C.TABELA;
  var STORE = "stonedren.calc.v2";
  var MAX = T.limites.ambientesMax;
  var reduce = !!SD.reduceMotion;
  try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) reduce = true; } catch (e) {}
  var SVGNS = "http://www.w3.org/2000/svg";

  var $ = function (sel, el) { return (el || root).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); };

  var els = {
    form: $("#cxObra"), list: $("#cxAmbs"), add: $("#cxAdd"), count: $("#cxAmbCount"),
    tiles: $("#cxTiles"), resumo: $("#cxResumo"),
    donut: $("#cxDonut"), donutLegend: $("#cxDonutLegend"), donutTable: $("#cxDonutTable"),
    bars: $("#cxBars"), barsTable: $("#cxBarsTable"),
    corte: $("#cxCorte"), corteTabs: $("#cxCorteTabs"), corteTitulo: $("#cxCorteTitulo"), corteNota: $("#cxCorteNota"),
    wrap3d: $("#cx3dWrap"), canvas3d: document.getElementById("calcPreview3d"),
    leadSec: $("#cxLead"), leadForm: $("#cxLeadForm"), leadErr: $("#cxLeadErr"),
    result: $("#cxResult"),
    painel: $("#cxPainel"), painelTitulo: $("#cxPainelTitulo"),
    dock: $("#cxDock"), dockV: $("#cxDockV"), dockS: $("#cxDockS"), dockBtn: $("#cxDockBtn"),
    undo: $("#cxUndo"),
    envio: $("#cxEnvio"), envioSt: $("#cxEnvioSt"), reenviar: $("#cxReenviar"),
    previa: $("#cxPrevia"), previaNota: $("#cxPreviaNota"), previaFrame: $("#cxPreviaFrame")
  };

  // Envio do cálculo por e-mail: só numa página que marca a seção com data-email
  // ("obrigatorio" ou "opcional"). Na página principal nada disso existe e o fluxo é o de sempre.
  var alvoEmail = root.closest ? root.closest("[data-email]") : null;
  var modoEmail = alvoEmail ? String(alvoEmail.getAttribute("data-email") || "") : "";
  if (modoEmail !== "obrigatorio" && modoEmail !== "opcional") modoEmail = "";
  var paginaTeste = !!(alvoEmail && alvoEmail.getAttribute("data-teste") === "1");

  /* ---------- estado ---------- */
  var state = { ambientes: [], resina: "epoxi", cor: "branca", selecionado: null };
  var lead = null;          // só em memória, nunca persiste
  var unlocked = false;
  var ultimo = null;        // último resultado do motor
  var touched = {};         // campos que já perderam o foco (para não gritar erro cedo)
  var uid = 0;
  var visivel = false, animouEntrada = false;

  var BASE_PADRAO = { jardim: "solo", calcada: "solo", piscina: "contrapiso", garagem: "contrapiso" };

  function novoId() { uid += 1; return "a" + uid; }
  function novoAmbiente(over) {
    var a = { id: novoId(), nome: "", modo: "area", area: "", comprimento: "", largura: "", uso: "calcada", base: "solo", espessuraMm: null };
    if (over) for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k) && k !== "id") a[k] = over[k];
    return a;
  }
  function basesPermitidas(uso) {
    return C.basesDoUso(uso).filter(function (b) { return b.permitido; }).map(function (b) { return b.id; });
  }
  function fixBase(uso, base) {
    var ok = basesPermitidas(uso);
    return ok.indexOf(base) >= 0 ? base : (BASE_PADRAO[uso] || ok[0]);
  }
  function str(v, max) { return v == null ? "" : String(v).slice(0, max || 40); }
  function ambById(id) {
    for (var i = 0; i < state.ambientes.length; i++) if (state.ambientes[i].id === id) return state.ambientes[i];
    return null;
  }
  // Número e unidade não se separam na quebra de linha: "20 mm", "8 cm", "12,5 m²", "5.457 kg",
  // "2 x 3 m". Vale para tudo que vai para a página (esc usa nb).
  var NB_UNID = /(\d) (mm|cm|m²|m³|kg|t|m|sacos?|kits?|painéis|painel)(?![\wÀ-ÿ²³])/g;
  function nb(s) { return String(s == null ? "" : s).replace(NB_UNID, "$1\u00a0$2").replace(/(\d) x (\d)/g, "$1\u00a0x\u00a0$2"); }
  function esc(s) {
    return nb(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- persistência (só a obra, sem o nome livre do ambiente) ---------- */
  // Estado salvo por versões antigas pode trazer "nome": ele é descartado na leitura e o
  // armazenamento é regravado na hora, já sem o nome.
  function carregar() {
    try {
      var raw = window.localStorage.getItem(STORE);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || d.v !== 2 || !Array.isArray(d.ambientes)) return false;
      state.resina = T.resina.tipos[d.resina] ? d.resina : "epoxi";
      state.cor = T.cores[d.cor] ? d.cor : "branca";
      var tinhaNome = false;
      state.ambientes = d.ambientes.slice(0, MAX).map(function (a) {
        if (!a || typeof a !== "object") return null;
        if (Object.prototype.hasOwnProperty.call(a, "nome")) tinhaNome = true;
        var uso = T.perfis[a.uso] ? a.uso : "calcada";
        var esp = typeof a.espessuraMm === "number" && isFinite(a.espessuraMm) ? a.espessuraMm : null;
        return novoAmbiente({
          modo: a.modo === "medidas" ? "medidas" : "area",
          area: str(a.area, 16), comprimento: str(a.comprimento, 16), largura: str(a.largura, 16),
          uso: uso, base: fixBase(uso, a.base), espessuraMm: esp
        });
      }).filter(Boolean);
      if (tinhaNome) gravar();
      return state.ambientes.length > 0;
    } catch (e) { return false; }
  }
  function gravar() {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({
        v: 2, resina: state.resina, cor: state.cor,
        ambientes: state.ambientes.map(function (a) {
          return { uso: a.uso, base: a.base, espessuraMm: a.espessuraMm, modo: a.modo, area: a.area, comprimento: a.comprimento, largura: a.largura };
        })
      }));
    } catch (e) { /* armazenamento indisponível: a calculadora segue funcionando */ }
  }
  var saveTimer = 0;
  function salvar() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(gravar, 250);
  }

  /* ---------- ícones ---------- */
  var ICON = {
    dup: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="7" y="7" width="9" height="9" rx="1.6"/><path d="M13 4.5H5.6A1.6 1.6 0 0 0 4 6.1V13"/></svg>',
    del: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 6h10M8.2 6V4.6h3.6V6M6.4 6l.7 9.4h5.8l.7-9.4"/></svg>',
    resina: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M7 10h18l-1.6 16.2a2 2 0 0 1-2 1.8H10.6a2 2 0 0 1-2-1.8z"/><path d="M6 10h20"/><path d="M11 6.5c1.4-1.4 8.6-1.4 10 0"/><path d="M12 16.5c2 1.4 6 1.4 8 0"/></svg>',
    brita: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 25l3.5-5 4 1.2 2.4 3.8z"/><path d="M12 25l3-6.5 5.2.8 1.8 5.7z"/><path d="M20 25l3.4-4.6 4.6 1.4V25z"/><path d="M8.5 17.5l3.5-4.5 4.4 1.8-1 4.4z"/><path d="M17.5 16l2.6-4.2 4.6 1.9-.6 4.3z"/><path d="M3 25h26"/></svg>',
    malha: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="5" y="7" width="22" height="18" rx="1.5"/><path d="M5 13h22M5 19h22M11.3 7v18M17.6 7v18M23.9 7v18" opacity=".75"/></svg>',
    laje: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="4" y="11" width="24" height="10" rx="1.2"/><path d="M4 16h24" stroke-dasharray="2 2.6"/></svg>',
    info: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.6"/><path d="M10 9.2v4.9"/><path d="M10 6.2v.01" stroke-width="2.2"/></svg>',
    zap: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M20.5 3.5A11 11 0 0 0 3.2 17.3L2 22l4.8-1.2A11 11 0 0 0 20.5 3.5zM12 20a8 8 0 0 1-4.1-1.1l-.3-.2-2.8.7.8-2.7-.2-.3A8 8 0 1 1 12 20zm4.4-5.9c-.2-.1-1.4-.7-1.7-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.5 2.5 0 0 0 1.7-1.2 2 2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>',
    print: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6 7.5V3h8v4.5M6 14.5H4.2A1.2 1.2 0 0 1 3 13.3V8.7a1.2 1.2 0 0 1 1.2-1.2h11.6A1.2 1.2 0 0 1 17 8.7v4.6a1.2 1.2 0 0 1-1.2 1.2H14"/><rect x="6" y="11.5" width="8" height="5.5" rx=".6"/></svg>',
    copy: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="7" y="7" width="9" height="10" rx="1.6"/><path d="M13 4.5H5.6A1.6 1.6 0 0 0 4 6.1V14"/></svg>',
    edit: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 16l.6-3.2L13 4.4a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L7.2 15.4z"/><path d="M11.6 5.8l2.6 2.6"/></svg>'
  };

  /* ---------- cartões de ambiente ---------- */
  var USO_ORDEM = ["jardim", "calcada", "piscina", "garagem"];
  function usoSub(uso) {
    var p = T.perfis[uso];
    return (p.aConfirmar ? "Consumo a confirmar" : p.descricao) + " ·\u00a0" + p.espessuraMm + "\u00a0mm";
  }
  function baseSub(uso, b) {
    var p = T.perfis[uso];
    if (b.id === "solo") {
      if (!b.permitido) return "Não calculado";
      var cfg = p.bases.solo;
      return cfg.laje ? "Laje de " + T.laje.cm + " cm e brita de " + cfg.britaCm + " cm" : "Com brita de " + cfg.britaCm + " cm";
    }
    if (b.id === "contrapiso") return uso === "piscina" ? "Com caimento de 2%" : (uso === "garagem" ? "Base já pronta" : "Piso ou concreto pronto");
    if (b.id === "brita") return "Consulte a equipe";
    return "";
  }

  function cardHTML(a, i) {
    var n = i + 1, id = a.id, pre = "cx-" + id;
    var usos = USO_ORDEM.map(function (u) {
      var p = T.perfis[u];
      return '<label class="cx-opt cx-uso"><input type="radio" name="' + pre + '-uso" value="' + u + '"' + (a.uso === u ? " checked" : "") + '>' +
        '<span><b>' + esc(p.rotulo) + '</b><small>' + esc(usoSub(u)) + '</small></span></label>';
    }).join("");
    return '' +
      '<div class="cx-amb-top">' +
        '<span class="cx-amb-n" aria-hidden="true">' + (n < 10 ? "0" + n : n) + '</span>' +
        '<label class="cx-mini cx-amb-nl" for="' + pre + '-nome">Nome do ambiente (opcional)<span class="cx-sr">, ambiente ' + n + '</span></label>' +
        '<input class="cx-amb-nome" id="' + pre + '-nome" data-f="nome" type="text" maxlength="40" placeholder="ex.: Garagem, Quintal" autocomplete="off" enterkeyhint="next">' +
        '<div class="cx-amb-acts">' +
          '<button type="button" class="cx-ic-btn" data-act="dup" aria-label="Duplicar ambiente ' + n + '" title="Duplicar">' + ICON.dup + '</button>' +
          '<button type="button" class="cx-ic-btn" data-act="del" aria-label="Remover ambiente ' + n + '" title="Remover">' + ICON.del + '</button>' +
        '</div>' +
      '</div>' +
      '<fieldset class="cx-f"><legend class="cx-lbl">Tipo de uso</legend><div class="cx-usos">' + usos + '</div></fieldset>' +
      '<div class="cx-f cx-f-area">' +
        '<div class="cx-f-head"><span class="cx-lbl" id="' + pre + '-alab">Área</span>' +
          '<div class="cx-toggle" role="group" aria-label="Como informar a área do ambiente ' + n + '">' +
            '<button type="button" data-act="modo" data-modo="area" aria-pressed="' + (a.modo !== "medidas") + '">Em m²</button>' +
            '<button type="button" data-act="modo" data-modo="medidas" aria-pressed="' + (a.modo === "medidas") + '">Medidas</button>' +
          '</div></div>' +
        '<div class="cx-modo" data-modo-box="area"' + (a.modo === "medidas" ? " hidden" : "") + '>' +
          '<div class="cx-inp-u"><input class="cx-inp cx-inp-big" id="' + pre + '-area" data-f="area" type="text" inputmode="decimal" autocomplete="off" placeholder="ex.: 12,5" aria-labelledby="' + pre + '-alab" aria-describedby="' + pre + '-area-err"><span class="u" aria-hidden="true">m²</span></div>' +
          '<p class="cx-err" id="' + pre + '-area-err" data-err="area"></p>' +
        '</div>' +
        '<div class="cx-modo" data-modo-box="medidas"' + (a.modo === "medidas" ? "" : " hidden") + '>' +
          '<div class="cx-med">' +
            '<div><label class="cx-mini" for="' + pre + '-comp">Comprimento</label><div class="cx-inp-u"><input class="cx-inp" id="' + pre + '-comp" data-f="comprimento" type="text" inputmode="decimal" autocomplete="off" placeholder="ex.: 5" aria-describedby="' + pre + '-comp-err"><span class="u" aria-hidden="true">m</span></div></div>' +
            '<span class="cx-x" aria-hidden="true">×</span>' +
            '<div><label class="cx-mini" for="' + pre + '-larg">Largura</label><div class="cx-inp-u"><input class="cx-inp" id="' + pre + '-larg" data-f="largura" type="text" inputmode="decimal" autocomplete="off" placeholder="ex.: 2,5" aria-describedby="' + pre + '-larg-err"><span class="u" aria-hidden="true">m</span></div></div>' +
          '</div>' +
          '<p class="cx-med-eq" data-med-eq aria-live="polite"></p>' +
          '<p class="cx-err" id="' + pre + '-comp-err" data-err="comprimento"></p>' +
          '<p class="cx-err" id="' + pre + '-larg-err" data-err="largura"></p>' +
        '</div>' +
      '</div>' +
      '<fieldset class="cx-f cx-f-base"><legend class="cx-lbl">Base</legend><div class="cx-bases" data-bases></div><p class="cx-base-nota" data-base-nota></p></fieldset>' +
      '<div class="cx-f cx-f-esp">' +
        '<div class="cx-f-head"><label class="cx-lbl" for="' + pre + '-esp">Espessura da camada</label><output class="cx-esp-out" for="' + pre + '-esp" data-esp-out></output></div>' +
        '<div class="cx-range"><input type="range" id="' + pre + '-esp" data-f="espessuraMm" step="1" aria-describedby="' + pre + '-esp-help"><span class="cx-range-ref" data-esp-ref aria-hidden="true"></span></div>' +
        '<div class="cx-range-ends" aria-hidden="true"><span data-esp-min></span><span data-esp-max></span></div>' +
        '<p class="cx-esp-help" id="' + pre + '-esp-help" data-esp-help></p>' +
      '</div>' +
      '<p class="cx-amb-estado" data-estado role="note" hidden></p>';
  }

  function cardEl(id) { return els.list.querySelector('[data-id="' + id + '"]'); }

  function renderLista(focarId, focarSel) {
    els.list.innerHTML = "";
    state.ambientes.forEach(function (a, i) {
      var li = document.createElement("li");
      li.className = "cx-amb";
      li.setAttribute("data-id", a.id);
      li.innerHTML = cardHTML(a, i);
      els.list.appendChild(li);
      $('[data-f="nome"]', li).value = a.nome;
      $('[data-f="area"]', li).value = a.area;
      $('[data-f="comprimento"]', li).value = a.comprimento;
      $('[data-f="largura"]', li).value = a.largura;
      syncCard(a);
    });
    var n = state.ambientes.length;
    els.count.textContent = n + " de " + MAX;
    els.add.disabled = n >= MAX;
    els.add.querySelector("span").textContent = n >= MAX ? "Limite de 8 ambientes" : "Adicionar ambiente";
    $$('[data-act="del"]', els.list).forEach(function (b) { b.disabled = n <= 1; });
    $$('[data-act="dup"]', els.list).forEach(function (b, i) {
      b.disabled = n >= MAX;
      b.setAttribute("aria-label", "Duplicar ambiente " + (i + 1) + (n >= MAX ? " (limite de " + MAX + " ambientes atingido)" : ""));
      b.title = n >= MAX ? "Limite de " + MAX + " ambientes" : "Duplicar";
    });
    if (focarId) {
      var c = cardEl(focarId);
      var alvo = c && $(focarSel || '[data-f="nome"]', c);
      // botão desabilitado não recebe foco: cai no nome do ambiente
      if (alvo && alvo.disabled) alvo = $('[data-f="nome"]', c);
      if (alvo) alvo.focus(); else els.add.focus();
    }
  }

  // Atualiza as partes do cartão que dependem do uso, da base e da espessura.
  function syncCard(a) {
    var li = cardEl(a.id);
    if (!li) return;
    var pre = "cx-" + a.id;
    var p = T.perfis[a.uso];

    // bases
    var bases = C.basesDoUso(a.uso);
    var box = $("[data-bases]", li);
    var assinatura = a.uso + ":" + bases.map(function (b) { return b.id + b.permitido; }).join(",");
    if (box.getAttribute("data-sig") !== assinatura) {
      box.innerHTML = bases.map(function (b) {
        return '<label class="cx-opt' + (b.permitido ? "" : " is-off") + '"><input type="radio" name="' + pre + '-base" value="' + b.id + '"' + (b.permitido ? "" : " disabled") + '>' +
          '<span><b>' + esc(b.rotulo) + '</b><small>' + esc(baseSub(a.uso, b)) + '</small></span></label>';
      }).join("");
      box.setAttribute("data-sig", assinatura);
    }
    $$('input[type="radio"]', box).forEach(function (r) { r.checked = r.value === a.base; });
    var nota = $("[data-base-nota]", li);
    var motivos = bases.filter(function (b) { return !b.permitido && b.motivo; }).map(function (b) { return b.motivo; });
    if (a.base === "brita") motivos = [bases.filter(function (b) { return b.id === "brita"; })[0].motivo];
    nota.textContent = nb(motivos.join(" "));
    nota.hidden = !motivos.length;

    // espessura
    var lim = C.espessuraLimites(a.uso);
    var esp = a.espessuraMm == null ? lim.padraoMm : Math.min(lim.sliderMaxMm, Math.max(lim.sliderMinMm, Math.round(a.espessuraMm)));
    var range = $('[data-f="espessuraMm"]', li);
    range.min = lim.sliderMinMm; range.max = lim.sliderMaxMm;
    range.value = esp;
    range.setAttribute("aria-valuetext", esp + " milímetros");
    var pct = (lim.padraoMm - lim.sliderMinMm) / (lim.sliderMaxMm - lim.sliderMinMm);
    li.style.setProperty("--ref", pct.toFixed(4));
    li.style.setProperty("--val", ((esp - lim.sliderMinMm) / (lim.sliderMaxMm - lim.sliderMinMm)).toFixed(4));
    $("[data-esp-out]", li).textContent = nb(esp + " mm");
    $("[data-esp-min]", li).textContent = nb(lim.sliderMinMm + " mm");
    $("[data-esp-max]", li).textContent = nb(lim.sliderMaxMm + " mm");
    var help = $("[data-esp-help]", li);
    var ref = "Referência para " + p.rotulo.toLowerCase() + ": " + lim.padraoMm + " mm, " + C.graoFrase(p) + ".";
    help.classList.toggle("is-warn", esp < lim.minimoMm);
    if (esp < lim.minimoMm) {
      help.innerHTML = '<b>' + esc("Abaixo da espessura de referência (" + lim.minimoMm + " mm).") + '</b> Confirme com a equipe técnica antes de aplicar. <button type="button" class="linkbtn" data-act="espref">' + esc("Voltar para " + lim.padraoMm + " mm") + '</button>';
    } else if (esp !== lim.padraoMm) {
      help.innerHTML = esc(ref) + ' <button type="button" class="linkbtn" data-act="espref">' + esc("Usar " + lim.padraoMm + " mm") + '</button>';
    } else {
      help.textContent = nb(ref);
    }

    // medidas
    var eq = $("[data-med-eq]", li);
    if (a.modo === "medidas") {
      var c = C.parseNumero(a.comprimento), l = C.parseNumero(a.largura);
      eq.textContent = c > 0 && l > 0 ? nb("= " + C.fmtAuto(c * l) + " m²") : "";
    }
    $$('[data-act="modo"]', li).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-modo") === a.modo)); });
    $('[data-modo-box="area"]', li).hidden = a.modo === "medidas";
    $('[data-modo-box="medidas"]', li).hidden = a.modo !== "medidas";

    // estado nomeado do ambiente
    var est = $("[data-estado]", li);
    var msg = "";
    if (a.base === "brita") msg = "Consulte a equipe técnica: esta combinação não entra no cálculo.";
    else if (p.aConfirmar) msg = "Entorno de piscina: consumo de referência a confirmar pela equipe técnica.";
    est.textContent = nb(msg);
    est.hidden = !msg;
    li.classList.toggle("is-sel", state.selecionado === a.id);
    mostrarErros(a, false);
  }

  function mostrarErros(a, forcar) {
    var li = cardEl(a.id);
    if (!li) return 0;
    var v = C.validarAmbiente(a);
    var campos = a.modo === "medidas" ? ["comprimento", "largura"] : ["area"];
    var todos = ["area", "comprimento", "largura"];
    var n = 0;
    todos.forEach(function (f) {
      var p = $('[data-err="' + f + '"]', li);
      var inp = $('[data-f="' + f + '"]', li);
      var ativo = campos.indexOf(f) >= 0;
      var msg = ativo && v.erros[f] && (forcar || touched[a.id + f]) ? v.erros[f] : "";
      if (ativo && v.erros[f]) n++;
      p.textContent = msg;
      p.classList.toggle("on", !!msg);
      if (msg) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid");
    });
    return n;
  }

  /* ---------- eventos do formulário ---------- */
  function onCampo(e) {
    var t = e.target;
    var li = t.closest && t.closest(".cx-amb");
    if (li) {
      var a = ambById(li.getAttribute("data-id"));
      if (!a) return;
      var f = t.getAttribute("data-f");
      if (f === "nome") a.nome = t.value.slice(0, 40);
      else if (f === "area" || f === "comprimento" || f === "largura") {
        a[f] = t.value.slice(0, 16);
        if (a.modo === "medidas") syncCard(a); else mostrarErros(a, false);
      } else if (f === "espessuraMm") {
        a.espessuraMm = Number(t.value);
        syncCard(a);
      } else if (t.type === "radio" && /-uso$/.test(t.name)) {
        if (e.type !== "change") return;
        a.uso = t.value;
        a.espessuraMm = null;
        a.base = fixBase(a.uso, a.base === "brita" && a.uso !== "garagem" ? BASE_PADRAO[a.uso] : a.base);
        syncCard(a);
      } else if (t.type === "radio" && /-base$/.test(t.name)) {
        if (e.type !== "change") return;
        a.base = t.value;
        syncCard(a);
      }
      selecionar(a.id, true);
      agendar();
      return;
    }
    if (t.name === "cxResina" && e.type === "change") { state.resina = t.value; agendar(); }
    if (t.name === "cxCor" && e.type === "change") { state.cor = t.value; agendar(); }
  }
  els.form.addEventListener("input", onCampo);
  els.form.addEventListener("change", onCampo);
  els.form.addEventListener("submit", function (e) { e.preventDefault(); });
  els.list.addEventListener("focusout", function (e) {
    var t = e.target, f = t.getAttribute && t.getAttribute("data-f");
    if (f !== "area" && f !== "comprimento" && f !== "largura") return;
    var li = t.closest(".cx-amb");
    var a = li && ambById(li.getAttribute("data-id"));
    if (!a) return;
    if (String(t.value).trim() !== "") touched[a.id + f] = true;
    mostrarErros(a, false);
  });
  els.list.addEventListener("focusin", function (e) {
    var li = e.target.closest && e.target.closest(".cx-amb");
    if (li) selecionar(li.getAttribute("data-id"), false);
  });
  els.list.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-act]");
    if (!b) return;
    var li = b.closest(".cx-amb");
    var a = li && ambById(li.getAttribute("data-id"));
    if (!a) return;
    var act = b.getAttribute("data-act");
    var idx = state.ambientes.indexOf(a);
    if (act === "dup" && state.ambientes.length < MAX) {
      var copia = novoAmbiente(a);
      copia.nome = a.nome ? (a.nome + " (cópia)").slice(0, 40) : "";
      state.ambientes.splice(idx + 1, 0, copia);
      state.selecionado = copia.id;
      if (state.ambientes.length >= MAX) limparDesfazer();
      renderLista(copia.id);
      anunciar("Ambiente " + (idx + 2) + " criado como cópia do ambiente " + (idx + 1) + ".");
      agendar();
    } else if (act === "del" && state.ambientes.length > 1) {
      state.ambientes.splice(idx, 1);
      // foco no nome do ambiente que ficou no lugar (ou no anterior, se era o último):
      // nunca em outro botão Remover, para um segundo Enter não apagar mais um ambiente
      var viz = state.ambientes[Math.min(idx, state.ambientes.length - 1)];
      var eraSel = state.selecionado === a.id;
      if (eraSel) state.selecionado = viz.id;
      renderLista(viz.id, '[data-f="nome"]');
      oferecerDesfazer(a, idx, eraSel, "Ambiente " + (idx + 1) + " removido. A obra tem " + state.ambientes.length + (state.ambientes.length === 1 ? " ambiente." : " ambientes."));
      agendar();
    } else if (act === "modo") {
      var m = b.getAttribute("data-modo");
      if (a.modo === m) return;
      // levar a área calculada para o outro modo, quando fizer sentido
      if (m === "area" && !String(a.area).trim()) {
        var c = C.parseNumero(a.comprimento), l = C.parseNumero(a.largura);
        if (c > 0 && l > 0) { a.area = C.fmtAuto(c * l).replace(/\./g, ""); $('[data-f="area"]', li).value = a.area; }
      }
      a.modo = m;
      syncCard(a);
      var alvo = $(m === "medidas" ? '[data-f="comprimento"]' : '[data-f="area"]', li);
      if (alvo) alvo.focus();
      agendar();
    } else if (act === "espref") {
      a.espessuraMm = null;
      syncCard(a);
      $('[data-f="espessuraMm"]', li).focus();
      agendar();
    }
  });
  els.add.addEventListener("click", function () {
    if (state.ambientes.length >= MAX) return;
    var ult = state.ambientes[state.ambientes.length - 1];
    var novo = novoAmbiente({ uso: ult ? ult.uso : "calcada", base: ult ? ult.base : "solo" });
    state.ambientes.push(novo);
    state.selecionado = novo.id;
    if (state.ambientes.length >= MAX) limparDesfazer();
    renderLista(novo.id, '[data-f="nome"]');
    anunciar("Ambiente " + state.ambientes.length + " adicionado.");
    agendar();
  });

  function selecionar(id, silencioso) {
    if (state.selecionado === id) return;
    state.selecionado = id;
    $$(".cx-amb", els.list).forEach(function (li) { li.classList.toggle("is-sel", li.getAttribute("data-id") === id); });
    if (!silencioso && ultimo) { renderCorte(ultimo); renderTabs(ultimo); atualizar3d(); }
  }

  /* ---------- anúncios para leitor de tela ---------- */
  var anuncio = document.createElement("p");
  anuncio.className = "cx-sr";
  anuncio.setAttribute("role", "status");
  root.appendChild(anuncio);
  function anunciar(t) { anuncio.textContent = ""; setTimeout(function () { anuncio.textContent = t; }, 30); }

  /* ---------- desfazer a remoção de um ambiente (cerca de 6 s) ---------- */
  // A barra #cxUndo é uma região viva que existe desde o início (vazia): o texto e o botão
  // "Desfazer" entram nela e o leitor de tela anuncia os dois. O prazo não corre enquanto
  // o ponteiro ou o foco estão na barra.
  var desfazer = null, undoTimer = 0, UNDO_MS = 6000;
  function limparDesfazer() {
    clearTimeout(undoTimer);
    desfazer = null;
    if (!els.undo) return;
    els.undo.classList.remove("on");
    els.undo.innerHTML = "";
  }
  function armarDesfazer() {
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () {
      if (!els.undo) return;
      var ativo = els.undo.contains(document.activeElement);
      var sobre = false;
      try { sobre = els.undo.matches(":hover"); } catch (e) { sobre = false; }
      if (ativo || sobre) armarDesfazer(); else limparDesfazer();
    }, UNDO_MS);
  }
  function oferecerDesfazer(item, idx, eraSel, msg) {
    if (!els.undo) { anunciar(msg); return; }
    desfazer = { a: item, idx: idx, sel: eraSel };
    els.undo.innerHTML = '<span class="cx-undo-t">' + esc(msg) + '</span><button type="button" class="cx-undo-btn" data-undo>Desfazer</button>';
    els.undo.classList.add("on");
    armarDesfazer();
  }
  if (els.undo) {
    els.undo.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest("[data-undo]") || !desfazer) return;
      var d = desfazer;
      if (state.ambientes.length >= MAX) { limparDesfazer(); anunciar("Limite de " + MAX + " ambientes: remova um ambiente antes de trazer outro de volta."); return; }
      var pos = Math.min(d.idx, state.ambientes.length);
      state.ambientes.splice(pos, 0, d.a);
      if (d.sel) state.selecionado = d.a.id;
      limparDesfazer();
      renderLista(d.a.id, '[data-f="nome"]');
      anunciar("Ambiente " + (pos + 1) + " restaurado. A obra tem " + state.ambientes.length + " ambientes.");
      agendar();
    });
    els.undo.addEventListener("focusout", function () { if (desfazer) armarDesfazer(); });
    els.undo.addEventListener("pointerleave", function () { if (desfazer) armarDesfazer(); });
  }

  /* ---------- ciclo de cálculo ---------- */
  var calcTimer = 0;
  function agendar() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(atualizar, 110);
  }
  function obraAtual() {
    return { ambientes: state.ambientes, resina: state.resina, cor: state.cor };
  }
  function atualizar() {
    var r = C.calcularObra(obraAtual());
    ultimo = r;
    root.setAttribute("data-state", r.totais || r.consulte ? (unlocked ? "liberado" : "bloqueado") : "vazio");
    renderTiles(r);
    renderDonut(r);
    renderBars(r);
    renderTabs(r);
    renderCorte(r);
    renderResumo(r);
    renderDock(r);
    if (unlocked) renderResultado(r);
    atualizar3d();
    salvar();
  }

  /* ---------- números animados ---------- */
  function animarNumero(el, alvo, casas, sufixo) {
    var de = parseFloat(el.getAttribute("data-num"));
    el.setAttribute("data-num", String(alvo));
    var txt = function (v) { return (casas === 2 ? C.fmtAuto(v, 2) : C.fmt(v, casas)) + (sufixo || ""); };
    if (reduce || !visivel || !isFinite(de) || de === alvo || document.hidden) { el.textContent = txt(alvo); return; }
    var t0 = 0, dur = 650;
    var tok = {};
    el._tok = tok;
    function passo(ts) {
      if (el._tok !== tok) return;
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = txt(de + (alvo - de) * e);
      if (k < 1) requestAnimationFrame(passo); else el.textContent = txt(alvo);
    }
    requestAnimationFrame(passo);
    // garantia: se o navegador segurar os quadros, o valor final aparece mesmo assim
    setTimeout(function () { if (el._tok === tok) el.textContent = txt(alvo); }, dur + 400);
  }
  function kgPartes(kg) {
    // acima de 1.000 t, sem casa decimal: "5.457 t" em vez de "5.457,0 t"
    if (kg >= 1000000) return { v: kg / 1000, casas: 0, u: "t" };
    if (kg >= 100000) return { v: kg / 1000, casas: 1, u: "t" };
    return { v: kg, casas: kg < 100 ? 1 : 0, u: "kg" };
  }

  /* ---------- indicadores ---------- */
  // Um só texto para tudo que fica bloqueado antes do formulário (tiles, tabelas, dicas).
  var BLOQ = "Liberado depois de preencher o formulário";
  function listaE(itens) { return itens.length <= 1 ? itens.join("") : itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1]; }
  var BLUR = { pedra: "0.000", resina: "00", brita: "000" };
  function tileEl(k) { return els.tiles.querySelector('[data-tile="' + k + '"]'); }
  function tileSet(k, o) {
    var t = tileEl(k);
    var v = $("[data-v]", t), s = $("[data-s]", t), u = $("[data-u]", t);
    t.classList.toggle("is-locked", !!o.locked);
    t.classList.toggle("is-named", !!o.nomeado);
    if (o.locked) {
      v.removeAttribute("data-num");
      v.innerHTML = '<span class="cx-blur" aria-hidden="true">' + BLUR[k] + '</span><span class="cx-sr">' + BLOQ + '</span>';
    } else if (o.nomeado) {
      v.removeAttribute("data-num");
      v.textContent = o.nomeado;
    } else {
      if (v.querySelector(".cx-blur")) v.textContent = "";
      animarNumero(v, o.valor, o.casas);
    }
    if (u) { u.textContent = o.unidade || ""; u.hidden = !!o.nomeado; }
    s.textContent = nb(o.sub || "");
  }
  function renderTiles(r) {
    var t = r.totais;
    var areaT = tileEl("area");
    var vA = $("[data-v]", areaT);
    var soConsulte = !t && r.consulte > 0;
    if (t || soConsulte) {
      var areaV = t ? t.areaM2 : r.areaConsulteM2;
      areaT.classList.remove("is-named");
      areaT.classList.toggle("is-consulte", soConsulte);
      animarNumero(vA, areaV, areaV % 1 ? 2 : 0);
      $("small", areaT).hidden = false;
      var sub;
      if (soConsulte) sub = "A consultar com a equipe técnica";
      else {
        sub = r.calculados + (r.calculados === 1 ? " ambiente calculado" : " ambientes calculados");
        if (r.consulte) sub += " · " + C.fmtAuto(r.areaConsulteM2) + " m² a consultar";
      }
      $("[data-s]", areaT).textContent = nb(sub);
    } else {
      areaT.classList.add("is-named");
      areaT.classList.remove("is-consulte");
      vA.removeAttribute("data-num");
      vA.textContent = "A informar";
      $("small", areaT).hidden = true;
      $("[data-s]", areaT).textContent = "Digite a área de um ambiente";
    }

    if (soConsulte) {
      tileSet("pedra", { nomeado: "A consultar", sub: "Base fora desta versão do cálculo" });
      tileSet("resina", { nomeado: "A consultar", sub: "A equipe técnica indica o consumo" });
      tileSet("brita", { nomeado: "A consultar", sub: "Depende da base" });
      return;
    }
    if (!t) {
      tileSet("pedra", { nomeado: "A informar", sub: "Sacos de " + T.pedra.sacoKg + " kg" });
      tileSet("resina", { nomeado: "A informar", sub: "Kits de referência" });
      tileSet("brita", { nomeado: "A informar", sub: "Só para base sobre solo" });
      return;
    }
    if (!unlocked) {
      tileSet("pedra", { locked: true, unidade: "kg", sub: "Em sacos de " + T.pedra.sacoKg + " kg" });
      tileSet("resina", { locked: true, unidade: "kits", sub: "Resina " + t.resina.curto + " + endurecedor" });
      if (t.brita) tileSet("brita", { locked: true, unidade: "sacos", sub: "Base sobre solo" });
      else tileSet("brita", { nomeado: "Não se aplica", sub: "Nenhum ambiente sobre solo" });
      return;
    }
    var kp = kgPartes(t.pedra.kg);
    tileSet("pedra", { valor: kp.v, casas: kp.casas, unidade: kp.u, sub: C.qtd(t.pedra.sacos, "saco", "sacos") + " de " + t.pedra.sacoKg + " kg" });
    tileSet("resina", { valor: t.resina.kits, casas: 0, unidade: t.resina.kits === 1 ? "kit" : "kits", sub: C.fmtKg(t.resina.kg) + " já com o endurecedor · " + t.resina.curto });
    if (t.brita) tileSet("brita", { valor: t.brita.sacos, casas: 0, unidade: t.brita.sacos === 1 ? "saco" : "sacos", sub: C.fmtM3(t.brita.m3) + " de brita solta" + (t.brita.granel ? " · a granel" : "") });
    else tileSet("brita", { nomeado: "Não se aplica", sub: "Nenhum ambiente sobre solo" });
  }

  /* ---------- tooltip compartilhado ---------- */
  var tip = document.createElement("div");
  tip.className = "cx-tip";
  tip.setAttribute("aria-hidden", "true");
  tip.innerHTML = "<b></b><span></span>";
  root.appendChild(tip);
  function tipShow(e, valor, rotulo, cor) {
    tip.firstChild.textContent = nb(valor);
    tip.lastChild.textContent = nb(rotulo);
    tip.style.setProperty("--k", cor || "transparent");
    var rb = root.getBoundingClientRect();
    var x = e.clientX - rb.left, y = e.clientY - rb.top;
    tip.style.transform = "translate(" + Math.round(x + 14) + "px," + Math.round(y - 12) + "px)";
    tip.classList.add("on");
  }
  function tipHide() { tip.classList.remove("on"); }

  /* ---------- rosca: massa por material ---------- */
  var MAT = [
    { k: "pedra", rotulo: "Pedra", cor: "var(--cx-pedra)" },
    { k: "resina", rotulo: "Resina", cor: "var(--cx-resina)" },
    { k: "brita", rotulo: "Brita", cor: "var(--cx-brita)" }
  ];
  function arco(cx, cy, r, a0, a1) {
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var grande = a1 - a0 > Math.PI ? 1 : 0;
    return "M" + x0.toFixed(2) + " " + y0.toFixed(2) + "A" + r + " " + r + " 0 " + grande + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2);
  }
  function renderDonut(r) {
    var t = r.totais;
    var S = 200, R = 76, W = 22, cx = S / 2, cy = S / 2;
    var partes = [];
    if (t) {
      partes.push({ m: MAT[0], kg: t.pedra.kg });
      partes.push({ m: MAT[1], kg: t.resina.kg });
      if (t.brita) partes.push({ m: MAT[2], kg: t.brita.kg });
    }
    var total = partes.reduce(function (s, p) { return s + p.kg; }, 0);
    var svg = '<svg viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-labelledby="cxDonutT cxDonutD"><title id="cxDonutT">Massa total da obra por material</title><desc id="cxDonutD">' +
      esc(t ? (unlocked ? partes.map(function (p) { return p.m.rotulo + " " + C.fmtKg(p.kg); }).join(", ") : "Proporção entre " + listaE(partes.map(function (p) { return p.m.rotulo.toLowerCase(); })) + ". Preencha o formulário para ver as quantidades.") : (r.consulte ? "Sem quantidades: a área informada precisa de avaliação da equipe técnica." : "Sem dados: informe a área de um ambiente.")) +
      // com fatias, sem trilho por baixo: o vão de ~2 px entre elas mostra o navy do painel
      '</desc>' + (total > 0 ? '' : '<circle class="cx-donut-track" cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke-width="' + W + '"/>') + '<g class="cx-donut-ring">';
    if (total > 0) {
      var gap = 2 / R;                  // 2px de superfície entre fatias
      var minA = 3 * Math.PI / 180;     // fatia mínima visível
      var angs = partes.map(function (p) { return Math.max(minA, p.kg / total * Math.PI * 2); });
      var soma = angs.reduce(function (s, a) { return s + a; }, 0);
      var escala = (Math.PI * 2) / soma;
      var a = -Math.PI / 2;
      partes.forEach(function (p, i) {
        var da = angs[i] * escala;
        var a0 = a + gap / 2, a1 = a + da - gap / 2;
        if (partes.length === 1) svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="' + p.m.cor + '" stroke-width="' + W + '" data-k="' + p.m.k + '"/>';
        else svg += '<path d="' + arco(cx, cy, R, a0, a1) + '" fill="none" stroke="' + p.m.cor + '" stroke-width="' + W + '" data-k="' + p.m.k + '"/>';
        a += da;
      });
    }
    svg += '</g><g class="cx-donut-c" text-anchor="middle">';
    if (!t) svg += '<text x="' + cx + '" y="' + (cy - 4) + '" class="cx-dc-l">Massa total</text><text x="' + cx + '" y="' + (cy + 18) + '" class="cx-dc-n">' + (r.consulte ? "A consultar" : "A informar") + '</text>';
    else if (!unlocked) svg += '<text x="' + cx + '" y="' + (cy - 8) + '" class="cx-dc-l">Massa total</text><text x="' + cx + '" y="' + (cy + 20) + '" class="cx-dc-v cx-blur" aria-hidden="true">0.000</text>';
    else {
      var kp = kgPartes(total);
      svg += '<text x="' + cx + '" y="' + (cy - 8) + '" class="cx-dc-l">Massa total</text><text x="' + cx + '" y="' + (cy + 20) + '" class="cx-dc-v"><tspan data-dnum></tspan><tspan class="cx-dc-u" dx="4">' + kp.u + '</tspan></text>';
    }
    svg += '</g></svg>';
    var prevNum = els.donut.getAttribute("data-num");
    els.donut.innerHTML = svg;
    if (t && unlocked) {
      var kp2 = kgPartes(total);
      var tn = els.donut.querySelector("[data-dnum]");
      if (prevNum) tn.setAttribute("data-num", prevNum);
      animarNumero(tn, kp2.v, kp2.casas);
      els.donut.setAttribute("data-num", String(kp2.v));
    } else els.donut.removeAttribute("data-num");
    entrada(els.donut.querySelector(".cx-donut-ring"));

    // legenda (texto em tinta, cor só na marca ao lado)
    els.donutLegend.innerHTML = "";
    (partes.length ? partes : MAT.slice(0, 3).map(function (m) { return { m: m, kg: null }; })).forEach(function (p) {
      var li = document.createElement("li");
      li.setAttribute("data-k", p.m.k);
      var k = document.createElement("i");
      k.style.background = p.m.cor;
      var nome = document.createElement("span");
      nome.className = "cx-lg-n";
      nome.textContent = p.m.rotulo;
      var val = document.createElement("span");
      val.className = "cx-lg-v";
      if (p.kg == null) val.textContent = r.consulte ? "A consultar" : (p.m.k === "brita" ? "Base sobre solo" : "A informar");
      else if (!unlocked) { val.innerHTML = '<span class="cx-blur" aria-hidden="true">000 kg</span>'; }
      else val.textContent = nb(C.fmtKg(p.kg) + " · " + C.fmtAuto(p.kg / total * 100, 1) + "%");
      li.appendChild(k); li.appendChild(nome); li.appendChild(val);
      els.donutLegend.appendChild(li);
    });
    if (t && !t.brita) {
      var li2 = document.createElement("li");
      li2.className = "is-na";
      li2.innerHTML = '<i class="na"></i><span class="cx-lg-n">Brita</span><span class="cx-lg-v">Não se aplica</span>';
      els.donutLegend.appendChild(li2);
    }

    // tabela equivalente
    els.donutTable.innerHTML = tabela(["Material", "Massa", "Parte do total"], partes.map(function (p) {
      return [p.m.rotulo, unlocked ? C.fmtKg(p.kg) : BLOQ, unlocked ? C.fmtAuto(p.kg / total * 100, 1) + "%" : BLOQ];
    }), t ? "" : (r.consulte ? "A área informada precisa de avaliação da equipe técnica." : "Informe a área de um ambiente."), "Tabela da massa por material");

    // hover
    $$("path[data-k],circle[data-k]", els.donut).forEach(function (seg) {
      var k = seg.getAttribute("data-k");
      var p = partes.filter(function (x) { return x.m.k === k; })[0];
      seg.addEventListener("pointermove", function (e) {
        els.donut.classList.add("is-hover");
        seg.classList.add("on");
        tipShow(e, unlocked ? C.fmtKg(p.kg) + " · " + C.fmtAuto(p.kg / total * 100, 1) + "%" : BLOQ, p.m.rotulo, p.m.cor);
      }, { passive: true });
      seg.addEventListener("pointerleave", function () { els.donut.classList.remove("is-hover"); seg.classList.remove("on"); tipHide(); }, { passive: true });
    });
  }

  // número e unidade não se separam na quebra de linha ("5.457.000 kg" inteiro): esc já aplica nb
  function unid(c) { return nb(c); }
  function tabela(cab, linhas, vazio, rotulo) {
    if (!linhas.length) return '<p class="cx-t-vazio">' + esc(vazio || "Sem dados.") + '</p>';
    // contêiner com rolagem própria: números grandes não empurram o cartão no celular
    return '<div class="cx-t-scroll" tabindex="0" role="region" aria-label="' + esc(rotulo || "Tabela") + '"><table><thead><tr>' + cab.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      linhas.map(function (l) { return '<tr>' + l.map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + '</th>' : '<td>' + esc(unid(c)) + '</td>'; }).join("") + '</tr>'; }).join("") +
      '</tbody></table></div>';
  }

  // entrada da marca: só transform/opacity, uma vez, quando o painel aparece
  function entrada(el) {
    if (!el || reduce) return;
    if (animouEntrada) return;
    el.classList.add("cx-pre");
    if (visivel) requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove("cx-pre"); }); });
  }

  /* ---------- barras por ambiente ---------- */
  function renderBars(r) {
    var linhas = r.ambientes.map(function (a, i) { return { a: a, i: i }; });
    var max = 0;
    r.ambientes.forEach(function (a) { if (a.estado === "ok") max = Math.max(max, a.pedra.kg + a.resina.kg); });
    var antes = {};
    $$(".cx-bar-row", els.bars).forEach(function (row) {
      var bar = $(".cx-bar", row), v = $(".cx-bar-v", row);
      antes[row.getAttribute("data-id")] = { w: bar ? bar.getBoundingClientRect().width : 0, x: v ? v.getBoundingClientRect().left : 0 };
    });
    els.bars.innerHTML = "";
    linhas.forEach(function (o) {
      var a = o.a;
      var row = document.createElement("div");
      row.className = "cx-bar-row" + (a.id === state.selecionado ? " is-sel" : "");
      row.setAttribute("data-id", a.id);
      var lbl = document.createElement("div");
      lbl.className = "cx-bar-lbl";
      var b = document.createElement("b");
      b.textContent = C.nomeAmbiente(a, o.i);
      var sm = document.createElement("small");
      sm.textContent = nb(a.estado === "incompleto" ? T.perfis[a.uso].rotulo : T.perfis[a.uso].rotulo + " · " + C.fmtAuto(a.areaM2) + " m²");
      lbl.appendChild(b); lbl.appendChild(sm);
      var track = document.createElement("div");
      track.className = "cx-bar-track";
      if (a.estado === "ok") {
        var tot = a.pedra.kg + a.resina.kg;
        var bar = document.createElement("div");
        bar.className = "cx-bar";
        bar.style.setProperty("--f", (tot / max).toFixed(4));
        // proporção pedra:resina pela premissa publicada (nenhum kg real no DOM antes do lead)
        bar.innerHTML = '<i class="s-pedra" style="flex-grow:1"></i><i class="s-resina" style="flex-grow:' + a.resina.pct + '"></i>';
        track.appendChild(bar);
        var v = document.createElement("span");
        v.className = "cx-bar-v";
        if (unlocked) v.textContent = nb(C.fmtKg(tot));
        else v.innerHTML = '<span class="cx-blur" aria-hidden="true">000 kg</span>';
        track.appendChild(v);
        var hover = function (e) {
          tipShow(e, unlocked ? C.fmtKg(a.pedra.kg) + " de pedra + " + C.fmtKg(a.resina.kg) + " de resina" : BLOQ, C.nomeAmbiente(a, o.i), "var(--cx-pedra)");
          row.classList.add("on");
        };
        bar.addEventListener("pointermove", hover, { passive: true });
        bar.addEventListener("pointerleave", function () { tipHide(); row.classList.remove("on"); }, { passive: true });
      } else {
        var st = document.createElement("span");
        st.className = "cx-bar-st";
        st.textContent = a.estado === "consulte" ? "Consulte a equipe técnica" : "Informe a área";
        track.appendChild(st);
      }
      row.appendChild(lbl);
      row.appendChild(track);
      row.addEventListener("click", function () { selecionar(a.id, false); });
      els.bars.appendChild(row);
    });

    // FLIP: a barra nasce no tamanho novo e anima de onde estava, só com transform
    if (!reduce && visivel) {
      $$(".cx-bar-row", els.bars).forEach(function (row) {
        var bar = $(".cx-bar", row), v = $(".cx-bar-v", row);
        if (!bar) return;
        var id = row.getAttribute("data-id");
        var nw = bar.getBoundingClientRect().width;
        var de = antes[id];
        var sx = de && nw > 0 ? de.w / nw : 0;
        if (Math.abs(1 - sx) < 0.002) return;
        bar.style.transition = "none";
        bar.style.transform = "scaleX(" + Math.max(0, sx).toFixed(4) + ")";
        if (v) { v.style.transition = "none"; v.style.transform = "translateX(" + ((de ? de.x : bar.getBoundingClientRect().left) - v.getBoundingClientRect().left).toFixed(1) + "px)"; v.style.opacity = de ? "1" : "0"; }
        bar.getBoundingClientRect();
        requestAnimationFrame(function () {
          bar.style.transition = "";
          bar.style.transform = "";
          if (v) { v.style.transition = ""; v.style.transform = ""; v.style.opacity = ""; }
        });
      });
    }

    els.barsTable.innerHTML = tabela(["Ambiente", "Área", "Pedra", "Resina"], r.ambientes.filter(function (a) { return a.estado !== "incompleto"; }).map(function (a) {
      var i = r.ambientes.indexOf(a);
      if (a.estado === "consulte") return [C.nomeAmbiente(a, i), C.fmtAuto(a.areaM2) + " m²", "Consulte a equipe técnica", "Consulte a equipe técnica"];
      return [C.nomeAmbiente(a, i), C.fmtAuto(a.areaM2) + " m²", unlocked ? C.fmtKg(a.pedra.kg) : BLOQ, unlocked ? C.fmtKg(a.resina.kg) : BLOQ];
    }), "Informe a área de um ambiente.", "Tabela de pedra e resina por ambiente");
  }

  /* ---------- abas do corte ---------- */
  function renderTabs(r) {
    var tabs = els.corteTabs;
    tabs.innerHTML = "";
    tabs.hidden = r.ambientes.length < 2;
    if (tabs.hidden) return;
    r.ambientes.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cx-tab";
      b.setAttribute("aria-pressed", String(a.id === state.selecionado));
      var num = (i < 9 ? "0" : "") + (i + 1);
      var visivel = num + " " + T.perfis[a.uso].rotulo;
      var n = document.createElement("span");
      n.textContent = num;
      b.appendChild(n);
      b.appendChild(document.createTextNode(" " + T.perfis[a.uso].rotulo));
      // WCAG 2.5.3: o nome acessível começa exatamente pelo texto visível ("01 Calçada"),
      // assim quem usa comando de voz aciona a aba falando o que vê
      b.setAttribute("aria-label", visivel + ", corte de " + C.nomeAmbiente(a, i));
      b.addEventListener("click", function () {
        selecionar(a.id, false);
        var bt = els.corteTabs.querySelectorAll(".cx-tab")[i];
        if (bt) bt.focus();
      });
      tabs.appendChild(b);
    });
  }

  /* ---------- corte em escala ---------- */
  function ambSelecionado(r) {
    var sel = null;
    r.ambientes.forEach(function (a) { if (a.id === state.selecionado) sel = a; });
    return sel || r.ambientes[0] || null;
  }
  // camadas mesmo sem área: o corte não depende da metragem
  function corteDo(a) {
    var src = ambById(a.id) || {};
    var tmp = {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) tmp[k] = src[k];
    tmp.modo = "area"; tmp.area = 1;
    return C.calcularAmbiente(tmp, { resina: state.resina });
  }
  var ultimoCorteSig = "";
  function renderCorte(r) {
    var a0 = ambSelecionado(r);
    if (!a0) { els.corte.innerHTML = ""; return; }
    var a = a0.estado === "incompleto" ? corteDo(a0) : a0;
    if (a.estado === "incompleto") return;
    var idx = r.ambientes.indexOf(a0);
    var nome = C.nomeAmbiente(a0, idx);
    els.corteTitulo.textContent = nb("Corte em escala · " + nome);

    var W = Math.max(240, Math.floor(els.corte.clientWidth || 520));
    var narrow = W < 420;
    var labelsX = narrow ? 10 : 16;
    var dimW = narrow ? 72 : 86;
    var x0 = 0, x1 = W - dimW;
    var topo = 50;
    var fora = narrow ? 34 : 40;               // altura das camadas fora de escala
    var disponivel = narrow ? 170 : 210;
    var emEscala = a.camadas.filter(function (c) { return c.emEscala; });
    var somaMm = emEscala.reduce(function (s, c) { return s + c.espessuraMm; }, 0);
    var s = Math.min(3.2, disponivel / somaMm);   // px por mm
    var y = topo;
    var cam = a.camadas.map(function (c) {
      var h = c.emEscala ? c.espessuraMm * s : fora;
      var o = { c: c, y: y, h: h };
      y += h;
      return o;
    });
    var H = Math.round(y + 44);
    var cor = state.cor;
    var sig = [W, a.uso, a.base, a.espessuraMm, cor].join("|");

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-labelledby="cxCorteT cxCorteD">';
    svg += '<title id="cxCorteT">Corte em escala do ambiente ' + esc(nome) + '</title>';
    svg += '<desc id="cxCorteD">' + esc(cam.map(function (o) {
      return o.c.rotulo + (o.c.espessuraMm ? ", " + medida(o.c.espessuraMm, o.c.id) : ", espessura fora de escala");
    }).join("; ") + ".") + '</desc>';
    svg += '<defs>' +
      '<linearGradient id="cxpSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".35" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>' +
      '<pattern id="cxpBrita" width="46" height="30" patternUnits="userSpaceOnUse"><rect width="46" height="30" fill="#3b4049"/><path d="M3 5l8-3 6 5-4 7-9-2z" fill="#8b9099"/><path d="M20 3l9 1 3 8-7 4-6-5z" fill="#6f757f"/><path d="M34 7l9 2-1 9-8-1z" fill="#9aa0a8"/><path d="M6 18l9-1 4 8-8 4-6-4z" fill="#7f858e"/><path d="M24 17l8-2 5 7-5 6-9-3z" fill="#9097a0"/><path d="M40 20l6 1v8l-6-1z" fill="#737983"/></pattern>' +
      '<pattern id="cxpLaje" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#8a8e95"/><circle cx="4" cy="5" r=".9" fill="#a3a7ad"/><circle cx="13" cy="11" r="1.1" fill="#72767d"/><circle cx="8" cy="15" r=".7" fill="#9a9ea5"/></pattern>' +
      '<pattern id="cxpCont" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#6d7179"/><path d="M0 22L22 0" stroke="#7d8189" stroke-width="1"/></pattern>' +
      '<pattern id="cxpSolo" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="#3a2a1d"/><circle cx="6" cy="7" r="1.4" fill="#57402e"/><circle cx="19" cy="17" r="1.2" fill="#57402e"/><circle cx="11" cy="22" r="1" fill="#4a3627"/></pattern>' +
      '<linearGradient id="cxpRain" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="26"><stop offset="0" stop-color="#9CC7D8" stop-opacity="0"/><stop offset="1" stop-color="#CFE6F0" stop-opacity=".95"/></linearGradient>' +
      '<linearGradient id="cxpFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101E36" stop-opacity="0"/><stop offset="1" stop-color="#101E36" stop-opacity=".92"/></linearGradient>' +
      '<clipPath id="cxpClip"><rect x="' + x0 + '" y="' + topo + '" width="' + (x1 - x0) + '" height="' + (y - topo) + '" rx="6"/></clipPath>' +
      '</defs>';

    // chuva
    var gotas = "";
    var nGotas = narrow ? 5 : 7;
    for (var g = 0; g < nGotas; g++) {
      var gx = Math.round(x0 + (x1 - x0) * (g + 0.5) / nGotas + (g % 2 ? 6 : -6));
      gotas += '<path class="cx-rain" style="--i:' + g + '" d="M' + gx + ' 8l-2 16" />';
    }
    svg += '<g class="cx-rain-g" stroke="url(#cxpRain)" stroke-width="1.7" stroke-linecap="round">' + gotas + '</g>';

    // camadas
    svg += '<g clip-path="url(#cxpClip)">';
    cam.forEach(function (o, i) {
      var id = o.c.id, yy = o.y.toFixed(2), hh = o.h.toFixed(2);
      var fill = id === "stone" ? "#6d5a3c" : id === "brita" ? "url(#cxpBrita)" : id === "laje" ? "url(#cxpLaje)" : id === "contrapiso" ? "url(#cxpCont)" : "url(#cxpSolo)";
      svg += '<g class="cx-layer" data-l="' + id + '" style="--d:' + (i * 70) + 'ms">';
      svg += '<rect x="' + x0 + '" y="' + yy + '" width="' + (x1 - x0) + '" height="' + hh + '" fill="' + fill + '"/>';
      // pedra: a foto inteira, uma vez, cortada na faixa (sem ladrilho e sem emenda). Na largura do
      // desenho, os grãos da foto ficam perto da escala real (3 a 6 mm viram 10 a 20 px).
      if (id === "stone") svg += '<image href="img/pedra-' + cor + '.jpg" x="' + x0 + '" y="' + yy + '" width="' + (x1 - x0) + '" height="' + hh + '" preserveAspectRatio="xMidYMid slice"/>' +
        '<rect x="' + x0 + '" y="' + yy + '" width="' + (x1 - x0) + '" height="' + hh + '" fill="url(#cxpSheen)"/><path d="M' + x0 + ' ' + yy + 'H' + x1 + '" stroke="#F4DFA8" stroke-opacity=".55" stroke-width="1.2"/>';
      if (id === "laje") {
        var ym = (o.y + o.h * 0.55).toFixed(1), marks = "";
        for (var mx = x0 + 10; mx < x1 - 4; mx += 14) marks += "M" + mx + " " + (+ym - 3) + "v6";
        svg += '<path d="M' + x0 + ' ' + ym + 'H' + x1 + marks + '" stroke="#E6D3A3" stroke-width="1.3" fill="none" opacity=".9"/>';
      }
      if (!o.c.emEscala) {
        svg += '<rect x="' + x0 + '" y="' + yy + '" width="' + (x1 - x0) + '" height="' + hh + '" fill="url(#cxpFade)"/>';
      }
      svg += '</g>';
    });
    svg += '</g>';

    // água atravessando a camada de pedra. Só desce para dentro da base quando ela é brita;
    // sobre laje ou contrapiso a gota para no topo e a seta mostra o escoamento pelo caimento
    // (o desenho não sugere que concreto seja permeável).
    var abaixo = cam[1] ? cam[1].c.id : "";
    var paraNoTopo = abaixo === "laje" || abaixo === "contrapiso";
    var fundoAgua = cam.length > 1 ? cam[1].y + (paraNoTopo ? 2 : Math.min(cam[1].h * 0.8, 70)) : y;
    var quedas = "";
    var nq = narrow ? 3 : 4;
    for (var q = 0; q < nq; q++) {
      var qx = Math.round(x0 + (x1 - x0) * (q + 0.62) / (nq + 0.25));
      quedas += '<circle class="cx-drop" style="--i:' + q + ';--fall:' + Math.round(fundoAgua - topo + 4) + 'px" cx="' + qx + '" cy="' + (topo - 6) + '" r="2.6"/>';
    }
    svg += '<g fill="#9CC7D8">' + quedas + '</g>';
    if (paraNoTopo) {
      var ya = (cam[1].y - 5).toFixed(1);
      svg += '<g class="cx-escoa" stroke="#9CC7D8" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M' + (x0 + 24) + ' ' + ya + 'H' + (x1 - 20) + '"/><path d="M' + (x1 - 26) + ' ' + (+ya - 4) + 'l6 4-6 4"/></g>';
    }

    // rótulos das camadas (curtos no desenho; a descrição acessível leva o nome completo)
    var CURTO = { stone: narrow ? "Stone Dren" : "Stone Dren · pedra + resina", laje: "Laje com malha POP", brita: "Brita compactada", solo: "Solo compactado",
      contrapiso: a.uso === "garagem" ? "Concreto ou asfalto" : "Contrapiso existente" };
    cam.forEach(function (o) {
      var txt = (CURTO[o.c.id] || o.c.rotulo).toUpperCase();
      if (o.c.emEscala) {
        var dentro = o.h >= 17;
        var yl = dentro ? o.y + o.h / 2 : o.y - 7;
        svg += '<text class="cx-cl' + (o.c.id === "stone" ? " cx-cl-stone" : "") + '" x="' + (x0 + labelsX) + '" y="' + yl.toFixed(1) + '" dominant-baseline="middle">' + esc(txt) + '</text>';
      } else {
        var sub = "fora de escala";
        if (o.c.id === "contrapiso") sub += a.caimentoPct ? " · a água escoa pelo caimento de " + a.caimentoPct + "%" : " · a água escoa pelo caimento";
        svg += '<text class="cx-cl" x="' + (x0 + labelsX) + '" y="' + (o.y + 14).toFixed(1) + '" dominant-baseline="middle">' + esc(txt) + '</text>' +
          '<text class="cx-cl-fora" x="' + (x0 + labelsX) + '" y="' + (o.y + 27).toFixed(1) + '" dominant-baseline="middle">' + esc(sub) + '</text>';
      }
    });

    // cotas à direita
    var dx = x1 + 10;
    cam.forEach(function (o) {
      if (!o.c.emEscala) return;
      var yA = o.y + 1, yB = o.y + o.h - 1;
      svg += '<g class="cx-dim"><path d="M' + (dx - 4) + ' ' + yA.toFixed(1) + 'h8M' + (dx - 4) + ' ' + yB.toFixed(1) + 'h8M' + dx + ' ' + yA.toFixed(1) + 'V' + yB.toFixed(1) + '"/>' +
        '<text x="' + (dx + 8) + '" y="' + (o.y + o.h / 2).toFixed(1) + '" dominant-baseline="middle">' + esc(medida(o.c.espessuraMm, o.c.id)) + '</text></g>';
    });

    // escala gráfica
    var passo = [5, 10, 20, 50, 100].filter(function (mm) { return mm * s >= 36; })[0] || 100;
    var barra = passo * s;
    var yE = H - 16;
    svg += '<g class="cx-scale"><path d="M' + (x0 + 2) + ' ' + (yE - 4) + 'v8M' + (x0 + 2) + ' ' + yE + 'h' + barra.toFixed(1) + 'M' + (x0 + 2 + barra).toFixed(1) + ' ' + (yE - 4) + 'v8"/>' +
      '<text x="' + (x0 + 10 + barra).toFixed(1) + '" y="' + yE + '" dominant-baseline="middle">' + esc(medida(passo) + " na escala do desenho") + '</text></g>';
    svg += '</svg>';

    var mudou = sig !== ultimoCorteSig;
    ultimoCorteSig = sig;
    els.corte.innerHTML = svg;
    if (mudou && !reduce && visivel) {
      $$(".cx-layer", els.corte).forEach(function (g) { g.classList.add("cx-pre"); });
      requestAnimationFrame(function () { requestAnimationFrame(function () { $$(".cx-layer", els.corte).forEach(function (g) { g.classList.remove("cx-pre"); }); }); });
    }

    // nota abaixo do corte
    var notas = [];
    if (a0.estado === "incompleto") notas.push("Informe a área para calcular este ambiente. O corte já mostra as camadas do uso escolhido.");
    if (a.estado === "consulte") notas.push(a.motivo || "Consulte a equipe técnica.");
    if (a.laje) notas.push("A água atravessa a camada Stone Dren e escoa sobre a laje, que precisa de caimento. A laje de concreto armado de " + T.laje.cm + " cm leva malha POP; o concreto não entra no cálculo.");
    if (a.base === "contrapiso") notas.push(a.uso === "garagem" ? "Sobre concreto ou asfalto existente, a base precisa estar firme e com caimento para a água escoar." : "Sobre contrapiso existente, a água atravessa a camada e escoa pelo caimento da base.");
    if (a.aConfirmar) notas.push("Entorno de piscina: consumo de referência a confirmar.");
    if (a.abaixoDoMinimo) notas.push("Espessura abaixo da referência de " + a.espessuraMinimaMm + " mm para este uso.");
    els.corteNota.textContent = nb(notas.join(" "));
  }
  // A camada Stone Dren fica sempre em mm (a unidade do controle); as camadas da base
  // (brita de 10 ou 15 cm, laje de 8 cm) seguem em cm, como nas premissas.
  function medida(mm, id) { return id !== "stone" && mm >= 50 && mm % 10 === 0 ? (mm / 10) + " cm" : mm + " mm"; }

  var rzTimer = 0, larguraCorte = 0;
  if ("ResizeObserver" in window) {
    new ResizeObserver(function () {
      var w = els.corte.clientWidth;
      if (Math.abs(w - larguraCorte) < 2) return;
      larguraCorte = w;
      clearTimeout(rzTimer);
      rzTimer = setTimeout(function () { if (ultimo) renderCorte(ultimo); }, 90);
    }).observe(els.corte);
  } else {
    window.addEventListener("resize", function () { clearTimeout(rzTimer); rzTimer = setTimeout(function () { if (ultimo) renderCorte(ultimo); }, 150); }, { passive: true });
  }

  /* ---------- amostra 3D (frente 3D, carregada sob demanda) ---------- */
  var ctrl3d = null, tentou3d = false, ultimo3d = "";
  function estado3d() {
    if (!ultimo) return null;
    var a0 = ambSelecionado(ultimo);
    if (!a0) return null;
    var a = a0.estado === "incompleto" ? corteDo(a0) : a0;
    var bases = T.perfis[a.uso] ? T.perfis[a.uso].bases : {};
    var cfg = bases[a.base] || {};
    // garagem direto sobre brita (estado "consulte"): a amostra mostra a pedra sobre a brita, sem laje
    if (a.base === "brita") {
      return { cor: state.cor, espessuraMm: a.espessuraMm, base: "solo", britaCm: (bases.solo && bases.solo.britaCm) || 15, malha: false, uso: a.uso };
    }
    return {
      cor: state.cor,
      espessuraMm: a.espessuraMm,
      base: a.base,
      britaCm: a.base === "solo" && cfg.britaCm ? cfg.britaCm : 0,
      malha: !!(a.base === "solo" && cfg.malha),
      uso: a.uso
    };
  }
  function atualizar3d() {
    if (!ctrl3d || typeof ctrl3d.update !== "function") return;
    try {
      var st = estado3d();
      if (!st) return;
      var k = JSON.stringify(st);
      if (k === ultimo3d) return;      // só avisa a cena quando algo mudou de verdade
      ultimo3d = k;
      ctrl3d.update(st);
    } catch (e) { esconder3d(); }
  }
  function esconder3d() {
    if (ctrl3d && typeof ctrl3d.dispose === "function") { try { ctrl3d.dispose(); } catch (e) { /* já liberado */ } }
    ctrl3d = null;
    ultimo3d = "";
    if (els.wrap3d) els.wrap3d.hidden = true;
    root.classList.remove("has-3d");
  }
  // Veredito de WebGL2 por hardware publicado pela frente 3D (scenes.js): window.StoneDren3D.hw
  // (true/false) e o evento "stonedren:webgl-verdict" com detail {hw}. Sem veredito em 2,5 s,
  // com economia de dados ou com hw falso, a amostra fica no corte 2D e nada do 3D é baixado.
  var VEREDITO_MS = 2500;
  function veredito3d(cb) {
    var feito = false, tm = 0;
    function fim(v) {
      if (feito) return;
      feito = true;
      clearTimeout(tm);
      window.removeEventListener("stonedren:webgl-verdict", onV);
      cb(v === true);
    }
    function onV(e) { fim(e && e.detail ? e.detail.hw : false); }
    try { if (navigator.connection && navigator.connection.saveData) { fim(false); return; } } catch (e) { /* segue */ }
    var s3 = window.StoneDren3D;
    if (s3 && (s3.hw === true || s3.hw === false)) { fim(s3.hw); return; }
    window.addEventListener("stonedren:webgl-verdict", onV);
    tm = setTimeout(function () { var s4 = window.StoneDren3D; fim(!!(s4 && s4.hw === true)); }, VEREDITO_MS);
  }
  function carregar3d() {
    if (tentou3d || !els.canvas3d) return;
    tentou3d = true;
    veredito3d(function (hw) {
      root.setAttribute("data-3d", hw ? "hw" : "2d");
      if (hw) importar3d();
    });
  }
  function importar3d() {
    try {
      import("./preview3d.js").then(function (mod) {
        if (!mod || typeof mod.mountPreview !== "function") throw new Error("sem mountPreview");
        els.wrap3d.hidden = false;
        root.classList.add("has-3d");
        // a frente 3D pausa a própria cena fora da tela e com a aba oculta; se perder o contexto WebGL, volta o corte 2D
        return Promise.resolve(mod.mountPreview(els.canvas3d, { reducedMotion: reduce, onLost: function () { esconder3d(); if (ultimo) renderCorte(ultimo); } }));
      }).then(function (c) {
        if (!c || typeof c.update !== "function") throw new Error("controle 3D inválido");
        ctrl3d = c;
        atualizar3d();
        if (ultimo) renderCorte(ultimo);
      }).catch(function () { esconder3d(); if (ultimo) renderCorte(ultimo); });
    } catch (e) { esconder3d(); }
  }

  /* ---------- resumo fixo no celular ---------- */
  // Antes do lead, só a área e os ambientes (nenhuma quantidade no DOM).
  // Área do resumo fixo: acima de 999 m² sem casas decimais, para a unidade nunca ser cortada.
  function areaCurta(m2) { return (m2 >= 1000 ? C.fmt(m2, 0) : C.fmtAuto(m2)) + " m²"; }
  function renderDock(r) {
    if (!els.dock) return;
    var t = r.totais, v, sub;
    if (t) {
      v = areaCurta(t.areaM2);
      if (unlocked) sub = C.qtd(t.pedra.sacos, "saco", "sacos") + " · " + C.qtd(t.resina.kits, "kit", "kits");
      else sub = r.calculados + (r.calculados === 1 ? " ambiente" : " ambientes") + (r.consulte ? " · " + r.consulte + " a consultar" : "");
    } else if (r.consulte) {
      v = areaCurta(r.areaConsulteM2);
      sub = "A consultar";
    } else {
      v = "A informar";
      sub = "Digite a área";
    }
    els.dockV.textContent = nb(v);
    els.dockV.classList.toggle("is-longo", v.length > 9);
    els.dockS.textContent = nb(sub);
  }
  // Enquanto o resumo fixo aparece na tela, <html> leva a classe cx-dock-on (a página esconde
  // o botão flutuante do WhatsApp com ela, e o resumo usa a largura inteira da coluna).
  // A faixa de cima (altura do cabeçalho fixo) não conta: resumo escondido atrás do cabeçalho não está visível.
  if (els.dock && "IntersectionObserver" in window) {
    var topoH = 76;
    try { topoH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 76; } catch (e) { topoH = 76; }
    new IntersectionObserver(function (en) {
      var x = en[en.length - 1];
      document.documentElement.classList.toggle("cx-dock-on", !!(x && x.isIntersecting && x.boundingClientRect.height > 0));
    }, { threshold: 0, rootMargin: "-" + Math.round(topoH) + "px 0px 0px 0px" }).observe(els.dock);
  }
  function dockVisivel() {
    try { return els.dock && window.getComputedStyle(els.dock).display !== "none"; } catch (e) { return false; }
  }
  if (els.dockBtn) {
    els.dockBtn.addEventListener("click", function () {
      try { els.painel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); } catch (e) { els.painel.scrollIntoView(); }
      if (els.painelTitulo) els.painelTitulo.focus({ preventScroll: true });
    });
  }
  // no celular, o campo em foco não pode ficar escondido atrás do resumo fixo
  els.form.addEventListener("focusin", function (e) {
    if (!dockVisivel() || els.dock.contains(e.target)) return;
    var alvo = e.target;
    setTimeout(function () {
      if (document.activeElement !== alvo) return;
      var d = els.dock.getBoundingClientRect(), r = alvo.getBoundingClientRect();
      if (r.bottom > d.top - 8 && r.top < d.bottom) window.scrollBy(0, Math.round(r.bottom - d.top + 16));
    }, 60);
  });

  /* ---------- resumo para leitor de tela ---------- */
  var resumoTimer = 0, resumoUltimo = "";
  function renderResumo(r) {
    clearTimeout(resumoTimer);
    resumoTimer = setTimeout(function () {
      var t = r.totais, txt;
      if (!t && r.consulte) txt = C.fmtAuto(r.areaConsulteM2) + " m² a consultar com a equipe técnica. Esta base não entra no cálculo.";
      else if (!t) txt = "Informe a área de pelo menos um ambiente para calcular.";
      else if (!unlocked) txt = r.calculados + (r.calculados === 1 ? " ambiente, " : " ambientes, ") + C.fmtAuto(t.areaM2) + " m² no total. Preencha o formulário para ver as quantidades.";
      else {
        txt = C.fmtAuto(t.areaM2) + " m²: " + C.qtd(t.pedra.sacos, "saco", "sacos") + " de pedra, " + C.qtd(t.resina.kits, "kit", "kits") + " de resina" +
          (t.brita ? ", " + C.qtd(t.brita.sacos, "saco", "sacos") + " de brita" : "") + (t.malha ? ", " + C.qtd(t.malha.paineis, "painel", "painéis") + " de malha" : "") + ".";
      }
      if (txt !== resumoUltimo) { resumoUltimo = txt; els.resumo.textContent = txt; }
    }, 900);
  }

  /* ---------- portão do lead ---------- */
  var F = {
    nome: $("#cxNome"), whats: $("#cxWhats"), cidade: $("#cxCidade"), optin: $("#cxOptin"),
    errNome: $("#cxNomeErr"), errWhats: $("#cxWhatsErr"), errCidade: $("#cxCidadeErr"), errPerfil: $("#cxPerfilErr"),
    email: $("#cxEmail"), errEmail: $("#cxEmailErr"), isca: $("#cxHp")
  };
  if (modoEmail && F.email) {
    $$("[data-email-only]").forEach(function (el) { el.hidden = false; });
    $$("[data-sem-email]").forEach(function (el) { el.hidden = true; });
    F.email.disabled = false;
    if (modoEmail === "obrigatorio") F.email.required = true;
    else {
      var rotEmail = $('label[for="cxEmail"]');
      if (rotEmail) rotEmail.innerHTML = "E-mail para receber o cálculo (opcional)";
    }
    F.email.addEventListener("input", function () { if (F.email.getAttribute("aria-invalid")) validarLead(false); });
  }

  // Mesmo formato que o servidor aceita. Erros comuns de digitação do domínio viram sugestão.
  var EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;
  var DOMINIO_TROCADO = {
    "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.com.br": "gmail.com",
    "hotmail.con": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmial.com": "hotmail.com",
    "outlook.con": "outlook.com", "outlok.com": "outlook.com", "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com.br", "icloud.con": "icloud.com"
  };
  // Domínios mais comuns no Brasil: um domínio a até 2 letras de um deles (ou igual sem o ".br") vira
  // pergunta, não bloqueio (existe e-mail de verdade em mail.com, bol.com...). Final que não existe
  // como domínio (.con, .comm, .cim, .xom...) bloqueia com a sugestão.
  var DOMINIOS_COMUNS = ["gmail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "msn.com",
    "yahoo.com", "yahoo.com.br", "icloud.com", "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "globo.com"];
  var FINAL_IMPOSSIVEL = /\.(con|comm|cim|xom|vom|cpm|coom|comn|cmo)(\.br)?$/;
  function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    var ant = [], i, j;
    for (j = 0; j <= b.length; j++) ant[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = cur;
    }
    return ant[b.length];
  }
  function avaliarEmail(v) {
    if (!v) return { msg: modoEmail === "obrigatorio" ? "Informe o e-mail para receber o cálculo." : "", suave: false };
    if (v.length > 254 || !EMAIL_RE.test(v) || /\.\.|^\.|\.@|@-/.test(v)) return { msg: "Confira o e-mail, por exemplo nome@gmail.com.", suave: false };
    var dom = v.split("@")[1].toLowerCase();
    if (DOMINIOS_COMUNS.indexOf(dom) >= 0) return { msg: "", suave: false };
    var duro = !!DOMINIO_TROCADO[dom] || FINAL_IMPOSSIVEL.test(dom);
    var sug = DOMINIO_TROCADO[dom] || "";
    if (!sug && FINAL_IMPOSSIVEL.test(dom)) {
      sug = dom.replace(FINAL_IMPOSSIVEL, ".com$2");
      if (DOMINIO_TROCADO[sug]) sug = DOMINIO_TROCADO[sug];
    }
    if (!sug) {
      var melhor = "", dm = 3;
      DOMINIOS_COMUNS.forEach(function (c) { var d = distancia(dom, c); if (d < dm) { dm = d; melhor = c; } });
      sug = melhor || (DOMINIOS_COMUNS.indexOf(dom + ".br") >= 0 ? dom + ".br" : "");
    }
    if (!sug) return { msg: "", suave: false };
    if (duro) return { msg: "Confira o final do e-mail: não seria @" + sug + "?", suave: false };
    return { msg: "Confira o final do e-mail: não seria @" + sug + "? Se o seu e-mail é assim mesmo, toque de novo em “Ver meu cálculo”.", suave: true };
  }
  var emailAvisado = "";
  function mascaraTel(v) {
    var d = String(v).replace(/\D/g, "").slice(0, 13);
    var cc = "";
    if (d.length > 11 && d.indexOf("55") === 0) { cc = "+55 "; d = d.slice(2); }
    if (d.length > 11) return (cc ? "+55 " : "") + d;
    if (!d.length) return cc.trim();
    if (d.length <= 2) return cc + "(" + d;
    var ddd = d.slice(0, 2), rest = d.slice(2);
    if (rest.length <= 4) return cc + "(" + ddd + ") " + rest;
    if (rest.length <= 8) return cc + "(" + ddd + ") " + rest.slice(0, 4) + "-" + rest.slice(4);
    return cc + "(" + ddd + ") " + rest.slice(0, 5) + "-" + rest.slice(5);
  }
  F.whats.addEventListener("input", function () {
    var el = F.whats;
    var noFim = el.selectionStart == null || el.selectionStart >= el.value.length;
    if (noFim) el.value = mascaraTel(el.value);
    if (F.errWhats.classList.contains("on")) validarLead(false);
  });
  F.whats.addEventListener("blur", function () { F.whats.value = mascaraTel(F.whats.value); });
  [F.nome, F.cidade].forEach(function (el) { el.addEventListener("input", function () { if (el.getAttribute("aria-invalid")) validarLead(false); }); });

  function erroCampo(inp, p, msg) {
    p.textContent = msg || "";
    p.classList.toggle("on", !!msg);
    if (inp) { if (msg) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); }
  }
  function perfilEscolhido() {
    var r = els.leadForm.querySelector('input[name="perfil"]:checked');
    return r ? r.value : "";
  }
  function validarLead(focar) {
    var nome = F.nome.value.trim().replace(/\s+/g, " ");
    var dig = F.whats.value.replace(/\D/g, "");
    var cid = F.cidade.value.trim();
    var perfil = perfilEscolhido();
    var email = modoEmail && F.email ? F.email.value.trim() : "";
    var primeiro = null;
    var eN = nome.length < 2 ? "Informe seu nome." : "";
    var eW = !dig.length ? "Informe seu WhatsApp com DDD." : (dig.length < 10 || dig.length > 13 ? "Confira o número: use DDD + número, de 10 a 13 dígitos." : "");
    var eC = cid.length < 2 ? "Informe sua cidade e UF, por exemplo Goiânia/GO." : "";
    var eP = !perfil ? "Escolha uma opção." : "";
    erroCampo(F.nome, F.errNome, eN);
    erroCampo(F.whats, F.errWhats, eW);
    erroCampo(F.cidade, F.errCidade, eC);
    erroCampo(null, F.errPerfil, eP);
    var eE = "";
    if (modoEmail && F.email) {
      var ve = avaliarEmail(email);
      eE = ve.msg;
      // pergunta de domínio parecido: vale uma vez; tocar de novo com o mesmo e-mail confirma
      if (ve.suave) {
        if (email.toLowerCase() === emailAvisado) eE = "";
        else if (focar) emailAvisado = email.toLowerCase();
      }
      erroCampo(F.email, F.errEmail, eE);
    }
    if (eN) primeiro = F.nome; else if (eE) primeiro = F.email; else if (eW) primeiro = F.whats; else if (eC) primeiro = F.cidade; else if (eP) primeiro = els.leadForm.querySelector('input[name="perfil"]');
    if (focar && primeiro) primeiro.focus();
    if (primeiro) return null;
    var dados = { nome: nome, whatsapp: dig, cidadeUf: cid, perfil: perfil };
    if (modoEmail) dados.email = email;
    return dados;
  }
  els.leadForm.addEventListener("change", function (e) {
    if (e.target.name === "perfil") erroCampo(null, F.errPerfil, "");
  });
  els.leadForm.addEventListener("submit", function (e) {
    e.preventDefault();
    els.leadErr.textContent = "";
    clearTimeout(calcTimer);
    atualizar();
    var r = ultimo;
    // vale a obra com algum ambiente calculado OU só com ambientes "consulte a equipe técnica"
    if (!r || (!r.totais && !r.consulte)) {
      state.ambientes.forEach(function (a) { mostrarErros(a, true); });
      els.leadErr.textContent = "Informe a área de pelo menos um ambiente antes de ver o cálculo.";
      var alvo = primeiroCampoComErro();
      if (alvo) alvo.focus();
      return;
    }
    var dados = validarLead(true);
    if (!dados) { els.leadErr.textContent = "Confira os campos marcados."; return; }
    lead = dados;                          // só em memória
    var optin = !!F.optin.checked;
    if (modoEmail) { envio.optin = optin; envio.id = ""; }
    else enviarWebhook(C.montarPayload(lead, obraAtual(), r, optin));
    unlocked = true;
    root.classList.add("is-liberado");
    els.leadSec.hidden = true;
    // modo e-mail: o bloco do envio aparece vazio já agora (a região aria-live precisa existir antes
    // da 1ª mensagem para o leitor de tela anunciar) e é para ele que a tela rola
    if (modoEmail && els.envio) { els.envio.hidden = false; els.envioSt.textContent = ""; }
    atualizar();
    var h = document.getElementById("cxResTitulo");
    var alvoRolagem = modoEmail && els.envio ? els.envio : els.result;
    if (h) {
      try { alvoRolagem.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); } catch (e2) { alvoRolagem.scrollIntoView(); }
      h.focus({ preventScroll: true });
    }
    if (modoEmail) setTimeout(function () { enviarCalculo(true); }, 60);
  });

  // primeiro campo de área (ou medida) com erro, na ordem dos cartões
  function primeiroCampoComErro() {
    for (var i = 0; i < state.ambientes.length; i++) {
      var a = state.ambientes[i];
      var v = C.validarAmbiente(a);
      if (v.ok) continue;
      var li = cardEl(a.id);
      var campos = a.modo === "medidas" ? ["comprimento", "largura"] : ["area"];
      for (var k = 0; k < campos.length; k++) if (v.erros[campos[k]]) return li && $('[data-f="' + campos[k] + '"]', li);
    }
    var li0 = cardEl(state.ambientes[0].id);
    return li0 && $(state.ambientes[0].modo === "medidas" ? '[data-f="comprimento"]' : '[data-f="area"]', li0);
  }

  function enviarWebhook(payload) {
    var url = SD.site && SD.site.leadWebhookUrl;
    if (!url) return;
    try {
      fetch(url, {
        method: "POST", mode: "no-cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }).catch(function () { /* o WhatsApp segue como canal principal */ });
    } catch (e) { /* idem */ }
  }

  /* ---------- envio do cálculo por e-mail ----------
   * A página manda a obra CRUA (o que foi digitado) e o lead; o servidor (Google Apps Script)
   * refaz a conta com este mesmo calc.js, monta o e-mail com o email-calc.js e envia para a
   * pessoa, com uma cópia para o comercial. Cada pedido leva um id: se a primeira tentativa
   * cair no meio, a segunda usa o mesmo id e o servidor não manda duas vezes.
   * Sem URL configurada (emailWebhookUrl vazio), a página só mostra a prévia do e-mail. */
  var envio = { id: "", optin: false, seq: 0, estado: "", assinatura: "" };
  function novoIdEnvio() {
    var b = new Uint8Array(12), i;
    try { window.crypto.getRandomValues(b); } catch (e) { for (i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
    var h = "";
    for (i = 0; i < b.length; i++) h += ("0" + b[i].toString(16)).slice(-2);
    return h;
  }
  function urlEnvio() {
    var u = String((SD.site && SD.site.emailWebhookUrl) || "").trim();
    // só aceita a URL de um app da Web do Google Apps Script (conta pessoal ou Workspace)
    return /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+\/|macros\/)s\/[A-Za-z0-9_-]+\/exec$/.test(u) ? u : "";
  }
  function statusEnvio(st, html, reenviar) {
    envio.estado = st;
    if (!els.envio) return;
    els.envio.hidden = false;
    els.envio.setAttribute("data-st", st);
    els.envioSt.innerHTML = html;
    if (els.reenviar) els.reenviar.hidden = !reenviar;
  }
  function opcoesEmail() {
    var site = SD.site || {};
    var base = "";
    try { base = new URL(".", location.href).href; } catch (e) { base = ""; }
    return { teste: paginaTeste, whatsapp: site.whatsappComercial, empresa: site.empresa || {}, siteUrl: /^https:/.test(base) ? base : "" };
  }
  function atualizarPrevia(r) {
    var E = window.StoneDrenEmail;
    if (!els.previa || !els.previaFrame || !E || !lead || !r) return;
    var m;
    try { m = E.montarEmailCliente(r, lead, opcoesEmail()); } catch (e) { m = null; }
    if (!m) { els.previa.hidden = true; return; }
    els.previa.hidden = false;
    els.previaNota.textContent = "Assunto: " + m.assunto + ". Na prévia os links não abrem; no e-mail de verdade, abrem.";
    els.previaFrame.setAttribute("srcdoc", m.html);
  }
  if (els.previa) els.previa.addEventListener("toggle", function () { if (els.previa.open && unlocked) atualizarPrevia(ultimo); });
  if (els.reenviar) els.reenviar.addEventListener("click", function () { enviarCalculo(true); });

  function enviarCalculo(novo) {
    var r = ultimo;
    if (!modoEmail || !lead || !r || (!r.totais && !r.consulte)) return;
    var email = lead.email || "";
    var paraQuem = email ? "<b>" + esc(email) + "</b>" : "o comercial";
    atualizarPrevia(r);
    var url = urlEnvio();
    if (!url) {
      statusEnvio("previa", "O envio por e-mail ainda não foi ativado nesta página. Quando estiver ativo, o cálculo chega em " + paraQuem +
        (email ? ", com uma cópia para o comercial" : "") + ". Abaixo, a prévia de como o e-mail vai chegar.", false);
      if (els.previa) els.previa.open = true;
      return;
    }
    var payload = C.montarPayload(lead, obraAtual(), r, envio.optin, {
      email: email, id: "", teste: paginaTeste, hp: F.isca ? F.isca.value : "",
      pagina: String(location.pathname || "").split("/").pop() || "index.html"
    });
    // "Enviar de novo" depois de um envio NÃO confirmado, com a mesma obra e o mesmo contato, repete o
    // id: se o primeiro já tiver chegado, o servidor não manda outro par de e-mails (nem gasta a cota)
    var assinatura = JSON.stringify(Object.assign({}, payload, { enviadoEm: "" }));
    var reaproveita = novo && envio.id && envio.estado !== "ok" && envio.assinatura === assinatura;
    if ((novo && !reaproveita) || !envio.id) envio.id = novoIdEnvio();
    envio.assinatura = assinatura;
    payload.id = envio.id;
    var corpo = JSON.stringify(payload);
    var seq = ++envio.seq;
    statusEnvio("enviando", "Enviando o cálculo para " + paraQuem + ".", false);
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var relogio = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
    var opts = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: corpo, redirect: "follow", credentials: "omit" };
    if (ctrl) opts.signal = ctrl.signal;
    var p;
    try { p = fetch(url, opts); } catch (e) { p = Promise.reject(e); }
    p.then(function (res) {
      return res.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { http: res.status, j: j }; });
    }).then(function (x) {
      clearTimeout(relogio);
      if (seq === envio.seq) respostaEnvio(x, paraQuem);
    }).catch(function (err) {
      clearTimeout(relogio);
      if (seq !== envio.seq) return;
      // demorou demais: pergunta ao servidor o que aconteceu com este id antes de dizer qualquer coisa
      if (err && err.name === "AbortError") { confirmarPorId(url, seq, paraQuem, true); return; }
      // sem resposta legível (rede ou bloqueio do navegador): uma segunda tentativa que não lê a resposta,
      // com o MESMO id (se a primeira tiver chegado, o servidor não repete o envio). Essa tentativa
      // "dá certo" até quando o Google devolve uma página de login ou de erro; por isso a página
      // pergunta logo depois ao servidor (GET ?id=) o que ele fez com ESTE pedido.
      var o2 = { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: corpo, credentials: "omit" };
      if (corpo.length < 60000) o2.keepalive = true;
      // a 2ª tentativa também tem prazo: sem ele, um pedido pendurado deixaria a página em "Enviando" para sempre.
      // Se o prazo estourar, o pedido pode ter chegado: a conferência decide entre "provável" e erro.
      var ctrl2 = typeof AbortController === "function" ? new AbortController() : null;
      var relogio2 = setTimeout(function () { if (ctrl2) ctrl2.abort(); }, 15000);
      if (ctrl2) o2.signal = ctrl2.signal;
      var p2;
      try { p2 = fetch(url, o2); } catch (e2) { p2 = Promise.reject(e2); }
      p2.then(function () {
        clearTimeout(relogio2);
        confirmarPorId(url, seq, paraQuem, false);
      }, function (e3) {
        clearTimeout(relogio2);
        if (e3 && e3.name === "AbortError") confirmarPorId(url, seq, paraQuem, true);
        else if (seq === envio.seq) naoConfirmado(false);
      });
    });
  }
  // conferência (GET): o doGet responde se está no ar e, com ?id=, o que aconteceu com o pedido
  // (envio: {ok, cliente, copia} | {ok:false, erro} | null quando o servidor não viu esse id)
  function conferirServico(url, id) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var relogio = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    var o = { method: "GET", credentials: "omit" };
    if (ctrl) o.signal = ctrl.signal;
    var p;
    try { p = fetch(url + (id ? "?id=" + encodeURIComponent(id) : ""), o); } catch (e) { p = Promise.reject(e); }
    return p.then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(relogio);
      if (!(j && j.servico === "stone-dren-email")) return null;
      return { ligado: !!j.ligado, envio: j.envio };
    }, function () { clearTimeout(relogio); return null; });
  }
  function naoConfirmado(pendente) {
    if (pendente) statusEnvio("provavel", "O servidor demorou para responder. O e-mail ainda pode chegar em alguns minutos; confira também a caixa de spam. Se não chegar, envie de novo.", true);
    else statusEnvio("erro", "Não deu para confirmar o envio. Confira a conexão e envie de novo. A lista continua na tela e também pode ir pelo WhatsApp.", true);
  }
  // sem resposta legível: a mensagem sai do que o servidor diz sobre ESTE id, nunca de um palpite
  function confirmarPorId(url, seq, paraQuem, pendente) {
    conferirServico(url, envio.id).then(function (c) {
      if (seq !== envio.seq) return;
      if (!c) { naoConfirmado(pendente); return; }
      if (c.envio && typeof c.envio === "object") { respostaEnvio({ http: 200, j: c.envio }, paraQuem); return; }
      if (c.envio === null) { naoConfirmado(pendente); return; }
      // servidor de versão antiga, sem ?id=: só dá para saber se está no ar
      if (!c.ligado) { respostaEnvio({ http: 200, j: { ok: false, erro: "desligado" } }, paraQuem); return; }
      statusEnvio("provavel", "Pedido enviado para " + paraQuem + ". Confira a caixa de entrada e também o spam nos próximos minutos.", true);
    });
  }
  function respostaEnvio(x, paraQuem) {
    var j = x && x.j;
    if (j && j.ok) {
      var copia = j.copia ? (lead.email ? " e uma cópia foi para o comercial" : "") : "";
      var dest = lead.email ? "O cálculo foi enviado para " + paraQuem + copia + "." : "O cálculo foi enviado para o comercial.";
      statusEnvio("ok", "Pronto. " + dest + (lead.email ? " Se não aparecer em alguns minutos, confira a caixa de spam." : ""), true);
      return;
    }
    var cod = j && j.erro ? String(j.erro) : "";
    if (cod === "email") {
      statusEnvio("erro", "O servidor não aceitou este e-mail. Corrija o endereço no formulário e peça de novo.", false);
      els.leadSec.hidden = false;
      erroCampo(F.email, F.errEmail, "Confira o e-mail, por exemplo nome@gmail.com.");
      try { els.leadSec.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); } catch (e) { /* segue */ }
      if (F.email) F.email.focus({ preventScroll: true });
      return;
    }
    if (cod === "limite") { statusEnvio("erro", "Muitos envios seguidos para este e-mail. Tente de novo daqui a uma hora ou mande a lista pelo WhatsApp.", false); return; }
    if (cod === "cota") { statusEnvio("erro", "Os envios de hoje acabaram. Amanhã volta a funcionar; por enquanto, mande a lista pelo WhatsApp.", false); return; }
    if (cod === "hora") { statusEnvio("erro", "Muitos pedidos neste momento. Tente de novo em até uma hora ou mande a lista pelo WhatsApp.", false); return; }
    if (cod === "ocupado") { statusEnvio("erro", "O servidor está ocupado agora. Toque em enviar de novo em alguns segundos.", true); return; }
    if (cod === "invalido") { statusEnvio("erro", "O servidor não aceitou os dados do formulário. Confira nome, WhatsApp e cidade (por exemplo Goiânia/GO) e envie de novo, ou mande a lista pelo WhatsApp.", true); return; }
    if (cod === "desligado") { statusEnvio("erro", "O envio por e-mail está desligado no momento. Mande a lista pelo WhatsApp.", false); return; }
    statusEnvio("erro", "O servidor não conseguiu enviar" + (cod ? " (" + esc(cod) + ")" : (x && x.http ? " (resposta " + x.http + ")" : "")) + ". Envie de novo em instantes.", true);
  }

  /* ---------- resultado ---------- */
  function renderResultado(r) {
    var t = r.totais;
    var sec = els.result;
    sec.hidden = false;
    if (!t && !r.consulte) {
      sec.innerHTML = '<div class="cx-res-head"><div><p class="eyebrow">Resultado</p><h3 id="cxResTitulo" tabindex="-1">Seu cálculo</h3></div></div><p class="cx-res-vazio">Informe a área de pelo menos um ambiente para ver as quantidades.</p>' + acoesHTML(false);
      ligarAcoes(r);
      return;
    }
    var av = C.aviso(r);
    var corNome = r.corRotulo.toLowerCase();
    var html = '';
    var sub = t ? C.fmtAuto(t.areaM2) + " m² · " + r.calculados + (r.calculados === 1 ? " ambiente" : " ambientes") + " · resina " + t.resina.curto + " · pedra " + corNome
      : C.fmtAuto(r.areaConsulteM2) + " m² · " + r.consulte + (r.consulte === 1 ? " ambiente" : " ambientes") + " a consultar com a equipe técnica";
    html += '<div class="cx-print-head"><b>Stone Dren</b> · Estimativa de materiais · ' + esc(new Date().toLocaleDateString("pt-BR")) + '</div>';
    html += '<div class="cx-res-head"><div><p class="eyebrow">Resultado</p><h3 id="cxResTitulo" tabindex="-1">Seu cálculo</h3>' +
      '<p class="cx-res-sub">' + esc(sub) + '</p></div>' +
      '<p class="cx-aviso-curto">' + ICON.info + '<span>' + esc(C.AVISO_CURTO) + '</span></p></div>';

    html += '<div class="cx-res-grid"><ul class="cx-mats">';
    if (t) html += materiaisHTML(r, t, corNome);
    if (r.consulte) html += matHTML(ICON.laje, "Ambientes a consultar", "Garagem direto sobre brita não entra nesta versão do cálculo. A equipe técnica indica a base e as quantidades.", "Consulte a equipe", C.fmtAuto(r.areaConsulteM2) + " m² fora do cálculo", "na");
    html += '</ul>';
    // recomendados só quando fazem sentido para a obra (manta com solo, primer com contrapiso)
    var rec = C.recomendadosDaObra(r);
    var pend = t && t.aConfirmar ? '<p class="cx-pend">Entorno de piscina: consumo de referência a confirmar.</p>' : '';
    if (rec.length || pend) {
      html += '<div class="cx-recom">' + (rec.length ? '<p class="cx-lbl">Recomendado, não incluso</p><ul>' + rec.map(function (x) { return '<li><b>' + esc(x.rotulo) + '</b> ' + esc(x.texto) + '</li>'; }).join("") + '</ul>' : '') + pend + '</div>';
    }
    html += '</div>';

    // por ambiente
    html += '<div class="cx-det"><h4 class="cx-lbl">Por ambiente</h4><div class="cx-det-grid">';
    r.ambientes.forEach(function (a, i) {
      if (a.estado === "incompleto") return;
      html += '<article class="cx-det-c"><h5>' + esc(C.nomeAmbiente(a, i)) + '</h5><p class="cx-det-m">' + esc(a.usoRotulo + " · " + a.baseRotulo.toLowerCase() + " · " + C.fmtAuto(a.areaM2) + " m² · " + C.fmtMm(a.espessuraMm)) + '</p>';
      if (a.estado === "consulte") html += '<p class="cx-det-st">' + esc(a.motivo) + '</p>';
      else {
        html += '<dl>' +
          dl("Pedra", C.fmtKg(a.pedra.kg) + " · " + C.qtd(a.pedra.sacos, "saco", "sacos")) +
          dl("Resina", C.fmtKg(a.resina.kg) + " · " + C.fmtAuto(a.resina.pct * 100) + "% da pedra") +
          (a.brita ? dl("Brita " + a.brita.cm + " cm", C.fmtKg(a.brita.kg) + " · " + C.fmtM3(a.brita.m3)) : dl("Brita", "Não se aplica")) +
          (a.malha ? dl("Malha POP", C.qtd(a.malha.paineis, "painel", "painéis")) : "") +
          (a.laje ? dl("Laje " + T.laje.cm + " cm", "Não calculada") : "") +
          '</dl>';
        if (a.abaixoDoMinimo) html += '<p class="cx-det-st">Espessura abaixo da referência de ' + a.espessuraMinimaMm + ' mm.</p>';
        if (a.aConfirmar) html += '<p class="cx-det-st">Consumo de referência a confirmar.</p>';
      }
      html += '</article>';
    });
    html += '</div>' + (t ? '<p class="cx-det-nota">Na lista de materiais, as embalagens são arredondadas sobre o total da obra. Por ambiente, cada um arredonda os próprios sacos.</p>' : '') + '</div>';

    // aviso completo
    html += '<div class="cx-aviso"><h4 class="cx-lbl">Premissas e aviso</h4><p>' + esc(av.paragrafos[0]) + '</p>';
    if (av.premissas.length) html += '<ul>' + av.premissas.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join("") + '</ul>';
    if (av.base) html += '<p class="cx-aviso-base">' + esc(av.base) + '</p>';
    html += '<p>' + esc(av.paragrafos[1]) + '</p></div>';
    html += '<p class="cx-quim">' + esc(C.SEGURANCA) + '</p>';
    html += acoesHTML(true);
    sec.innerHTML = html;
    ligarAcoes(r);
  }
  function materiaisHTML(r, t, corNome) {
    var html = "";
    html += matHTML('<img src="img/pedra-' + r.cor + '.jpg" alt="" width="44" height="44">', "Pedra natural " + corNome, "Sacos de " + t.pedra.sacoKg + " kg (peso do saco a confirmar) · perda de " + C.fmtAuto(T.pedra.perda * 100) + "% incluída", C.qtd(t.pedra.sacos, "saco", "sacos"), C.fmtKg(t.pedra.kg), "pedra");
    html += matHTML(ICON.resina, "Resina " + t.resina.curto + " + endurecedor", capital(T.resina.kitPremissa) + ".", C.qtd(t.resina.kits, "kit", "kits"), C.fmtKg(t.resina.kg) + " de resina já misturada com o endurecedor", "resina");
    if (t.brita) {
      html += matHTML(ICON.brita, "Brita para a base", "Base sobre solo · sacos de " + t.brita.sacoKg + " kg", C.qtd(t.brita.sacos, "saco", "sacos"), C.fmtKg(t.brita.kg) + " · " + C.fmtM3(t.brita.m3) + " de brita solta", "brita",
        t.brita.granel ? "Acima de " + T.brita.granelAcimaM3 + " m³, vale comprar a granel: " + C.fmtM3(t.brita.m3) + " de brita solta." : "");
    } else {
      html += matHTML(ICON.brita, "Brita para a base", "Só entra quando a base é o solo.", "Não se aplica", "Nenhum ambiente sobre solo", "na");
    }
    if (t.malha) html += matHTML(ICON.malha, "Malha POP " + t.malha.painelRotulo, capital(T.malha.premissa) + ".", C.qtd(t.malha.paineis, "painel", "painéis"), "Para " + C.fmtAuto(t.malha.areaM2) + " m² de laje", "malha");
    if (t.laje) html += matHTML(ICON.laje, "Laje de concreto armado de " + T.laje.cm + " cm", "Garagem sobre solo. O concreto depende do projeto da base.", "Não calculada", "Consulte a equipe técnica", "na");
    return html;
  }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function dl(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  function matHTML(ic, nome, sub, q, q2, tipo, extra) {
    return '<li class="cx-mat cx-mat-' + tipo + '"><span class="cx-mat-ic' + (/^<img/.test(ic) ? " is-foto" : "") + '">' + ic + '</span>' +
      '<div class="cx-mat-t"><b>' + esc(nome) + '</b><small>' + esc(sub) + '</small>' + (extra ? '<span class="cx-granel">' + esc(extra) + '</span>' : '') + '</div>' +
      '<p class="cx-mat-q"><strong>' + esc(q) + '</strong><small>' + esc(q2) + '</small></p></li>';
  }
  function acoesHTML(completo) {
    return '<div class="cx-acts">' +
      (completo ? '<a class="btn btn-gold" id="cxWa" href="#" target="_blank" rel="noopener">' + ICON.zap + '<span>Enviar para o comercial</span></a>' +
      '<button type="button" class="btn btn-ghost" data-res="print">' + ICON.print + '<span>Imprimir ou salvar PDF</span></button>' +
      '<button type="button" class="btn btn-ghost" data-res="copy">' + ICON.copy + '<span>Copiar lista</span></button>' : '') +
      '<button type="button" class="btn btn-ghost" data-res="edit">' + ICON.edit + '<span>Editar obra</span></button>' +
      '</div><p class="cx-acts-st" role="status" aria-live="polite"></p>';
  }
  function ligarAcoes(r) {
    var wa = document.getElementById("cxWa");
    if (wa && typeof SD.waLink === "function") wa.setAttribute("href", SD.waLink(C.mensagemWhatsApp(r)));
  }
  els.result.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-res]");
    if (!b) return;
    var act = b.getAttribute("data-res");
    var st = els.result.querySelector(".cx-acts-st");
    if (act === "print") imprimir();
    else if (act === "copy") copiar(C.textoLista(ultimo), st);
    else if (act === "edit") {
      var a = state.ambientes[0];
      var li = a && cardEl(a.id);
      try { els.form.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); } catch (e2) { els.form.scrollIntoView(); }
      var alvo = li && $(a.modo === "medidas" ? '[data-f="comprimento"]' : '[data-f="area"]', li);
      if (alvo) alvo.focus({ preventScroll: true });
    }
  });

  // A classe cx-printing só sai no afterprint. Em celular, window.print() não
  // bloqueia: a prévia é gerada depois que a função volta, então nenhum relógio
  // cego pode tirar a classe antes disso. A rede de segurança só vale depois que
  // a mídia de impressão entrou e saiu (matchMedia), para o caso raro de o
  // navegador não disparar afterprint. Fora da impressão a classe não muda nada.
  var printAtual = null;
  function imprimir() {
    var html = document.documentElement;
    if (printAtual) printAtual();
    var mq = null, entrou = false, rede = 0, feito = false;
    try { mq = window.matchMedia ? window.matchMedia("print") : null; } catch (e) { mq = null; }
    var onMq = function (e) {
      if (e.matches) { entrou = true; clearTimeout(rede); }
      else if (entrou) { clearTimeout(rede); rede = setTimeout(limpar, 1000); }
    };
    var limpar = function () {
      if (feito) return;
      feito = true;
      clearTimeout(rede);
      html.classList.remove("cx-printing");
      window.removeEventListener("afterprint", limpar);
      if (mq) { if (mq.removeEventListener) mq.removeEventListener("change", onMq); else if (mq.removeListener) mq.removeListener(onMq); }
      if (printAtual === limpar) printAtual = null;
    };
    printAtual = limpar;
    html.classList.add("cx-printing");
    window.addEventListener("afterprint", limpar);
    if (mq) { if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq); }
    try { window.print(); } catch (e) { limpar(); }
  }

  function copiar(texto, st) {
    var ok = function () { if (st) { st.textContent = "Lista copiada. Cole no WhatsApp, no e-mail ou onde preferir."; } };
    var falha = function () { if (st) st.textContent = "Não deu para copiar automaticamente. Use Imprimir ou salvar PDF."; };
    var fallback = function () {
      try {
        var ta = document.createElement("textarea");
        ta.value = texto;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.top = "0"; ta.style.left = "0"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var r = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta);
        if (r) ok(); else falha();
      } catch (e) { falha(); }
    };
    try {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(ok, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  /* ---------- dados da empresa no aviso de privacidade ---------- */
  function preencherEmpresa() {
    var emp = (SD.site && SD.site.empresa) || {};
    $$("[data-cfg]").forEach(function (el) {
      var v = emp[el.getAttribute("data-cfg")];
      if (v == null) return;
      el.textContent = v;
      el.classList.toggle("pending", /^\[.*\]$/.test(String(v)));
    });
  }

  /* ---------- visibilidade: pausa animações fora da tela e com a aba oculta ---------- */
  function setPausa() { root.classList.toggle("cx-off", !visivel || document.hidden); }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) {
      en.forEach(function (x) {
        visivel = x.isIntersecting;
        if (visivel) {
          carregar3d();
          if (!animouEntrada) {
            animouEntrada = true;
            $$(".cx-pre").forEach(function (el) { requestAnimationFrame(function () { el.classList.remove("cx-pre"); }); });
          }
        }
        setPausa();
      });
    }, { rootMargin: "120px 0px" }).observe(root);
  } else { visivel = true; animouEntrada = true; carregar3d(); }
  document.addEventListener("visibilitychange", setPausa);

  /* ---------- início ---------- */
  if (!carregar()) state.ambientes = [novoAmbiente()];
  state.selecionado = state.ambientes[0].id;
  $$('input[name="cxResina"]', els.form).forEach(function (r) { r.checked = r.value === state.resina; });
  $$('input[name="cxCor"]', els.form).forEach(function (r) { r.checked = r.value === state.cor; });
  preencherEmpresa();
  renderLista();
  if (reduce) root.classList.add("cx-reduce");
  atualizar();
  setPausa();

  // gancho mínimo para a frente 3D e para testes (sem dado pessoal)
  window.StoneDrenCalcUI = {
    obra: function () { return JSON.parse(JSON.stringify(obraAtual())); },
    resultado: function () { return unlocked ? ultimo : null; },
    liberado: function () { return unlocked; }
  };
})();
