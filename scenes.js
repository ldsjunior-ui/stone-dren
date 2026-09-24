/* Stone Dren · cenas 3D da página (Three.js r180, carregado só depois do primeiro paint).
 *
 * 1) HERO (#hero3d): piso drenante de pedra natural com resina em perspectiva baixa, luz de
 *    fim de tarde. A chuva cai em traços finos, cada gota abre um anel curto e deixa um brilho
 *    molhado que some rápido, porque a água atravessa a camada em vez de empoçar.
 *    Pronto: <html class="has-hero3d"> + evento "stonedren:hero3d-ready" (o hero.js 2D se desliga).
 * 2) CORTE EXPLODIDO (#layers3d em figure#layersFig): maquete das camadas que se separam ao
 *    entrar na tela, com a água descendo pelos vazios. Pronto: figure.is-3d (o SVG vira reserva).
 *
 * Regras: init preguiçoso perto da tela, pausa fora da tela e com a aba oculta, DPR limitado,
 * resolução adaptativa, dispose, perda de contexto WebGL tratada. Com prefers-reduced-motion
 * cada cena desenha um único quadro parado, também se a preferência mudar com a página aberta (o loop
 * para; ao desligar, volta). Se algo falhar, os fallbacks da página continuam.
 *
 * Desempenho: só WebGL2 por hardware (software fica no 2D, sem nem baixar o three); o veredito sai cedo
 * em window.StoneDren3D.hw e no evento "stonedren:webgl-verdict" (a calculadora usa antes de importar
 * a amostra 3D). O hero mede ~45 quadros com o canvas ainda invisível antes de aparecer; o corte e a amostra da calculadora
 * medem os primeiros quadros já visíveis. GPU lenta: a cena sai e o 2D fica ou volta. A montagem
 * é dividida em quadros (sem tarefa longa) e o corte só começa depois que o hero terminou. A montagem
 * do hero espera a entrada do texto (effects.js, "stonedren:intro-done", teto de 1,6 s); durante a
 * entrada só a rede trabalha (three e fotos baixam sem ser avaliados).
 * Eventos: "stonedren:hero3d-ready" (hero apareceu) e "stonedren:hero3d-lost" (hero saiu depois
 * de ter aparecido: perda de contexto ou lentidão; a foto volta pelo CSS).
 */

var W = window;
var docEl = document.documentElement;
var saveData = !!(navigator.connection && navigator.connection.saveData);
var stats = (W.StoneDren3D = W.StoneDren3D || {});

/* Movimento reduzido também ao vivo: se a pessoa liga "reduzir movimento" com a página aberta, cada
 * cena para o loop e fica num quadro parado; se desliga, o loop volta (motionSubs). */
var reduceMQ = W.matchMedia ? W.matchMedia("(prefers-reduced-motion: reduce)") : null;
var reduce = !!(reduceMQ && reduceMQ.matches);
var motionSubs = [];
function onMotionPref(e) {
  var r = !!e.matches;
  if (r === reduce) return;
  reduce = r;
  motionSubs.slice().forEach(function (fn) { try { fn(r); } catch (er) {} });
}
if (reduceMQ) {
  if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", onMotionPref);
  else if (reduceMQ.addListener) reduceMQ.addListener(onMotionPref);
}
function onMotion(fn) {
  motionSubs.push(fn);
  return function () { var i = motionSubs.indexOf(fn); if (i >= 0) motionSubs.splice(i, 1); };
}

var libs = null;
function loadLibs() {
  if (!libs) libs = Promise.all([import("three"), import("./stone3d.js")]);
  return libs;
}

function onIdle(fn) {
  if ("requestIdleCallback" in W) W.requestIdleCallback(fn, { timeout: 1600 });
  else setTimeout(fn, 300);
}
function afterLoad(fn) {
  if (document.readyState === "complete") onIdle(fn);
  else W.addEventListener("load", function () { onIdle(fn); }, { once: true });
}
function whenNear(el, margin, fn) {
  if (!("IntersectionObserver" in W)) { fn(); return; }
  var io = new IntersectionObserver(function (en) {
    if (en.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}

/* Entrada do hero (effects.js): o texto sobe por ~1 s e o effects avisa com "stonedren:intro-done"
 * (e html.fx-intro-done, e StoneDrenFx.introDone()). Com movimento reduzido ou entrada pulada o aviso
 * sai na hora. A montagem pesada do hero espera esse aviso para a tarefa longa não travar a entrada;
 * se o aviso não vier, segue depois de maxMs. Sem o effects.js na página não existe entrada: segue já. */
function introDone() {
  var fx = W.StoneDrenFx;
  return docEl.classList.contains("fx-intro-done") || !!(fx && typeof fx.introDone === "function" && fx.introDone());
}
function introGate(maxMs) {
  var t = performance.now();
  return new Promise(function (resolve) {
    if (introDone()) { resolve({ by: "done", ms: 0 }); return; }
    if (!W.StoneDrenFx && document.readyState === "complete") { resolve({ by: "no-fx", ms: 0 }); return; }
    var timer = 0;
    function go(by) {
      W.removeEventListener("stonedren:intro-done", onDone);
      clearTimeout(timer);
      resolve({ by: by, ms: Math.round(performance.now() - t) });
    }
    function onDone() { go("event"); }
    W.addEventListener("stonedren:intro-done", onDone);
    timer = setTimeout(function () { go(introDone() ? "event" : "timeout"); }, maxMs);
  });
}
/* Enquanto a entrada roda, só a rede trabalha: baixa o three, o stone3d.js e as fotos das pedras sem
 * avaliar nem decodificar nada. Depois do aviso a montagem começa sem esperar download. */
var warmed = false;
function warmHero() {
  if (warmed) return;
  warmed = true;
  try {
    var urls = [new URL("./stone3d.js", import.meta.url).href];
    var res = typeof import.meta.resolve === "function" ? function (s) { return import.meta.resolve(s); } : null;
    // o three r180 do vendor/ é dividido em dois arquivos (o módulo importa o core ao lado dele);
    // o stone3d.js ainda importa um utilitário dos addons
    if (res) {
      var three = res("three");
      urls.push(three, new URL("./three.core.min.js", three).href, res("three/addons/utils/BufferGeometryUtils.js"));
    }
    urls.forEach(function (u) {
      fetch(u, { priority: "low" }).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () {});
    });
    ["palha", "ouro", "branca"].forEach(function (c) {
      var im = new Image();
      im.decoding = "async";
      im.src = new URL("./img/pedra-" + c + ".jpg", import.meta.url).href;
    });
  } catch (e) {}
}

/* Só WebGL2 por hardware. Software (SwiftShader, llvmpipe, WARP) deixa a página a 3 quadros por
 * segundo: nesses casos nem baixa o three e a versão 2D fica. Testes: window.STONE_DREN_3D.allowSoftware. */
function hasWebGL2() {
  try {
    var soft = !!(W.STONE_DREN_3D && W.STONE_DREN_3D.allowSoftware);
    var c = document.createElement("canvas"), gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: !soft });
    if (!gl) return false;
    var ok = true;
    if (!soft) {
      var info = gl.getExtension("WEBGL_debug_renderer_info");
      var name = String((info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || "");
      ok = !SOFT_GL.test(name);
    }
    var ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
    return ok;
  } catch (e) { return false; }
}

/* Veredito de WebGL2 por hardware. A sonda começa já na avaliação do módulo (mesmo que o hero ainda
 * espere a entrada do texto), num worker com OffscreenCanvas: o primeiro contexto da página é o caro
 * (sobe o canal com a GPU) e, com WebGL por software, trava a thread por segundos (medido: 6,6 s no
 * SwiftShader na thread principal; no worker a página segue livre). Com GPU real o worker responde em
 * ~20 a 45 ms e uma conferência rápida na thread principal (~5 ms, o canal já está de pé) confirma que a
 * página também cria o contexto. Sem worker/OffscreenCanvas, se o worker não conseguir contexto
 * (navegador sem WebGL em worker), a sonda roda direto na thread principal. Com allowSoftware (testes) o
 * worker aceita o SwiftShader e a página confere do mesmo jeito.
 * A calculadora lê o veredito antes de importar a amostra 3D (preview3d.js) e o stone3d.js reaproveita
 * o mesmo valor, sem criar outro contexto:
 *   window.StoneDren3D.hw        true: WebGL2 por hardware; false: sem WebGL2, só software ou economia
 *                                de dados; undefined: sonda ainda rodando (espere o evento)
 *   window.StoneDren3D.saveData  true quando navigator.connection.saveData está ligado (aí nem sonda: hw = false)
 *   evento "stonedren:webgl-verdict" na window, detail { hw, saveData } (uma vez; quem chegar depois lê o campo) */
var SOFT_GL = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;
var PROBE_SRC = "onmessage=function(e){var r={gl:false};try{var c=new OffscreenCanvas(1,1),gl=c.getContext('webgl2',{failIfMajorPerformanceCaveat:!e.data.soft});" +
  "if(gl){r.gl=true;var i=gl.getExtension('WEBGL_debug_renderer_info');r.name=String((i?gl.getParameter(i.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER))||'');" +
  "var x=gl.getExtension('WEBGL_lose_context');if(x)x.loseContext();}}catch(er){r.err=String(er&&er.message||er);}postMessage(r);};";
var verdictDone = null;
var verdictP = new Promise(function (r) { verdictDone = r; });
(function verdict() {
  var t = performance.now(), sent = false;
  var soft = !!(W.STONE_DREN_3D && W.STONE_DREN_3D.allowSoftware);
  function publish(hw, via) {
    if (sent) return;
    sent = true;
    stats.hw = hw;
    stats.saveData = saveData;
    stats.probeVia = via;
    stats.probeMs = Math.round((performance.now() - t) * 10) / 10;
    try { W.dispatchEvent(new CustomEvent("stonedren:webgl-verdict", { detail: { hw: hw, saveData: saveData } })); } catch (e) {}
    verdictDone(hw);
  }
  function onMain(via) {
    var m = performance.now(), ok = hasWebGL2();
    stats.probeMainMs = Math.round((performance.now() - m) * 10) / 10;
    publish(ok, via);
  }
  if (saveData) { publish(false, "saveData"); return; }
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined" || !W.Blob || !W.URL || !URL.createObjectURL) { onMain("main"); return; }
  var url = null, wk = null, timer = 0;
  function finish() {
    clearTimeout(timer);
    try { wk.terminate(); } catch (e) {}
    try { URL.revokeObjectURL(url); } catch (e) {}
  }
  try {
    url = URL.createObjectURL(new Blob([PROBE_SRC], { type: "text/javascript" }));
    wk = new Worker(url);
    wk.onmessage = function (e) {
      finish();
      var r = e.data || {};
      // sem contexto no worker pode ser só falta de WebGL em worker: confere na thread principal
      // (sem WebGL de verdade essa conferência volta na hora)
      if (!r.gl) { onMain("main-after-worker"); return; }
      // software no worker: fica no 2D sem tocar na thread principal; hardware: confere na página
      if (!soft && SOFT_GL.test(r.name || "")) { publish(false, "worker"); return; }
      onMain("worker+main");
    };
    wk.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); finish(); onMain("main-worker-error"); };
    // 10 s sem resposta: a GPU está inutilizável para a cena (não sonda de novo na thread principal);
    // nos testes com allowSoftware o SwiftShader pode levar mais, então a espera é maior
    timer = setTimeout(function () { finish(); publish(false, "timeout"); }, soft ? 30000 : 10000);
    wk.postMessage({ soft: soft });
  } catch (e) {
    finish();
    onMain("main-worker-error");
  }
})();

/* Loop de animação com pausa (fora da tela, aba oculta) e controle de DPR adaptativo. */
function makeLoop(target, frame) {
  var visible = false, running = false, raf = 0, last = 0;
  function tick(t) {
    if (!running) return;
    var raw = last ? t - last : 0;
    var dt = last ? Math.min(0.05, raw / 1000) : 1 / 60;
    last = t;
    frame(dt, t, raw);
    if (running) raf = requestAnimationFrame(tick);
  }
  function update() {
    var should = visible && !document.hidden;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(tick); }
    else if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }
  var io = new IntersectionObserver(function (en) { visible = en[en.length - 1].isIntersecting; update(); }, { threshold: 0 });
  io.observe(target);
  function onVis() { update(); }
  document.addEventListener("visibilitychange", onVis);
  return {
    stop: function () { running = false; cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", onVis); },
    get running() { return running; },
    get visible() { return visible; }
  };
}

/* Resolução adaptativa: abaixa o pixel ratio se o quadro passa do orçamento, sobe devagar se sobra folga. */
function makeDprGovernor(renderer, cap, onChange) {
  var dpr = cap, ema = 16.7, slow = 0, fast = 0, floor = Math.min(cap, 0.75);
  var fixed = W.STONE_DREN_3D && W.STONE_DREN_3D.fixedDpr;
  return {
    get dpr() { return dpr; },
    sample: function (dtMs) {
      if (fixed) return;
      ema += (dtMs - ema) * 0.08;
      if (ema > 24) { slow++; fast = 0; } else if (ema < 13) { fast++; slow = 0; } else { slow = 0; fast = 0; }
      if (slow > 45 && dpr > floor) { dpr = Math.max(floor, dpr * 0.85); slow = 0; ema = 16.7; onChange(dpr); }
      else if (fast > 240 && dpr < cap) { dpr = Math.min(cap, dpr * 1.08); fast = 0; onChange(dpr); }
    }
  };
}

/* ======================================================================================
 * HERO
 * ==================================================================================== */

/* Céu do fim de tarde: navy em quase todo o quadro e um brilho quente baixo, estreito, só do lado
 * do sol (à direita). O texto fica à esquerda, sobre o navy. O mesmo céu faz o fog do piso e o ambiente. */
function f3(v) { return "vec3(" + v.map(function (x) { return (+x).toFixed(5); }).join(", ") + ")"; }
function fx(x) { return (+x).toFixed(4); }
function skyGLSL(P) {
  return [
    "uniform vec3 sdSunDir; uniform float sdSunEnv;",
    "vec3 sdSky(vec3 d){",
    "  d = normalize(d); float y = d.y; float yy = max(y, 0.0);",
    "  vec3 col = mix(" + f3(P.skyHor) + ", " + f3(P.skyZen) + ", smoothstep(-0.02, " + fx(P.skyGrad) + ", y));",
    "  vec2 az = normalize(d.xz + vec2(1e-5)); vec2 saz = normalize(sdSunDir.xz);",
    "  float a = max(dot(az, saz), 0.0);",
    "  col += " + f3(P.glowA) + " * pow(a, " + fx(P.glowAPow) + ") * exp(-yy * " + fx(P.glowAFall) + ");",
    "  col += " + f3(P.glowB) + " * pow(a, " + fx(P.glowBPow) + ") * exp(-yy * " + fx(P.glowBFall) + ");",
    "  float s = max(dot(d, sdSunDir), 0.0);",
    "  col += vec3(1.0, 0.55, 0.2) * (pow(s, 9000.0) * 5.0 * sdSunEnv + (pow(s, 60.0) * 0.1 + pow(s, 9.0) * 0.02) * exp(-yy * " + fx(P.haloFall) + "));",
    "  col = mix(col, vec3(0.004, 0.005, 0.008), smoothstep(0.0, -0.1, y));",
    "  return col; }"
  ].join("\n");
}

/* Véu atrás do texto: escurece em espaço de tela (já em sRGB, no fim do shader) à esquerda no
 * enquadramento largo e na faixa de baixo. Entra IGUAL no céu, no piso e nas manchas molhadas: se só o
 * piso escurecesse, a borda dele (onde o fog já é 1 e o piso tem a cor do céu) viraria um degrau no horizonte. */
// (sdSs aceita a > b: o véu lateral escurece a esquerda no largo e o lado do sol, à direita, em retrato)
var VEIL_GLSL = [
  "uniform vec4 sdGrade, sdGradeY;",
  "float sdSs(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }",
  "float sdVeil(){",
  "  return mix(sdGrade.z, 1.0, sdSs(sdGrade.x, sdGrade.y, gl_FragCoord.x * sdGrade.w))",
  "    * mix(sdGradeY.x, 1.0, sdSs(sdGradeY.y, sdGradeY.z, gl_FragCoord.y * sdGradeY.w)); }"
].join("\n");

var MACRO_GLSL = [
  "float sdH2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
  "float sdN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
  "  return mix(mix(sdH2(i), sdH2(i + vec2(1.0, 0.0)), f.x), mix(sdH2(i + vec2(0.0, 1.0)), sdH2(i + vec2(1.0, 1.0)), f.x), f.y); }",
  "float sdMacro(vec2 p){ return 0.86 + 0.28 * (0.6 * sdN(p * 1.1) + 0.4 * sdN(p * 3.3 + 7.0)); }"
].join("\n");

// avisa o fim do hero (pronto, falhou ou desistiu): o corte só começa depois, sem disputar a thread
var heroSettle = null;
var heroSettled = new Promise(function (r) { heroSettle = r; });

async function initHero(canvas) {
  // a montagem (módulos, texturas, bake, shaders) só começa depois da entrada do texto do hero
  var gate = await introGate(1600);
  var t0 = performance.now();
  performance.mark("sd:hero3d-start");
  var mods = await loadLibs();
  var THREE = mods[0], S = mods[1];
  var section = canvas.closest(".hero") || canvas.parentElement;
  var low = S.isLowTier();
  var Q = low
    ? { tex: 1024, drops: 320, decals: 1000, cells: 64 }
    : { tex: 2048, drops: 640, decals: 2200, cells: 72 };
  stats.hero = { tier: low ? "low" : "high", frames: 0, introWaitMs: gate.ms, introBy: gate.by };
  // parâmetros de direção de arte (podem ser ajustados em testes via window.STONE_DREN_3D.hero)
  var P = Object.assign({
    // sol baixo (13 graus) logo fora do quadro, à direita; câmera a 20 cm do chão
    sunAz: 40, sunEl: 13, sunI: 5, fillI: 2.6, fillColor: 0xc8c2b6, exposure: 2.0,
    camH: 0.2, camHPortrait: 0.2, tilt: 10, tiltPortrait: -7, horizonPortrait: 0.4, exposurePortrait: 1.42, sunInLand: 1.25, sunOutPortrait: 2.4,
    clearcoat: 0.26, ccRough: 0.55, ccNormal: 0.3, spec: 0.25, env: 1.2, hemi: 0.4,
    tone: "neutral", sunColor: [1.0, 0.7, 0.42], sunEnv: 0.1, albedo: 1.3, yaw: null, yawPortrait: null, ringK: 0.32, wetK: 0.55,
    dofA: 0.55, dofB: 1.1, dofBias: 1.6, poolX: 1.6, poolZ: -1.4, poolRX: 1.6, poolRZ: 2.0, poolMin: 0.45, poolMax: 1.9,
    // céu navy (a cor da marca) com o brilho quente estreito e baixo, só do lado do sol
    skyZen: [0.0022, 0.005, 0.0135], skyHor: [0.0085, 0.0135, 0.027], skyGrad: 0.55,
    glowA: [0.3, 0.14, 0.04], glowAPow: 22, glowAFall: 18, glowB: [0.05, 0.028, 0.012], glowBPow: 6, glowBFall: 9, haloFall: 8,
    // pedra: grãos britados de ~1 cm, cor de cada grão tirada de um ponto das fotos palha, ouro e branca
    photoW: [0.52, 0.3, 0.18], baseLod: 2.4, sat: 1.12, facets: 1.0, voids: 0.08, gap: 0.05, round: 0.16, fine: 0.55,
    tile: 0.75, hm: 0.0052, cells: 0,
    // texto legível: chuva mais discreta e piso mais escuro atrás da coluna do texto e da faixa de baixo
    rainFade: [-0.7, 0.3, 0.35], rainFadeYPortrait: [0.15, -0.35, 0.45],
    leftDim: 0.6, gradeX: [0.45, 1.0], bottomDim: 0.85, gradeY: [0.0, 0.3],
    // retrato: o texto cobre a largura toda e desce sobre o piso; véu na faixa de baixo e do lado do sol
    sideDimPortrait: 0.75, gradeXPortrait: [1.05, 0.5], bottomDimPortrait: 0.42, gradeYPortrait: [0.22, 0.7]
  }, (W.STONE_DREN_3D && W.STONE_DREN_3D.hero) || {});
  var SKY_GLSL = skyGLSL(P);

  var renderer = S.makeRenderer(canvas, { antialias: false, alpha: false, exposure: P.exposure });
  var cap = S.dprCap();
  renderer.setPixelRatio(cap);
  var disposed = false;

  // sol baixo à frente e à direita; a câmera gira um pouco em telas estreitas para mantê-lo na borda
  var SUN_AZ = THREE.MathUtils.degToRad(P.sunAz), SUN_EL = THREE.MathUtils.degToRad(P.sunEl);
  var sunDir = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
  var sunColor = new THREE.Color(P.sunColor[0], P.sunColor[1], P.sunColor[2]);
  renderer.toneMapping = P.tone === "neutral" ? THREE.NeutralToneMapping : P.tone === "agx" ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;

  // fotos reais das pedras: palha dominante, um pouco de ouro e alguns grãos brancos
  var imgs = await Promise.all(["palha", "ouro", "branca"].map(function (c) { return S.loadImage(S.fotoUrl(c)); }));
  await S.nextFrame();
  var ptex = imgs.map(function (im) { return S.photoTexture(im, renderer); });
  var TILE = P.tile, HM = P.hm;
  // o bake roda um passe por quadro (sem tarefa longa)
  var maps = await S.bakeStoneMaps(renderer, {
    size: Q.tex, cells: P.cells || Q.cells, tileMeters: TILE, heightMeters: HM, sunDir: sunDir, seed: 5,
    photos: [{ tex: ptex[0], weight: P.photoW[0] }, { tex: ptex[1], weight: P.photoW[1] }, { tex: ptex[2], weight: P.photoW[2] }],
    baseLod: P.baseLod, sat: P.sat, facets: P.facets, voids: P.voids, gap: P.gap, round: P.round, fine: P.fine
  });
  ptex.forEach(function (t) { t.dispose(); });
  await S.nextFrame();

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 60);

  // véu atrás do texto (VEIL_GLSL): à esquerda no enquadramento largo e na faixa de baixo (onde ficam os
  // números do hero); em retrato o texto ocupa a largura toda e só a faixa de baixo escurece
  var gradeU = { value: new THREE.Vector4(P.gradeX[0], P.gradeX[1], P.leftDim, 1) };
  var gradeYU = { value: new THREE.Vector4(P.bottomDim, P.gradeY[0], P.gradeY[1], 1) };

  // céu: mesma função do fog e do ambiente e o mesmo véu do piso, então o horizonte emenda sem degrau
  var skyUniforms = { sdSunDir: { value: sunDir }, sdSunEnv: { value: 1.0 }, sdGrade: gradeU, sdGradeY: gradeYU };
  var skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
    fragmentShader: SKY_GLSL + "\n" + VEIL_GLSL + "\nvarying vec3 vDir; void main(){ gl_FragColor = vec4(sdSky(vDir), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\ngl_FragColor.rgb *= sdVeil();\n}"
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // ambiente para reflexos da resina (PMREM do mesmo céu, com o sol mais contido)
  var pmrem = new THREE.PMREMGenerator(renderer);
  var envScene = new THREE.Scene();
  var envSkyMat = new THREE.ShaderMaterial({
    uniforms: { sdSunDir: { value: sunDir }, sdSunEnv: { value: P.sunEnv } }, side: THREE.BackSide,
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: SKY_GLSL + "\nvarying vec3 vDir; void main(){ vec3 c = sdSky(vDir); c += vec3(0.010, 0.013, 0.022) * smoothstep(-0.2, 0.9, normalize(vDir).y); gl_FragColor = vec4(c, 1.0); }"
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), envSkyMat));
  var envRT = pmrem.fromScene(envScene, 0.0);
  envScene.children[0].geometry.dispose();
  envSkyMat.dispose();
  pmrem.dispose();
  await S.nextFrame();

  // luz 0: o sol (com a sombra própria das pedrinhas assada no bake); luz 1: céu do fim de tarde vindo de trás
  var sunLight = new THREE.DirectionalLight(sunColor, P.sunI);
  sunLight.position.copy(sunDir).multiplyScalar(20);
  scene.add(sunLight);
  var fill = new THREE.DirectionalLight(P.fillColor, P.fillI);
  fill.position.set(-0.55, 0.62, 0.55).multiplyScalar(20);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x33476e, 0x0c0a07, P.hemi));

  // piso: plano com os mapas do bake, sombra própria das pedrinhas, poça de luz, fog e desfoque do primeiro plano
  var FOG_D = low ? 0.16 : 0.15;
  var floorMat = new THREE.MeshPhysicalMaterial({
    map: maps.albedo, normalMap: maps.normal, normalScale: new THREE.Vector2(1, 1),
    roughness: 1, roughnessMap: maps.data, metalness: 0,
    clearcoat: P.clearcoat, clearcoatRoughness: P.ccRough, clearcoatRoughnessMap: maps.data,
    specularIntensity: P.spec, envMap: envRT.texture, envMapIntensity: P.env
  });
  var floorUniforms = {
    sdData: { value: maps.data }, sdFogD: { value: FOG_D }, sdSunDir: { value: sunDir }, sdSunEnv: { value: 1.0 },
    sdDof: { value: new THREE.Vector2(P.dofA, P.dofB) }, sdDofNear: { value: P.dofBias }, sdAlbedoK: { value: P.albedo },
    sdPoolC: { value: new THREE.Vector4(P.poolX, P.poolZ, P.poolRX, P.poolRZ) }, sdPoolK: { value: new THREE.Vector2(P.poolMin, P.poolMax) },
    sdGrade: gradeU, sdGradeY: gradeYU
  };
  floorMat.onBeforeCompile = function (sh) {
    Object.assign(sh.uniforms, floorUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSdWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvSdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    var lights = THREE.ShaderChunk.lights_fragment_begin.replace(
      "getDirectionalLightInfo( directionalLight, directLight );",
      "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? mix(0.05, 1.0, sdSunVis) * sdPool : 1.0;"
    );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + SKY_GLSL + "\n" + MACRO_GLSL + "\n" + VEIL_GLSL + "\nuniform sampler2D sdData; uniform float sdFogD, sdDofNear, sdAlbedoK; uniform vec2 sdDof, sdPoolK; uniform vec4 sdPoolC; varying vec3 vSdWorld;")
      .replace("#include <map_fragment>", [
        "float sdDistC = length(vSdWorld - cameraPosition);",
        "float sdBias = sdDofNear * (1.0 - smoothstep(sdDof.x, sdDof.y, sdDistC));",
        THREE.ShaderChunk.map_fragment.split("texture2D( map, vMapUv )").join("texture2D( map, vMapUv, sdBias )"),
        "diffuseColor.rgb *= sdMacro(vSdWorld.xz) * sdAlbedoK;",
        "float sdFar = smoothstep(0.9, 7.0, sdDistC);",
        "vec2 sdPd = (vSdWorld.xz - sdPoolC.xy) / sdPoolC.zw;",
        "float sdPool = mix(sdPoolK.x, sdPoolK.y, exp(-dot(sdPd, sdPd)));"
      ].join("\n"))
      .replace("#include <roughnessmap_fragment>", THREE.ShaderChunk.roughnessmap_fragment.split("vRoughnessMapUv )").join("vRoughnessMapUv, sdBias )") + "\nroughnessFactor = min(1.0, roughnessFactor + sdFar * 0.3);")
      .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.split("texture2D( normalMap, vNormalMapUv )").join("texture2D( normalMap, vNormalMapUv, sdBias )") + "\nnormal = normalize(mix(normal, nonPerturbedNormal, sdFar * 0.65));")
      .replace("#include <clearcoat_normal_fragment_begin>", "#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normalize(mix(normal, nonPerturbedNormal, " + fx(P.ccNormal) + "));\n#endif")
      .replace("#include <lights_fragment_begin>", "float sdSunVis = texture2D(sdData, vMapUv).b;\n" + lights)
      .replace("#include <opaque_fragment>", [
        "{ vec3 sdV = vSdWorld - cameraPosition; float sdDist = length(sdV);",
        "  float sdFog = 1.0 - exp(-pow(sdDist * sdFogD, 1.5));",
        "  outgoingLight = mix(outgoingLight, sdSky(vec3(sdV.x, 0.0, sdV.z)), sdFog); }",
        "#include <opaque_fragment>"
      ].join("\n"))
      // o véu atrás do texto entra no fim (já em sRGB): segura até os brilhos fortes da resina molhada
      .replace("#include <colorspace_fragment>", "#include <colorspace_fragment>\ngl_FragColor.rgb *= sdVeil();");
  };
  floorMat.customProgramCacheKey = function () { return "sd-floor-6"; };
  var floor = new THREE.Mesh(new THREE.BufferGeometry(), floorMat);
  floor.frustumCulled = false;
  scene.add(floor);

  // impactos: anel curto + mancha molhada que encolhe (decal instanciado)
  var FLOOR_Y = HM * 0.95;
  var decalGeo = new THREE.InstancedBufferGeometry();
  var pg = new THREE.PlaneGeometry(1, 1);
  decalGeo.index = pg.index;
  decalGeo.setAttribute("position", pg.attributes.position);
  var impArr = new Float32Array(Q.decals * 4);
  for (var ii = 0; ii < Q.decals; ii++) impArr[ii * 4 + 2] = -99;
  var impAttr = new THREE.InstancedBufferAttribute(impArr, 4);
  impAttr.setUsage(THREE.DynamicDrawUsage);
  decalGeo.setAttribute("aImp", impAttr);
  decalGeo.instanceCount = Q.decals;
  var decalUniforms = {
    uTime: { value: 0 }, uSize: { value: 0.07 }, uFloorY: { value: FLOOR_Y }, uLife: { value: 1.35 },
    uNormal: { value: maps.normal }, uData: { value: maps.data }, uTile: { value: TILE },
    uSunColor: { value: sunColor }, uFogD: { value: FOG_D }, sdSunDir: { value: sunDir }, sdSunEnv: { value: 1.0 },
    uRingK: { value: P.ringK }, uWetK: { value: P.wetK }, sdGrade: gradeU, sdGradeY: gradeYU
  };
  var decalMat = new THREE.ShaderMaterial({
    uniforms: decalUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: [
      "attribute vec4 aImp; uniform float uTime, uSize, uFloorY, uLife;",
      "varying vec2 vQ; varying vec3 vW; varying float vAge, vSeed;",
      "void main(){",
      "  float age = uTime - aImp.z; vAge = age; vSeed = aImp.w;",
      "  if (age < 0.0 || age > uLife) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",
      "  vec2 q = position.xy * uSize; vQ = q;",
      "  vec3 w = vec3(aImp.x + q.x, uFloorY, aImp.y + q.y); vW = w;",
      "  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }"
    ].join("\n"),
    fragmentShader: SKY_GLSL + "\n" + VEIL_GLSL + "\n" + [
      "uniform sampler2D uNormal, uData; uniform float uTile, uFogD, uRingK, uWetK; uniform vec3 uSunColor;",
      "varying vec2 vQ; varying vec3 vW; varying float vAge, vSeed;",
      "void main(){",
      "  float r = length(vQ);",
      "  float s1 = fract(vSeed * 13.7), s2 = fract(vSeed * 71.3), s3 = fract(vSeed * 5.3);",
      // mancha molhada: aparece na hora, encolhe e some (a água desce pelos vazios)
      "  float lifeW = 0.7 + 0.55 * s1; float aw = clamp(vAge / lifeW, 0.0, 1.0);",
      "  float ang = atan(vQ.y, vQ.x);",
      "  float wob = 1.0 + 0.2 * sin(ang * 3.0 + s2 * 6.28) + 0.12 * sin(ang * 5.0 + s3 * 6.28);",
      "  float Rw = (0.0065 + 0.0075 * s2) * wob * smoothstep(0.0, 0.035, vAge) * (1.0 - 0.9 * smoothstep(0.08, 1.0, aw));",
      "  float wet = (1.0 - smoothstep(Rw * 0.5, Rw, r)) * (1.0 - smoothstep(0.5, 1.0, aw));",
      // anel de impacto curto
      "  float lifeR = 0.26 + 0.16 * s1; float ar = clamp(vAge / lifeR, 0.0, 1.0);",
      "  float Rr = 0.002 + (0.009 + 0.014 * s2 * s2) * (1.0 - pow(1.0 - ar, 2.4));",
      "  float wR = 0.0008 + 0.0011 * ar; float dr = (r - Rr) / wR;",
      "  float env = pow(1.0 - ar, 1.8) * step(vAge, lifeR) * (0.35 + 0.65 * step(0.35, s3));",
      "  float ring = exp(-dr * dr) * env;",
      "  if (wet + ring < 0.003) discard;",
      "  vec2 uv = vW.xz / uTile;",
      "  vec3 nt = texture2D(uNormal, uv).xyz * 2.0 - 1.0;",
      "  vec3 n = normalize(vec3(nt.x, nt.z, nt.y));",
      "  vec3 nw = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.55));",
      "  vec2 rad = vQ / max(r, 1e-5);",
      "  nw = normalize(nw + vec3(rad.x, 0.0, rad.y) * (-dr * exp(-dr * dr)) * env * 0.9);",
      "  vec3 V = normalize(cameraPosition - vW);",
      "  vec3 R = reflect(-V, nw);",
      "  float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, nw), 0.0), 5.0);",
      "  float vis = texture2D(uData, uv).b;",
      "  vec3 spec = sdSky(R) * F * 1.6 + uSunColor * pow(max(dot(R, sdSunDir), 0.0), 260.0) * 16.0 * mix(0.35, 1.0, vis);",
      "  float m = max(wet, ring);",
      "  vec3 col = spec * m + mix(vec3(0.5, 0.56, 0.62), uSunColor, 0.45) * ring * uRingK;",
      "  float dist = length(vW - cameraPosition);",
      "  float fogK = exp(-pow(dist * uFogD, 1.5)) * sdVeil();",
      "  gl_FragColor = vec4(col, 1.0);",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "  gl_FragColor.rgb *= fogK;",
      "  gl_FragColor.a = wet * uWetK * fogK; }"
    ].join("\n")
  });
  var decals = new THREE.Mesh(decalGeo, decalMat);
  decals.frustumCulled = false;
  decals.renderOrder = 2;
  scene.add(decals);

  // gotas em queda: traços finos em espaço de tela (largura constante em pixels)
  var dropGeo = new THREE.InstancedBufferGeometry();
  dropGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  dropGeo.setIndex([0, 1, 2, 2, 1, 3]);
  var dropArr = new Float32Array(Q.drops * 4);
  var dropAttr = new THREE.InstancedBufferAttribute(dropArr, 4);
  dropAttr.setUsage(THREE.DynamicDrawUsage);
  dropGeo.setAttribute("aDrop", dropAttr);
  dropGeo.instanceCount = Q.drops;
  var WIND = new THREE.Vector3(-0.35, -5.6, 0.12);
  var dropUniforms = {
    uVel: { value: WIND }, uStreak: { value: 0.022 }, uRes: { value: new THREE.Vector2(1, 1) },
    uWidth: { value: 1.1 }, uOpacity: { value: 1.0 }, sdSunDir: { value: sunDir },
    uTextFade: { value: new THREE.Vector3(P.rainFade[0], P.rainFade[1], P.rainFade[2]) },
    uTextFadeY: { value: new THREE.Vector3(1, 2, 1) }
  };
  /* Cor das gotas: definida direto na tela (sRGB), como um véu de luz por cima do quadro já com tone
   * mapping; por isso o shader não passa pelo tonemapping/colorspace do three (aplicar a curva só no
   * acréscimo de uma gota não teria sentido). Dois cuidados evitam o traço amarelo esverdeado sobre o
   * dourado: (1) a cor da gota nunca estoura um canal sozinho (acima de 0,8 ela comprime mantendo o
   * matiz e clareia para o branco quente); (2) a mistura é "screen" (src + dst * (1 - src)) em vez de
   * soma: sobre um fundo claro o vermelho não trava em 1 enquanto o verde continua subindo. No escuro
   * (céu navy, piso na sombra) screen e soma dão praticamente o mesmo. */
  var dropMat = new THREE.ShaderMaterial({
    uniforms: dropUniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: [
      "attribute vec4 aDrop; uniform vec3 uVel, uTextFade, uTextFadeY; uniform float uStreak, uWidth; uniform vec2 uRes;",
      "varying float vT, vA, vS; varying vec3 vDir;",
      "void main(){",
      "  vec3 head = aDrop.xyz; float k = fract(aDrop.w * 7.13);",
      "  vec3 tail = head - uVel * uStreak * (0.75 + 0.5 * k);",
      "  vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);",
      "  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);",
      "  vec4 c = mix(ct, ch, position.y);",
      "  vec2 sh = ch.xy / ch.w, st = ct.xy / ct.w;",
      "  vec2 dir = (sh - st) * uRes; dir = dir / max(length(dir), 1e-4);",
      "  vec2 perp = vec2(-dir.y, dir.x);",
      "  float dist = length(head - cameraPosition);",
      "  float wraw = uWidth * clamp(1.4 / dist, 0.3, 2.6);",
      "  float wpx = max(wraw, uWidth);",
      "  c.xy += perp * position.x * wpx / uRes * c.w;",
      "  vT = position.y; vS = position.x;",
      // traços mais discretos sobre a coluna do texto (à esquerda)
      "  float side = mix(uTextFade.z, 1.0, smoothstep(uTextFade.x, uTextFade.y, sh.x)) * mix(uTextFadeY.z, 1.0, smoothstep(uTextFadeY.x, uTextFadeY.y, sh.y));",
      "  vA = smoothstep(0.3, 0.75, dist) * (1.0 - smoothstep(5.0, 8.0, dist)) * (wraw / wpx) * (0.5 + 0.5 * k) * side;",
      "  vDir = normalize(head - cameraPosition);",
      "  gl_Position = c; }"
    ].join("\n"),
    fragmentShader: [
      "uniform vec3 sdSunDir; uniform float uOpacity;",
      "varying float vT, vA, vS; varying vec3 vDir;",
      // compressão suave acima de 0,8: mantém a proporção entre os canais e clareia para o branco
      "vec3 sdRoll(vec3 c){",
      "  float peak = max(c.r, max(c.g, c.b));",
      "  if (peak <= 0.8) return c;",
      "  float np = 1.0 - 0.04 / (peak - 0.6);",
      "  c *= np / peak;",
      "  return mix(c, vec3(np), 1.0 - 1.0 / (0.6 * (peak - np) + 1.0)); }",
      "void main(){",
      "  float across = 1.0 - abs(vS);",
      "  float a = vA * uOpacity * pow(vT, 1.4) * smoothstep(0.0, 0.8, across);",
      "  float sunF = pow(max(dot(vDir, sdSunDir), 0.0), 10.0);",
      // contra o sol a gota fica branco quente (não laranja puro): somada ao dourado, não vira amarelo
      "  vec3 col = mix(vec3(0.62, 0.7, 0.8), vec3(1.0, 0.86, 0.68), sunF) * (0.7 + 2.0 * sunF);",
      "  gl_FragColor = vec4(sdRoll(col * a), 1.0); }"
    ].join("\n")
  });
  var drops = new THREE.Mesh(dropGeo, dropMat);
  drops.frustumCulled = false;
  drops.renderOrder = 3;
  scene.add(drops);

  /* ---------- câmera e composição ---------- */
  var view = { w: 1, h: 1, yaw: 0, tilt: 0, tanH: 0.5, tanV: 0.3 };
  var base = new THREE.Vector3(0, P.camH, 0);
  var fwd = new THREE.Vector3(), right = new THREE.Vector3();

  function frame() {
    var aspect = view.w / view.h;
    // campo horizontal mínimo de ~42 graus; em retrato o vertical abre até 62
    var vfov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) / aspect) * 180 / Math.PI, 33, 62);
    camera.fov = vfov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    view.tanV = Math.tan(THREE.MathUtils.degToRad(vfov / 2));
    view.tanH = view.tanV * aspect;
    var hfovHalf = Math.atan(view.tanH);
    // em retrato o texto ocupa a tela toda e o sol fica logo fora da borda
    var portrait = aspect < 0.9;
    view.yaw = P.yaw != null ? THREE.MathUtils.degToRad(portrait && P.yawPortrait != null ? P.yawPortrait : P.yaw)
      : Math.max(0, SUN_AZ - hfovHalf * (portrait ? P.sunOutPortrait : P.sunInLand));
    view.tilt = -THREE.MathUtils.degToRad(portrait ? P.tiltPortrait : P.tilt);
    if (portrait && P.horizonPortrait) {
      // o horizonte cai numa fração da altura do PRIMEIRO viewport (no celular o hero é mais alto que a
      // tela): o piso de pedra já aparece sem rolar. A inclinação sai da própria projeção da câmera.
      var vh = Math.min(view.h, W.innerHeight || view.h);
      var hf = THREE.MathUtils.clamp(P.horizonPortrait * vh / view.h, 0.15, 0.6);
      view.tilt = -Math.atan((0.5 - hf) * 2 * view.tanV);
    }
    base.y = portrait ? P.camHPortrait : P.camH;
    renderer.toneMappingExposure = portrait ? P.exposurePortrait : P.exposure;
    // (a mistura screen quase não perde brilho no céu escuro do retrato: 0,6 mantém a chuva tão discreta quanto antes)
    dropUniforms.uOpacity.value = portrait ? 0.6 : 1.0;
    // em retrato o texto cobre a largura toda: sem gradiente lateral (a opacidade geral já é menor)
    dropUniforms.uTextFade.value.set(portrait ? -3 : P.rainFade[0], portrait ? -2 : P.rainFade[1], portrait ? 1 : P.rainFade[2]);
    // em retrato o título e o texto ficam na parte de cima: ali a chuva aparece menos
    var fy = P.rainFadeYPortrait;
    dropUniforms.uTextFadeY.value.set(portrait ? fy[0] : 1, portrait ? fy[1] : 2, portrait ? fy[2] : 1);
    var gx = portrait ? P.gradeXPortrait : P.gradeX;
    gradeU.value.set(gx[0], gx[1], portrait ? P.sideDimPortrait : P.leftDim, gradeU.value.w);
    var gy = portrait ? P.gradeYPortrait : P.gradeY;
    gradeYU.value.set(portrait ? P.bottomDimPortrait : P.bottomDim, gy[0], gy[1], gradeYU.value.w);
    fwd.set(Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    right.set(Math.cos(view.yaw), 0, Math.sin(view.yaw));
    buildFloor();
  }

  function buildFloor() {
    // plano grande em coordenadas de mundo (uv = x/tile, z/tile): o padrão fica preso ao chão
    var g = new THREE.PlaneGeometry(60, 60, 16, 16);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -26);
    var pos = g.attributes.position, uv = g.attributes.uv;
    for (var i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / TILE, pos.getZ(i) / TILE);
    floor.geometry.dispose();
    floor.geometry = g;
  }

  /* ---------- chuva (simulação na CPU, poucos milhares de floats por quadro) ---------- */
  var R = S.rng(20260924);
  var dropV = new Float32Array(Q.drops);
  var dropD = new Float32Array(Q.drops);
  var impSlot = 0, clock = 0;
  function spawn(i, initial) {
    var d = 0.4 + Math.pow(R(), 1.15) * 5.8;
    var u = (R() * 2 - 1) * 1.12;
    var hw = d * view.tanH;
    var top = base.y + d * (view.tanV + 0.1) + 0.12;
    dropArr[i * 4] = base.x + fwd.x * d + right.x * u * hw;
    dropArr[i * 4 + 1] = initial ? FLOOR_Y + R() * top : top + R() * 0.25;
    dropArr[i * 4 + 2] = base.z + fwd.z * d + right.z * u * hw;
    dropArr[i * 4 + 3] = R();
    dropV[i] = 0.88 + R() * 0.24;
    dropD[i] = d;
  }
  function impact(x, z, d) {
    if (d > 4.2) return;
    var o = impSlot * 4;
    impArr[o] = x; impArr[o + 1] = z; impArr[o + 2] = clock; impArr[o + 3] = R();
    impSlot = (impSlot + 1) % Q.decals;
  }
  function stepRain(dt) {
    for (var i = 0; i < Q.drops; i++) {
      var o = i * 4, v = dropV[i];
      dropArr[o] += WIND.x * v * dt;
      dropArr[o + 1] += WIND.y * v * dt;
      dropArr[o + 2] += WIND.z * v * dt;
      if (dropArr[o + 1] <= FLOOR_Y) {
        impact(dropArr[o], dropArr[o + 2], dropD[i]);
        spawn(i, false);
      }
    }
    dropAttr.needsUpdate = true;
    impAttr.needsUpdate = true;
  }

  /* ---------- interação: parallax do mouse e dolly no scroll ---------- */
  var ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  var fine = W.matchMedia && W.matchMedia("(pointer: fine)").matches;
  // (com movimento reduzido não há loop: os dois só guardam a posição para quando o loop voltar)
  function onPointer(e) {
    if (reduce) return;
    ptr.tx = (e.clientX / W.innerWidth) * 2 - 1;
    ptr.ty = (e.clientY / W.innerHeight) * 2 - 1;
  }
  if (fine) W.addEventListener("pointermove", onPointer, { passive: true });
  var scrollP = 0, scrollS = 0;
  function onScroll() {
    var r = section.getBoundingClientRect();
    scrollP = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
  }
  W.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var look = new THREE.Vector3(), camPos = new THREE.Vector3();
  function placeCamera(t, dt) {
    ptr.x = S.damp(ptr.x, ptr.tx, 2.2, dt);
    ptr.y = S.damp(ptr.y, ptr.ty, 2.2, dt);
    scrollS = S.damp(scrollS, scrollP, 6, dt);
    var drift = reduce ? 0 : 1;
    camPos.copy(base)
      .addScaledVector(right, (0.024 * Math.sin(t * 0.09) + ptr.x * 0.03) * drift)
      .addScaledVector(fwd, scrollS * 0.55 + 0.02 * Math.sin(t * 0.063) * drift);
    camPos.y += (0.006 * Math.sin(t * 0.13) - ptr.y * 0.014) * drift - scrollS * 0.03;
    var tilt = view.tilt - scrollS * 0.05 + ptr.y * 0.006;
    var yaw = view.yaw + ptr.x * 0.012;
    look.set(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt)).add(camPos);
    camera.position.copy(camPos);
    camera.lookAt(look);
  }

  /* ---------- tamanho, DPR e loop ---------- */
  var gov = makeDprGovernor(renderer, cap, function (d) { renderer.setPixelRatio(d); resize(true); });
  function resize(force) {
    if (disposed) return;
    var w = Math.max(1, section.clientWidth), h = Math.max(1, section.clientHeight);
    if (!force && w === view.w && h === view.h) return;
    var aspectChanged = Math.abs(w / h - view.w / view.h) > 0.01;
    view.w = w; view.h = h;
    renderer.setSize(w, h, false);
    var px = renderer.getPixelRatio();
    dropUniforms.uRes.value.set(w * px, h * px);
    dropUniforms.uWidth.value = 1.05 * px;
    gradeU.value.w = 1 / (w * px);
    gradeYU.value.w = 1 / (h * px);
    if (aspectChanged || !floor.geometry.attributes.position) frame();
  }
  resize(true);
  var ro = new ResizeObserver(function () { resize(false); });
  ro.observe(section);

  for (var di = 0; di < Q.drops; di++) spawn(di, true);

  /* Vigia: antes de mostrar a cena, ~45 quadros medidos com o canvas ainda invisível e a chuva 2D
   * na tela. Invisível, o navegador não espera a GPU para compor a página, então o intervalo entre
   * quadros não basta: cada quadro leva uma cerca (fenceSync) e mede-se quanto a GPU demora para
   * terminá-lo. Mediana acima de 50 ms: desiste e a versão 2D fica.
   * Depois de mostrar, lentidão prolongada (janelas de 90 quadros) também devolve a página à foto. */
  var revealed = false, lost = false;
  var gl = renderer.getContext(), fence = null, fenceT = 0, fenceMute = false, px1 = new Uint8Array(4);
  function gpuLatency() {
    // -1: ainda sem medida; senão, ms entre o fim do quadro na CPU e o fim dele na GPU (0: sem cerca)
    if (!gl.fenceSync || fenceMute) return 0;
    if (!fence) return -1;
    var now = performance.now();
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED) {
      gl.deleteSync(fence);
      fence = null;
      return now - fenceT;
    }
    if (now - fenceT < 1000) return -1;
    // 1 s sem sinal: ou a GPU está muito atrás, ou o navegador não atualiza a cerca de um canvas
    // invisível. A leitura de 1 pixel espera a GPU e desempata (só acontece nesse caso raro).
    var r0 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
    var waited = performance.now() - r0;
    gl.deleteSync(fence);
    fence = null;
    if (waited > 50) return now - fenceT;
    fenceMute = true;   // a cerca não informa nada aqui: segue só pelo intervalo entre quadros
    return 0;
  }
  function gpuFence() {
    if (!gl.fenceSync || fence) return;
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    fenceT = performance.now();
  }
  var probe = S.frameWatchdog({ warm: 8, samples: 45, limitMs: 50 });
  var late = S.frameWatchdog({ warm: 0, samples: 90, limitMs: 60, windowMs: 4000 });
  function reveal() {
    if (revealed || disposed) return;
    revealed = true;
    stats.hero.initMs = Math.round(performance.now() - t0);
    stats.hero.dpr = renderer.getPixelRatio();
    stats.hero.probeMs = Math.round(probe.median * 10) / 10;
    performance.mark("sd:hero3d-ready");
    try { performance.measure("sd:hero3d-init", "sd:hero3d-start", "sd:hero3d-ready"); } catch (e) {}
    docEl.classList.add("has-hero3d");
    W.dispatchEvent(new Event("stonedren:hero3d-ready"));
    heroSettle();
  }
  function bail(reason) {
    if (disposed) return;
    stats.hero.bailed = reason;
    stats.hero.probeMs = Math.round(probe.median * 10) / 10;
    var was = revealed;
    api.dispose();
    // o hero.js 2D escuta este evento para voltar com a chuva (a foto volta pelo CSS)
    if (was) W.dispatchEvent(new Event("stonedren:hero3d-lost"));
    heroSettle();
  }

  function render(dt, tms, raw) {
    var lat = revealed ? 0 : gpuLatency();
    clock += dt;
    decalUniforms.uTime.value = clock;
    stepRain(dt);
    placeCamera(clock, dt);
    renderer.render(scene, camera);
    stats.hero.frames++;
    if (!revealed) {
      gpuFence();
      if (lat < 0) return;
      var v = probe.sample(Math.max(raw, lat));
      if (v === "ok") reveal();
      else if (v === "slow") { bail("slow"); return; }
    } else {
      var lv = late.sample(raw);
      if (lv === "ok") late.reset();
      else if (lv === "slow") { bail("slow-late"); return; }
      if (tms) gov.sample(dt * 1000);
    }
  }

  // primeiro quadro (e, com movimento reduzido, o único): 1,6 s de chuva simulada antes, sem desenhar
  for (var s = 0; s < 96; s++) { clock += 1 / 60; stepRain(1 / 60); }
  decalUniforms.uTime.value = clock;
  placeCamera(clock, 1);
  await S.nextFrame();
  await S.compileQuiet(renderer, scene, camera);
  await S.nextFrame();
  renderer.render(scene, camera);
  stats.hero.firstFrameMs = Math.round(performance.now() - t0);
  performance.mark("sd:hero3d-firstframe");

  if (W.STONE_DREN_3D && W.STONE_DREN_3D.debug) stats.hero.debug = { THREE: THREE, scene: scene, renderer: renderer, camera: camera, drops: drops, decals: decals, floor: floor, sun: sunLight, fill: fill, floorMat: floorMat, maps: maps, dropArr: dropArr, impArr: impArr, uniforms: { drop: dropUniforms, decal: decalUniforms, floor: floorUniforms } };

  // movimento reduzido: um quadro parado, redesenhado só se o tamanho mudar. A preferência pode mudar
  // com a página aberta: liga, o loop para e fica o quadro atual parado; desliga, o loop volta.
  var loop = null;
  function still() {
    if (disposed) return;
    placeCamera(clock, 1);
    renderer.render(scene, camera);
    stats.hero.stills = (stats.hero.stills || 0) + 1;
  }
  function setMotion(r) {
    if (disposed) return;
    if (r) {
      if (loop) { loop.stop(); loop = null; }
      ptr.x = ptr.y = ptr.tx = ptr.ty = 0;
      still();
      reveal();   // se a sonda de desempenho ainda corria, o quadro parado já basta
    } else if (!loop) {
      late.reset();
      loop = makeLoop(section, render);
    }
    stats.hero.reduced = r;
  }
  ro.disconnect();
  ro = new ResizeObserver(function () { if (disposed) return; resize(false); if (!loop) still(); });
  ro.observe(section);
  setMotion(reduce);
  var offMotion = onMotion(setMotion);

  function onLost(e) {
    e.preventDefault();
    lost = true;
    stats.hero.lost = true;
    bail("context-lost");
  }
  canvas.addEventListener("webglcontextlost", onLost, { once: true });

  var api = {
    dispose: function () {
      if (disposed) return;
      disposed = true;
      if (loop) loop.stop();
      offMotion();
      ro.disconnect();
      W.removeEventListener("pointermove", onPointer);
      W.removeEventListener("scroll", onScroll);
      canvas.removeEventListener("webglcontextlost", onLost);
      docEl.classList.remove("has-hero3d");
      if (fence) { try { gl.deleteSync(fence); } catch (er) {} fence = null; }
      S.disposeObject(scene);
      maps.dispose();
      envRT.dispose();
      renderer.dispose();
      // devolve a memória de vídeo já (o canvas fica transparente por baixo da foto)
      if (!lost) { try { renderer.forceContextLoss(); } catch (er) {} }
    }
  };
  return api;
}

/* ======================================================================================
 * CORTE EXPLODIDO
 * ==================================================================================== */

// a malha só existe dentro da laje de concreto da garagem sobre solo (é o que a calculadora usa): a camada
// leva a segunda linha "só em garagem" (o SVG de reserva, do integrador, segue o mesmo texto)
var LAYER_TEXT = ["Pedra natural + resina", "Laje com malha POP", "Brita (base drenante)", "Solo compactado"];
var LAYER_SUB = [null, "só em garagem", null, null];

async function initLayers(fig) {
  var t0 = performance.now();
  performance.mark("sd:layers3d-start");
  var canvas = fig.querySelector("#layers3d");
  var mods = await loadLibs();
  var THREE = mods[0], S = mods[1];
  var low = S.isLowTier();
  stats.layers = { tier: low ? "low" : "high", frames: 0 };

  var renderer = S.makeRenderer(canvas, { antialias: true, alpha: true, exposure: 1.05 });
  var cap = S.dprCap();
  renderer.setPixelRatio(cap);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  var disposed = false, lost = false;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(26, 560 / 520, 0.1, 40);
  var roomMod = await import("three/addons/environments/RoomEnvironment.js");
  await S.nextFrame();
  var pmrem = new THREE.PMREMGenerator(renderer);
  var room = new roomMod.RoomEnvironment();
  // compila os materiais da sala fora da thread (KHR_parallel_shader_compile) antes do PMREM
  await S.compileQuiet(renderer, room, camera);
  await S.nextFrame();
  var envRT = pmrem.fromScene(room, 0.03);
  room.dispose && room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;

  var key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(-1.6, 3.2, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  key.shadow.camera.left = -1.2; key.shadow.camera.right = 1.2;
  key.shadow.camera.top = 1.6; key.shadow.camera.bottom = -1.0;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 8;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  scene.add(key);
  var rim = new THREE.DirectionalLight(0x9cc7d8, 0.9);
  rim.position.set(2.2, 1.4, -2.4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a4c72, 0x100c08, 0.7));

  // dimensões da maquete (unidades livres; espessuras exageradas para leitura)
  var BW = 1.0, BD = 0.64;
  var TH = { stone: 0.13, mesh: 0.02, brita: 0.27, soil: 0.3 };
  var block = new THREE.Group();
  scene.add(block);

  var imgPalha = await S.loadImage(S.fotoUrl("palha"));
  var imgOuro = await S.loadImage(S.fotoUrl("ouro"));
  await S.nextFrame();
  var stoneCols = S.photoColors(imgPalha, 140).concat(S.photoColors(imgOuro, 70));
  var greyCols = ["#4a4c52", "#5d6068", "#6f727a", "#80838a", "#90939a", "#3c3e44", "#a3a5aa"].map(function (h) { return new THREE.Color(h); });

  function shellLayer(opts) {
    // camada de altura fixa: o grupo interno (origem no topo) sobe para ficar em [0, h]
    var slab = S.pebbleSlab({ w: BW, d: BD, maxH: opts.h, h: opts.h, spacing: opts.spacing, size: opts.size, seed: opts.seed,
      geos: opts.geos, mat: opts.mat, colors: opts.colors, core: opts.core, flatTop: opts.flatTop, castShadow: true, receiveShadow: true });
    slab.group.position.y = opts.h;
    var g = new THREE.Group();
    g.add(slab.group);
    return g;
  }

  var pebbleGeos = [0, 1, 2].map(function (i) { return S.pebbleGeometry(i + 1, { detail: 1, bump: 0.22 }); });
  var gravelGeos = [0, 1, 2].map(function (i) { return S.gravelGeometry(i + 5); });
  var stoneMat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.85, clearcoatRoughness: 0.18, metalness: 0 });
  var gravelMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true, envMapIntensity: 0.7 });

  await S.nextFrame();
  var layerStone = shellLayer({ h: TH.stone, spacing: low ? 0.05 : 0.04, size: low ? 0.028 : 0.023, seed: 7, geos: pebbleGeos, mat: stoneMat, colors: stoneCols, core: 0x1a130c, flatTop: true });
  var layerBrita = shellLayer({ h: TH.brita, spacing: low ? 0.085 : 0.066, size: low ? 0.043 : 0.036, seed: 9, geos: gravelGeos, mat: gravelMat, colors: greyCols, core: 0x1d1f23, flatTop: true });

  // malha POP (a que vai dentro da laje de concreto da garagem): barras finas nas duas direções
  var layerMesh = new THREE.Group();
  (function () {
    var bars = [];
    var step = 0.08, r = 0.0055;
    for (var x = -BW / 2 + step / 2; x < BW / 2; x += step) bars.push({ x: x, z: 0, sx: r, sz: BD, y: r * 1.5 });
    for (var z = -BD / 2 + step / 2; z < BD / 2; z += step) bars.push({ x: 0, z: z, sx: BW, sz: r, y: r * 0.5 });
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.MeshStandardMaterial({ color: 0xc9c3b6, metalness: 0.75, roughness: 0.36 });
    var im = new THREE.InstancedMesh(geo, mat, bars.length);
    var m4 = new THREE.Matrix4();
    bars.forEach(function (b, i) {
      m4.makeScale(b.sx, r, b.sz).setPosition(b.x, b.y, b.z);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    layerMesh.add(im);
  })();

  // solo compactado: bloco com textura de terra
  var soilTex = S.soilTexture(256);
  var layerSoil = new THREE.Group();
  var soilMesh = new THREE.Mesh(S.worldBox(BW, TH.soil, BD, 1.6), new THREE.MeshStandardMaterial({ map: soilTex, roughness: 0.96, color: 0xd9bfa3 }));
  soilMesh.position.y = TH.soil / 2;
  soilMesh.receiveShadow = true;
  soilMesh.castShadow = true;
  layerSoil.add(soilMesh);

  var layers = [
    { g: layerStone, h: TH.stone, idx: 0 },
    { g: layerMesh, h: TH.mesh, idx: 1 },
    { g: layerBrita, h: TH.brita, idx: 2 },
    { g: layerSoil, h: TH.soil, idx: 3 }
  ];
  layers.forEach(function (L) { block.add(L.g); });

  // base da maquete: placa escura com filete dourado e sombra de contato
  var plinth = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.34, 0.035, BD + 0.3), new THREE.MeshStandardMaterial({ color: 0x0d1830, roughness: 0.55, metalness: 0.1 }));
  plinth.position.y = -0.0175;
  plinth.receiveShadow = true;
  block.add(plinth);
  var rimLine = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(BW + 0.34, 0.035, BD + 0.3)),
    new THREE.LineBasicMaterial({ color: 0xc68a2e, transparent: true, opacity: 0.55 })
  );
  rimLine.position.copy(plinth.position);
  block.add(rimLine);

  // gotas descendo pelos vazios; um segundo passe "raio-x" mostra de leve as gotas escondidas
  var NDROP = low ? 30 : 46;
  /* Gota de água: corpo quase transparente (o fundo aparece através), borda que acende com o ângulo
   * (Fresnel) e um brilho pequeno da luz principal. Nada de pílula branca opaca: no centro da gota o
   * alfa fica perto de 0,1. O passe "raio-x" usa o mesmo material mais fraco (só o contorno aparece). */
  var dropGeo = new THREE.SphereGeometry(1, 16, 12);
  function waterMat(k, ghost) {
    return new THREE.ShaderMaterial({
      uniforms: { uK: { value: k }, uTint: { value: new THREE.Color(0x9cc7d8) } },
      transparent: true, depthWrite: false, depthFunc: ghost ? THREE.GreaterDepth : THREE.LessEqualDepth,
      vertexShader: [
        "varying vec3 vN; varying vec3 vV;",
        "void main(){",
        "  vec4 p = vec4(position, 1.0); vec3 n = normal;",
        "  #ifdef USE_INSTANCING",
        // escala não uniforme (gota esticada, sem rotação): a normal vai pela inversa da escala
        "  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));",
        "  n = n / max(sc, vec3(1e-6)); p = instanceMatrix * p;",
        "  #endif",
        "  vec4 mv = modelViewMatrix * p;",
        "  vN = normalize(normalMatrix * n); vV = -mv.xyz;",
        "  gl_Position = projectionMatrix * mv; }"
      ].join("\n"),
      fragmentShader: [
        "uniform float uK; uniform vec3 uTint;",
        "varying vec3 vN; varying vec3 vV;",
        "void main(){",
        "  vec3 N = normalize(vN), V = normalize(vV);",
        "  float nv = clamp(abs(dot(N, V)), 0.0, 1.0);",
        "  float rim = pow(1.0 - nv, 1.8);",
        "  vec3 L = normalize(vec3(-0.45, 0.8, 0.45));",
        "  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 36.0);",
        // luz de recorte de trás e do lado direito: um segundo brilho fino na borda de baixo
        "  float back = pow(max(dot(reflect(-normalize(vec3(0.6, -0.2, -0.75)), N), V), 0.0), 18.0);",
        "  float a = clamp((0.1 + 0.8 * rim + 0.35 * back) * uK + spec * uK, 0.0, 1.0);",
        "  vec3 col = uTint * (0.5 + 0.9 * rim) + vec3(0.8, 0.92, 1.0) * back * 0.6 + vec3(1.0, 0.98, 0.95) * spec * 1.5;",
        "  gl_FragColor = vec4(col, a);",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}"
      ].join("\n")
    });
  }
  var dropMat = waterMat(1.0, false);
  var ghostMat = waterMat(0.42, true);
  var dropMesh = new THREE.InstancedMesh(dropGeo, dropMat, NDROP);
  var ghostMesh = new THREE.InstancedMesh(dropGeo, ghostMat, NDROP);
  ghostMesh.instanceMatrix = dropMesh.instanceMatrix;
  ghostMesh.renderOrder = 5;
  dropMesh.frustumCulled = ghostMesh.frustumCulled = false;
  block.add(dropMesh, ghostMesh);
  var R = S.rng(424242);
  var dropsSt = [];
  function resetDrop(d, initial) {
    d.x = (R() - 0.5) * (BW - 0.12);
    d.z = (R() - 0.5) * (BD - 0.12);
    d.y = initial ? R() * 1.3 : 1.25 + R() * 0.5;
    d.delay = initial ? 0 : R() * 1.2;
    d.ph = R() * 6.28;
    d.fade = 1;
    d.v = 0.7;
  }
  for (var i = 0; i < NDROP; i++) { var d0 = {}; resetDrop(d0, true); dropsSt.push(d0); }

  /* ---------- rótulos em HTML (mesmos textos do SVG) ---------- */
  var labelsBox = document.createElement("ul");
  labelsBox.className = "l3d-labels";
  var labelEls = LAYER_TEXT.map(function (t, i) {
    var li = document.createElement("li");
    li.className = "l3d-label";
    li.dataset.layer = String(i);
    li.innerHTML = '<span class="l3d-line" aria-hidden="true"></span><span class="l3d-dot" aria-hidden="true"></span><span class="l3d-txt"></span>';
    li.querySelector(".l3d-txt").textContent = t;
    if (LAYER_SUB[i]) {
      var sub = document.createElement("span");
      sub.className = "l3d-sub";
      sub.textContent = LAYER_SUB[i];
      li.appendChild(sub);
    }
    labelsBox.appendChild(li);
    return li;
  });
  fig.insertBefore(labelsBox, fig.querySelector("figcaption"));

  /* ---------- animação: explodir, segurar, voltar ---------- */
  var explode = reduce ? 1 : 0;
  var phase = "idle", phaseT = 0;
  var PH = { wait: 0.5, opening: 1.7, open: 5.2, closing: 1.5, closed: 5.5 };
  function stepExplode(dt) {
    if (phase === "idle") return;
    phaseT += dt;
    if (phaseT < PH[phase]) {
      var k = phaseT / PH[phase];
      if (phase === "opening") explode = S.easeInOutCubic(k);
      else if (phase === "closing") explode = 1 - S.easeInOutCubic(k);
      return;
    }
    phaseT = 0;
    phase = { wait: "opening", opening: "open", open: "closing", closing: "closed", closed: "opening" }[phase];
    explode = (phase === "open" || phase === "closing") ? 1 : 0;
  }
  var GAP = 0.2;
  var yOf = [];
  function layoutLayers() {
    // de baixo para cima: solo, brita, malha, pedra
    var y = 0;
    var order = [3, 2, 1, 0];
    order.forEach(function (li, n) {
      var L = layers[li];
      L.y0 = y + n * GAP * explode;
      L.g.position.y = L.y0;
      yOf[li] = L.y0;
      y += L.h;
    });
  }

  var dm4 = new THREE.Matrix4(), dq = new THREE.Quaternion(), dsc = new THREE.Vector3(), dps = new THREE.Vector3();
  function stepDrops(dt) {
    var stone = layers[0], brita = layers[2], soil = layers[3], mesh = layers[1];
    var m4 = dm4, q = dq, sc = dsc, ps = dps;
    for (var i = 0; i < NDROP; i++) {
      var d = dropsSt[i];
      if (d.delay > 0) { d.delay -= dt; sc.set(0, 0, 0); }
      else {
        var inStone = d.y <= stone.y0 + stone.h && d.y >= stone.y0;
        var inBrita = d.y <= brita.y0 + brita.h && d.y >= brita.y0;
        var inMesh = d.y <= mesh.y0 + mesh.h + 0.01 && d.y >= mesh.y0 - 0.01;
        var inSoil = d.y <= soil.y0 + soil.h;
        var target = inStone ? 0.16 : inBrita ? 0.24 : inMesh ? 0.3 : inSoil ? 0.06 : 1.05;
        d.v = S.damp(d.v, target, 9, dt);
        d.y -= d.v * dt;
        var wob = (inStone || inBrita) ? 0.018 : 0;
        d.ph += dt * 5;
        var soilTop = soil.y0 + soil.h;
        if (d.y < soilTop) d.fade -= dt * 2.2;
        if (d.fade <= 0) { resetDrop(d, false); continue; }
        var stretch = 1 + Math.min(1.4, d.v * 1.1);
        var s = 0.015 * d.fade;
        sc.set(s, s * stretch, s);
        ps.set(d.x + Math.sin(d.ph) * wob, d.y, d.z + Math.cos(d.ph * 0.8) * wob);
      }
      m4.compose(ps, q, sc);
      dropMesh.setMatrixAt(i, m4);
    }
    dropMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------- giro automático + arrastar ---------- */
  var yaw = -0.62, yawV = 0, dragging = false, lastX = 0, idleT = 9;
  var AUTO = 0.14;
  function onDown(e) {
    dragging = true; lastX = e.clientX; idleT = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    fig.classList.add("is-dragging");
  }
  function onMove(e) {
    if (!dragging) return;
    var dx = e.clientX - lastX; lastX = e.clientX;
    var dy = yaw;
    yaw += dx * 0.009;
    yawV = (yaw - dy) * 60;
    if (reduce && !disposed) renderOnce();
  }
  function onUp(e) {
    dragging = false; idleT = 0;
    try { canvas.releasePointerCapture(e.pointerId); } catch (er) {}
    fig.classList.remove("is-dragging");
  }
  canvas.addEventListener("pointerdown", onDown, { passive: true });
  canvas.addEventListener("pointermove", onMove, { passive: true });
  canvas.addEventListener("pointerup", onUp, { passive: true });
  canvas.addEventListener("pointercancel", onUp, { passive: true });

  /* ---------- enquadramento, rótulos ---------- */
  var size = { w: 1, h: 1 };
  var target = new THREE.Vector3(0, 0.6, 0);
  /* Composição: modelo à esquerda, coluna de rótulos à direita. O modelo cabe numa faixa [margem esquerda,
   * largura - margem direita - coluna - folga]: a distância da câmera acerta a largura e o deslocamento da
   * vista acerta a posição, medindo a caixa que o modelo alcança girando (bloco aberto e a placa da base).
   * Folga modelo/rótulos >= 24 px, margem direita >= 16 px (no celular a coluna é mais estreita). */
  var LAY = { gapL: 24, right: 16 };
  var cam = { dist: 5, sx: 0, sy: 0 };
  var colW = 0;
  function applyCamera() {
    var el = 0.43;
    camera.aspect = size.w / size.h;
    camera.position.set(0, target.y + Math.sin(el) * cam.dist, Math.cos(el) * cam.dist);
    camera.lookAt(target);
    camera.setViewOffset(size.w, size.h, cam.sx, cam.sy, size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  var v3 = new THREE.Vector3();
  function project(x, y, z) {
    v3.set(x, y, z).applyMatrix4(block.matrixWorld).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * size.w, y: (-v3.y * 0.5 + 0.5) * size.h };
  }
  var lastLabelKey = "", colX = 0;
  var CORNERS = [[-BW / 2, -BD / 2], [BW / 2, -BD / 2], [BW / 2, BD / 2], [-BW / 2, BD / 2]];
  var PW = (BW + 0.34) / 2, PD = (BD + 0.3) / 2;
  var PLINTH = [[-PW, -PD], [PW, -PD], [PW, PD], [-PW, PD]];
  // caixa (px) que o modelo ocupa em qualquer giro: quinas do bloco da base ao topo aberto + quinas da placa
  function extents() {
    var saveYaw = block.rotation.y, e = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
    function add(p) { if (p.x < e.x0) e.x0 = p.x; if (p.x > e.x1) e.x1 = p.x; if (p.y < e.y0) e.y0 = p.y; if (p.y > e.y1) e.y1 = p.y; }
    for (var k = 0; k < 24; k++) {
      block.rotation.y = (k / 24) * Math.PI * 2;
      block.updateMatrixWorld(true);
      for (var yy = 0; yy <= 1.351; yy += 0.27) CORNERS.forEach(function (c) { add(project(c[0], yy, c[1])); });
      PLINTH.forEach(function (c) { add(project(c[0], 0, c[1])); add(project(c[0], -0.035, c[1])); });
    }
    block.rotation.y = saveYaw;
    block.updateMatrixWorld(true);
    return e;
  }
  function placeCamera() {
    var narrow = size.w < 420;
    colW = narrow ? 128 : 175;                        // largura da coluna de rótulos
    var left = narrow ? 8 : 16, top = 10, bottom = 10;
    var x0 = left, x1 = size.w - LAY.right - colW - LAY.gapL;
    cam.dist = narrow ? 6.3 : 5.0; cam.sx = 0; cam.sy = 0;
    applyCamera();
    for (var it = 0; it < 4; it++) {
      var e = extents();
      // largura e altura cabem na faixa (a caixa encolhe com a distância)
      var k = Math.max((e.x1 - e.x0) / Math.max(40, x1 - x0), (e.y1 - e.y0) / Math.max(40, size.h - top - bottom));
      cam.dist *= k;
      applyCamera();
      e = extents();
      cam.sx += e.x0 - x0;
      cam.sy += (e.y0 + e.y1) / 2 - (top + (size.h - bottom)) / 2;
      applyCamera();
    }
  }
  // a coluna dos rótulos começa a 24 px do ponto mais à direita que o modelo alcança girando
  function measureColumn() {
    var e = extents();
    colX = Math.round(e.x1 + LAY.gapL);
    var mw = Math.max(70, Math.floor(size.w - LAY.right - colX)) + "px";
    labelEls.forEach(function (el) { el.style.maxWidth = mw; });
    stats.layers.box = { x0: Math.round(e.x0), x1: Math.round(e.x1), y0: Math.round(e.y0), y1: Math.round(e.y1), colX: colX, w: size.w, h: size.h };
  }
  /* Âncora dos rótulos: aresta vertical da frente, do lado direito. Das quatro quinas, as duas mais
   * perto da câmera (no plano do chão) estão sempre à vista: nenhuma camada, aberta ou fechada, fica
   * entre elas e a câmera. Das duas, vale a que aparece mais à direita na tela. */
  /* Rótulos na coluna: cada um quer ficar na altura da sua camada, sem encostar no vizinho (folga fixa).
   * Blocos de rótulos que se tocam andam juntos, centrados na média do que cada um queria (o resultado
   * é exato, sem as iterações que deixavam folgas menores que a pedida). ys são os centros. */
  function spreadLabels(want, hs, gap, minY, maxY) {
    var n = want.length, cl = [];
    for (var i = 0; i < n; i++) {
      var c = { a: i, b: i, off: [0], hTot: hs[i], sum: want[i] - hs[i] / 2 };
      c.top = c.sum;
      while (cl.length) {
        var p = cl[cl.length - 1];
        if (p.top + p.hTot + gap <= c.top) break;
        // junta p e c: os deslocamentos de c passam a contar a partir do fim de p
        var base = p.hTot + gap;
        c.off.forEach(function (o) { p.off.push(base + o); });
        p.sum += c.sum - base * (c.b - c.a + 1);
        p.b = c.b; p.hTot = base + c.hTot;
        p.top = p.sum / (p.b - p.a + 1);
        cl.pop();
        c = p;
      }
      cl.push(c);
    }
    var out = new Array(n);
    cl.forEach(function (c) {
      var t = Math.min(Math.max(c.top, minY), Math.max(minY, maxY - c.hTot));
      for (var j = c.a; j <= c.b; j++) out[j] = t + c.off[j - c.a] + hs[j] / 2;
    });
    // a trava nas bordas pode reaproximar blocos vizinhos: uma passada para baixo e outra para cima
    for (var d = 1; d < n; d++) out[d] = Math.max(out[d], out[d - 1] + (hs[d - 1] + hs[d]) / 2 + gap);
    for (var u = n - 2; u >= 0; u--) out[u] = Math.min(out[u], out[u + 1] - (hs[u] + hs[u + 1]) / 2 - gap);
    return out;
  }
  var invM = new THREE.Matrix4(), camL = new THREE.Vector3();
  function anchorCorner() {
    invM.copy(block.matrixWorld).invert();
    camL.copy(camera.position).applyMatrix4(invM);
    var order = CORNERS.map(function (c, i) {
      var dx = c[0] - camL.x, dz = c[1] - camL.z;
      return { i: i, d: dx * dx + dz * dz };
    }).sort(function (a, b) { return a.d - b.d; });
    var A = CORNERS[order[0].i], B = CORNERS[order[1].i];
    return project(A[0], 0.3, A[1]).x >= project(B[0], 0.3, B[1]).x ? A : B;
  }
  function placeLabels() {
    var C = anchorCorner();
    var anchors = layers.map(function (L) { return project(C[0], L.y0 + L.h * 0.5, C[1]); });
    var hs = labelEls.map(function (el) { return el.offsetHeight || 20; });
    var ys = spreadLabels(anchors.map(function (a) { return a.y; }), hs, 12, 4, size.h - 4);
    var key = colX + ":" + anchors.map(function (a, i) { return Math.round(a.x) + "," + Math.round(a.y) + "," + Math.round(ys[i]); }).join(";");
    if (key === lastLabelKey) return;
    lastLabelKey = key;
    labelEls.forEach(function (el, i) {
      var a = anchors[i];
      var lx = colX, ly = Math.round(ys[i]);
      var dx = lx - 8 - a.x, dy = ly - a.y;
      var len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx);
      el.style.transform = "translate3d(" + lx + "px," + (ly - hs[i] / 2) + "px,0)";
      var line = el.firstChild, dot = line.nextSibling;
      line.style.transform = "translate3d(" + (a.x - lx) + "px," + (a.y - ly + hs[i] / 2) + "px,0) rotate(" + ang + "rad) scaleX(" + (Math.max(0, len) / 100).toFixed(4) + ")";
      dot.style.transform = "translate3d(" + (a.x - lx - 3) + "px," + (a.y - ly + hs[i] / 2 - 3) + "px,0)";
    });
  }

  function resize() {
    var w = Math.max(1, fig.clientWidth);
    var h = Math.round(w * 520 / 560);
    if (w === size.w && h === size.h) return false;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    placeCamera();
    measureColumn();
    lastLabelKey = "";
    return true;
  }
  var gov = makeDprGovernor(renderer, cap, function (d) { renderer.setPixelRatio(d); size.w = 0; resize(); });

  function update(dt) {
    if (!reduce) {
      stepExplode(dt);
      if (!dragging) {
        idleT += dt;
        yawV = S.damp(yawV, idleT > 2.5 ? AUTO : 0, 1.2, dt);
        yaw += yawV * dt;
      }
    }
    layoutLayers();
    block.rotation.y = yaw;
    block.updateMatrixWorld(true);
    stepDrops(reduce ? 0 : dt);
  }
  function renderOnce() {
    update(0);
    renderer.render(scene, camera);
    placeLabels();
  }
  /* Vigia: se os primeiros ~45 quadros ficarem acima de 50 ms (mediana), ou se depois vier lentidão
   * prolongada, a cena sai e o SVG do corte volta (ele não depende de nada). */
  var dog = S.frameWatchdog({ warm: 8, samples: 45, limitMs: 50 });
  var late = S.frameWatchdog({ warm: 0, samples: 90, limitMs: 60, windowMs: 4000 });
  function tick(dt, tms, raw) {
    update(dt);
    renderer.render(scene, camera);
    placeLabels();
    stats.layers.frames++;
    stats.layers.explode = explode;
    stats.layers.phase = phase;
    var v = dog.verdict === "pending" ? dog.sample(raw) : late.sample(raw);
    if (v === "slow") {
      stats.layers.bailed = dog.verdict === "slow" ? "slow" : "slow-late";
      stats.layers.probeMs = Math.round(dog.median * 10) / 10;
      api.dispose();
      return;
    }
    if (dog.verdict === "ok" && late.verdict === "ok") late.reset();
    if (tms) gov.sample(dt * 1000);
  }

  // quadro parado (movimento reduzido): camadas separadas, gotas em posições fixas pelo caminho
  function stillPose() {
    for (var k2 = 0; k2 < NDROP; k2++) {
      var dk = dropsSt[k2];
      dk.y = 0.05 + (k2 / NDROP) * 1.5; dk.delay = 0; dk.fade = 1; dk.v = 0.3;
    }
    explode = 1;
    layoutLayers();
    block.rotation.y = yaw;
    block.updateMatrixWorld(true);
    stepDrops(0.001);
  }
  resize();
  await S.nextFrame();
  await S.compileQuiet(renderer, scene, camera);
  await S.nextFrame();
  if (reduce) stillPose();
  else update(0);
  renderer.render(scene, camera);
  fig.classList.add("is-3d");
  placeLabels();
  // o texto dos rótulos só tem altura depois do is-3d; posiciona de novo no próximo quadro
  requestAnimationFrame(function () { measureColumn(); lastLabelKey = ""; placeLabels(); });

  stats.layers.initMs = Math.round(performance.now() - t0);
  performance.mark("sd:layers3d-ready");
  try { performance.measure("sd:layers3d-init", "sd:layers3d-start", "sd:layers3d-ready"); } catch (e) {}

  var loop = reduce ? null : makeLoop(fig, tick);
  var ratio = 0;
  var seen = new IntersectionObserver(function (en) {
    var e = en[en.length - 1];
    ratio = e.intersectionRatio;
    stats.layers.ratio = Math.round(ratio * 100) / 100;
    if (reduce) return;
    if (ratio >= 0.4 && phase === "idle") { phase = "wait"; phaseT = 0; }
    else if (!e.isIntersecting) { phase = "idle"; phaseT = 0; explode = 0; }
  }, { threshold: [0, 0.4] });
  seen.observe(fig);
  var ro = new ResizeObserver(function () { if (disposed) return; if (resize()) { if (!loop) renderOnce(); else placeLabels(); } });
  ro.observe(fig);

  // "reduzir movimento" ligado com a página aberta: para o loop e fica o quadro parado; desligado, volta
  function setMotion(r) {
    if (disposed) return;
    if (r) {
      if (loop) { loop.stop(); loop = null; }
      dragging = false;
      fig.classList.remove("is-dragging");
      phase = "idle"; phaseT = 0;
      stillPose();
      renderer.render(scene, camera);
      lastLabelKey = "";
      placeLabels();
    } else if (!loop) {
      explode = 0; phaseT = 0; idleT = 9;
      phase = ratio >= 0.4 ? "wait" : "idle";
      dropsSt.forEach(function (d) { resetDrop(d, true); });
      late.reset();
      loop = makeLoop(fig, tick);
    }
    stats.layers.reduced = r;
  }
  var offMotion = onMotion(setMotion);

  // perda de contexto: libera tudo (observers, listeners, rótulos) e o SVG volta
  function onLost(e) {
    e.preventDefault();
    lost = true;
    stats.layers.lost = true;
    api.dispose();
  }
  canvas.addEventListener("webglcontextlost", onLost, { once: true });

  var api = {
    dispose: function () {
      if (disposed) return;
      disposed = true;
      if (loop) loop.stop();
      offMotion();
      seen.disconnect();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("webglcontextlost", onLost);
      labelsBox.remove();
      fig.classList.remove("is-3d", "is-dragging");
      S.disposeObject(scene);
      envRT.dispose();
      renderer.dispose();
      if (!lost) { try { renderer.forceContextLoss(); } catch (er) {} }
    }
  };

  // testes (window.STONE_DREN_3D.debug): pose fixa + caixa do modelo em px CSS lida do canal alfa
  if (W.STONE_DREN_3D && W.STONE_DREN_3D.debug) stats.layers.debug = {
    THREE: THREE, renderer: renderer, scene: scene, camera: camera, dropMesh: dropMesh, ghostMesh: ghostMesh, dropMat: dropMat, ghostMat: ghostMat,
    get colX() { return colX; }, get size() { return { w: size.w, h: size.h }; },
    pose: function (y, e) {
      phase = "idle"; yaw = y; explode = e; yawV = 0;
      update(0); renderer.render(scene, camera); lastLabelKey = ""; placeLabels();
    },
    modelBox: function (withDrops) {
      var dv = dropMesh.visible, gv = ghostMesh.visible;
      if (!withDrops) dropMesh.visible = ghostMesh.visible = false;
      renderer.render(scene, camera);
      var gl = renderer.getContext(), cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
      var px = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
      dropMesh.visible = dv; ghostMesh.visible = gv;
      renderer.render(scene, camera);
      var x0 = cw, x1 = -1, y0 = ch, y1 = -1;
      for (var yy = 0; yy < ch; yy++) for (var xx = 0; xx < cw; xx++) {
        if (px[(yy * cw + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      }
      var k = size.w / cw;
      return { left: x0 * k, right: (x1 + 1) * k, top: (ch - 1 - y1) * k, bottom: (ch - y0) * k, w: size.w, h: size.h };
    },
    // só as gotas sobre fundo transparente: alfa e cor (desfeita a pré-multiplicação) dos pixels cobertos
    dropStats: function () {
      var hidden = [];
      block.children.forEach(function (o) { if (o !== dropMesh && o.visible) { o.visible = false; hidden.push(o); } });
      renderer.render(scene, camera);
      var gl = renderer.getContext(), cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
      var px = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
      hidden.forEach(function (o) { o.visible = true; });
      renderer.render(scene, camera);
      var as = [], r = 0, g = 0, b = 0;
      for (var i = 0; i < px.length; i += 4) {
        var a = px[i + 3];
        if (a > 6) { as.push(a); r += px[i] * 255 / a; g += px[i + 1] * 255 / a; b += px[i + 2] * 255 / a; }
      }
      as.sort(function (x, y) { return x - y; });
      var n = as.length || 1;
      return { pixels: as.length, alphaMedian: as[n >> 1] / 255, alphaP95: as[Math.floor(n * 0.95)] / 255, alphaMax: as[n - 1] / 255,
        shareAbove80: as.filter(function (x) { return x > 204; }).length / n, meanRGB: [Math.round(r / n), Math.round(g / n), Math.round(b / n)] };
    }
  };
  return api;
}

/* ======================================================================================
 * INÍCIO
 * ==================================================================================== */

function fail(where) {
  return function (err) {
    // o fallback (foto + chuva 2D, SVG do corte) continua na tela
    stats[where] = Object.assign(stats[where] || {}, { failed: true });
    if (where === "hero") { docEl.classList.remove("has-hero3d"); heroSettle(); }
    try { console.info("[Stone Dren] 3D (" + where + ") indisponível, mantendo a versão 2D.", err && err.message ? err.message : ""); } catch (e) {}
  };
}

function nearNow(el, margin) {
  var r = el.getBoundingClientRect();
  return r.bottom > -margin && r.top < (W.innerHeight || docEl.clientHeight) + margin;
}

// a sonda de WebGL2 começou na avaliação do módulo; as montagens esperam o veredito, o load e um momento ocioso.
// Sem WebGL2 por hardware (ou com economia de dados) nada do three é baixado: fica a versão 2D.
afterLoad(function () { verdictP.then(start); });
function start(hw) {
  if (!hw) return;
  var heroCanvas = document.getElementById("hero3d");
  var heroEl = heroCanvas && (heroCanvas.closest(".hero") || heroCanvas);
  // o hero vai montar agora (está perto da tela)? então o corte espera por ele
  var heroFirst = !!(heroEl && nearNow(heroEl, 200));
  if (heroEl) {
    if (heroFirst) warmHero();
    whenNear(heroEl, "200px", function () { initHero(heroCanvas).catch(fail("hero")); });
  } else {
    heroSettle();
  }
  var fig = document.getElementById("layersFig");
  if (fig && fig.querySelector("#layers3d")) {
    whenNear(fig, "350px", function () {
      // o corte monta depois do hero (pronto ou desistiu, no máximo 6 s) e num momento ocioso:
      // as duas montagens não disputam a thread logo depois do carregamento
      var gate = heroFirst ? Promise.race([heroSettled, new Promise(function (r) { setTimeout(r, 6000); })]) : Promise.resolve();
      gate.then(function () { onIdle(function () { initLayers(fig).catch(fail("layers")); }); });
    });
  }
}
