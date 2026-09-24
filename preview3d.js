/* Stone Dren · amostra 3D da calculadora (corpo de prova do piso em corte).
 *
 * API
 *   import { mountPreview } from "./preview3d.js";
 *   const p = mountPreview(canvas, opts);   // lança erro se não houver WebGL2 (use o corte 2D)
 *   p.update(state);                        // pode chamar a qualquer momento, inclusive antes de p.ready
 *   p.setVisible(bool);                     // pausa/retoma (a amostra também pausa sozinha fora da tela e com a aba oculta)
 *   p.setReducedMotion(bool);               // liga/desliga o quadro parado (a mudança ao vivo do sistema já é seguida sozinha)
 *   p.dispose();                            // libera GPU, observers e listeners
 *   await p.ready;                          // resolve quando o primeiro quadro com as fotos foi desenhado
 *
 *   state = {
 *     cor: "branca" | "palha" | "cinza" | "preta" | "ouro",
 *     espessuraMm: número de 10 a 40 (camada de pedra + resina),
 *     base: "solo" | "contrapiso",
 *     britaCm: número (0 quando contrapiso; só aparece com base "solo"),
 *     malha: boolean,
 *     uso: "jardim" | "calcada" | "piscina" | "garagem"
 *   }
 *   opts = {
 *     reducedMotion?: boolean (valor inicial; padrão: prefers-reduced-motion; sem giro, cada update desenha
 *                     um quadro; se a preferência do sistema mudar com a página aberta, a nova vale),
 *     maxDpr?: number (padrão 1.75 desktop, 1.25 tela estreita/toque),
 *     autoRotate?: boolean (padrão true),
 *     onLost?: function () (perda de contexto WebGL, ou GPU lenta demais nos primeiros quadros:
 *                           a amostra já se desmontou sozinha e a calculadora volta ao corte 2D)
 *   }
 *
 * Só roda com WebGL2 por hardware: com WebGL por software (SwiftShader, llvmpipe, WARP) mountPreview
 * lança erro e a calculadora fica no corte 2D. Para nem baixar este módulo (e o three) sem GPU, leia antes
 * window.StoneDren3D.hw (publicado pelo scenes.js na avaliação do módulo, também no evento
 * "stonedren:webgl-verdict"): false = fique no corte 2D. O mesmo veredito é reaproveitado aqui. Se os primeiros ~45 quadros passarem de 50 ms
 * (mediana), a amostra também desiste e chama onLost (e o evento "stonedren:preview3d-lost" no canvas).
 *
 * O canvas pode ter qualquer tamanho (ResizeObserver) e o fundo é transparente.
 * Camadas, de cima para baixo: pedra natural + resina (cor escolhida, foto real), laje de concreto
 * (uso garagem com malha, malha embutida), malha sob a pedra (demais usos com malha), contrapiso
 * existente (base contrapiso), brita (base solo, britaCm > 0) e solo compactado (base solo).
 * Escala: 1 unidade = 240 mm na horizontal; a vertical é exagerada 1,5x de forma igual para todas as camadas.
 * Espessuras de laje, contrapiso e solo são ilustrativas.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as S from "./stone3d.js";

var MM = 1.5 / 240;            // unidades por milímetro na vertical (exagero 1,5x)
var BW = 1.0, BD = 0.7;         // 240 mm x 168 mm de amostra
var ILUS = { laje: 70, contrapiso: 50, solo: 55 };

function norm(st) {
  st = st || {};
  var cor = S.CORES.indexOf(st.cor) >= 0 ? st.cor : "palha";
  var esp = Math.max(10, Math.min(40, Number(st.espessuraMm) || 15));
  var base = st.base === "contrapiso" ? "contrapiso" : "solo";
  var brita = base === "solo" ? Math.max(0, Math.min(30, Number(st.britaCm) || 0)) : 0;
  var uso = ["jardim", "calcada", "piscina", "garagem"].indexOf(st.uso) >= 0 ? st.uso : "calcada";
  return { cor: cor, espessuraMm: esp, base: base, britaCm: brita, malha: !!st.malha, uso: uso };
}

export function mountPreview(canvas, opts) {
  opts = opts || {};
  if (!canvas || !canvas.getContext) throw new Error("canvas inválido");
  var reduce = opts.reducedMotion != null ? !!opts.reducedMotion : S.prefersReducedMotion();
  var low = S.isLowTier();
  var t0 = performance.now();

  var renderer = S.makeRenderer(canvas, { antialias: true, alpha: true, exposure: 1.08 });
  var cap = Math.min(opts.maxDpr || 9, S.dprCap());
  renderer.setPixelRatio(cap);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(24, 1, 0.05, 40);
  scene.environmentIntensity = 0.6;
  var envRT = null;   // o ambiente (reflexos) é gerado nos próximos quadros, fora da montagem síncrona

  var key = new THREE.DirectionalLight(0xfff0dc, 2.3);
  key.position.set(-1.8, 3.0, 2.4);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0x9cc7d8, 0.8);
  rim.position.set(2.4, 1.2, -2.2);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a4c72, 0x100c08, 0.75));

  var stack = new THREE.Group();   // gira; origem = topo da pedra
  scene.add(stack);

  /* ---------- camadas ---------- */
  var pebbleGeos = [0, 1, 2].map(function (i) { return S.pebbleGeometry(i + 11, { detail: 1, bump: 0.22 }); });
  var gravelGeos = [0, 1, 2].map(function (i) { return S.gravelGeometry(i + 21); });
  var stoneMat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.85, clearcoatRoughness: 0.18 });
  var gravelMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, envMapIntensity: 0.7 });

  var palCache = {};
  function paletteFor(cor) { return palCache[cor] || S.paletteColors(cor); }

  var stoneMax = 40 * MM;
  var stone = S.pebbleSlab({
    w: BW, d: BD, maxH: stoneMax, h: 15 * MM, spacing: low ? 0.042 : 0.034, size: low ? 0.024 : 0.02, seed: 31,
    geos: pebbleGeos, mat: stoneMat, colors: paletteFor("palha"), core: 0x17110b, flatTop: true
  });
  stack.add(stone.group);

  var britaMax = 30 * 10 * MM;
  function cols(list) { return list.map(function (h) { return new THREE.Color(h); }); }
  var greys = cols(["#4a4c52", "#5d6068", "#6f727a", "#80838a", "#90939a", "#3c3e44", "#a3a5aa"]);
  // com pedra cinza ou preta, a brita fica mais escura e azulada: as duas camadas não se confundem
  var greysCool = cols(["#2c323c", "#363d48", "#414955", "#4c5563", "#586271", "#262b33", "#66707f"]);
  function britaFor(cor) { return cor === "cinza" || cor === "preta" ? greysCool : greys; }
  var brita = S.pebbleSlab({
    w: BW, d: BD, maxH: britaMax, h: 0.2, spacing: low ? 0.075 : 0.06, size: low ? 0.038 : 0.032, seed: 41,
    geos: gravelGeos, mat: gravelMat, colors: greys, core: 0x1d1f23, flatTop: true
  });
  stack.add(brita.group);

  var soilTex = S.soilTexture(256), concTex = S.concreteTexture(256), contraTex = S.concreteTexture(256);
  var soilMat = new THREE.MeshStandardMaterial({ map: soilTex, roughness: 0.96, color: 0xd9bfa3 });
  var slabMat = new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.88, color: 0xc9c7c2 });
  var contraMat = new THREE.MeshStandardMaterial({ map: contraTex, roughness: 0.92, color: 0x9d9990 });
  function boxLayer(mat) {
    var m = new THREE.Mesh(S.worldBox(BW, 1, BD, 1.4), mat);
    m.userData.h = -1;
    stack.add(m);
    return m;
  }
  var slab = boxLayer(slabMat), contra = boxLayer(contraMat), soil = boxLayer(soilMat);
  function sizeBox(m, top, h) {
    m.visible = h > 0.002;
    if (!m.visible) return;
    if (Math.abs(m.userData.h - h) > 1e-4) {
      m.geometry.dispose();
      m.geometry = S.worldBox(BW - 0.004, h, BD - 0.004, 1.4);
      m.userData.h = h;
    }
    m.position.y = top - h / 2;
  }

  // malha de reforço: as pontas das barras ficam rentes à face cortada (sem espetar para fora)
  var mesh = new THREE.Group();
  (function () {
    var bars = [], step = 0.085, r = 0.0075;
    for (var x = -BW / 2 + step / 2; x < BW / 2; x += step) bars.push([x, 0, r, BD - 0.002, r * 1.5]);
    for (var z = -BD / 2 + step / 2; z < BD / 2; z += step) bars.push([0, z, BW - 0.002, r, r * 0.5]);
    var im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd6d0c2, metalness: 0.7, roughness: 0.34 }), bars.length);
    var m4 = new THREE.Matrix4();
    bars.forEach(function (b, i) { m4.makeScale(b[2], r, b[3]).setPosition(b[0], b[4], b[1]); im.setMatrixAt(i, m4); });
    mesh.add(im);
  })();
  stack.add(mesh);

  // sombra de contato sob a amostra
  var shadowTex = (function () {
    var c = document.createElement("canvas"); c.width = c.height = 128;
    var g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(0.55, "rgba(0,0,0,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  var shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  /* ---------- estado e transições ---------- */
  var cur = { stone: 15 * MM, slab: 0, contra: 0, brita: 0.2, soil: ILUS.solo * MM, mesh: 1, meshInSlab: 0 };
  var tgt = Object.assign({}, cur);
  var state = norm({});
  var colorK = 1, fov = { dist: 3.2, y: -0.3 };

  function targetsFrom(st) {
    var laje = st.uso === "garagem" && st.malha;
    tgt.stone = st.espessuraMm * MM;
    tgt.slab = laje ? ILUS.laje * MM : 0;
    tgt.contra = st.base === "contrapiso" ? ILUS.contrapiso * MM : 0;
    tgt.brita = st.base === "solo" ? st.britaCm * 10 * MM : 0;
    tgt.soil = st.base === "solo" ? ILUS.solo * MM : 0;
    tgt.mesh = st.malha ? 1 : 0;
    tgt.meshInSlab = laje ? 1 : 0;
  }

  // uma fresta mínima entre camadas desenha a linha de corte e separa camadas de cor parecida
  // (a de baixo da pedra é um pouco maior: é a linha que separa a pedra da base)
  var SEAM = 0.006, SEAM_STONE = 0.011;
  function seam(h) { return Math.min(SEAM, h * 0.5); }
  function layout() {
    var y = 0;
    stone.setHeight(cur.stone);   // só recalcula quando a espessura muda (pebbleSlab guarda a última)
    y -= cur.stone + SEAM_STONE;
    // malha: numa fresta sob a pedra (fica à vista no corte) ou no terço de cima da laje
    var meshGap = cur.mesh * (1 - cur.meshInSlab) * 0.05;
    var meshY = y - 0.002 - meshGap * 0.3 - cur.meshInSlab * cur.slab * 0.35;
    y -= meshGap;
    mesh.position.y = meshY;
    var ms = Math.max(0.001, cur.mesh);
    mesh.scale.set(ms, ms, ms);
    mesh.visible = cur.mesh > 0.01;
    sizeBox(slab, y, cur.slab); y -= cur.slab + seam(cur.slab);
    sizeBox(contra, y, cur.contra); y -= cur.contra + seam(cur.contra);
    brita.group.position.y = y;
    brita.group.visible = cur.brita > 0.004;
    if (brita.group.visible) brita.setHeight(cur.brita);
    y -= cur.brita + seam(cur.brita);
    sizeBox(soil, y, cur.soil); y -= cur.soil;
    shadow.position.y = y - 0.002;
    return -y;
  }

  function fit(total, dt) {
    var w = size.w, h = size.h;
    var aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    var r = Math.sqrt(0.25 * BW * BW + 0.25 * BD * BD + 0.25 * total * total) * 0.9;
    var vf = THREE.MathUtils.degToRad(camera.fov / 2);
    var hf = Math.atan(Math.tan(vf) * aspect);
    var dist = r / Math.sin(Math.min(vf, hf));
    var yMid = -total / 2;
    if (dt == null) { fov.dist = dist; fov.y = yMid; }
    else { fov.dist = S.damp(fov.dist, dist, 5, dt); fov.y = S.damp(fov.y, yMid, 5, dt); }
    var el = 0.36;
    camera.position.set(0, fov.y + Math.sin(el) * fov.dist, Math.cos(el) * fov.dist);
    camera.lookAt(0, fov.y, 0);
    camera.updateProjectionMatrix();
  }

  var britaCols = greys;
  function applyColor(cor, instant) {
    stone.setColors(paletteFor(cor), instant || reduce);
    colorK = instant || reduce ? 1 : 0;
    var bc = britaFor(cor);
    if (bc !== britaCols) { britaCols = bc; brita.setColors(bc, true); }
  }

  /* ---------- tamanho, loop, visibilidade ---------- */
  var size = { w: 0, h: 0 };
  function resize() {
    var w = Math.round(canvas.clientWidth), h = Math.round(canvas.clientHeight);
    if (!w || !h || (w === size.w && h === size.h)) return false;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    return true;
  }
  var yaw = -0.6, visible = true, onScreen = true, running = false, raf = 0, last = 0, disposed = false, cleaned = false, frames = 0;
  var autoRotate = opts.autoRotate !== false && !reduce;

  /* "Reduzir movimento" ligado ou desligado com a página aberta: a preferência do sistema passa a valer
   * (opts.reducedMotion é só o valor inicial). Ligado: o loop para já e fica um quadro parado com o estado
   * atual; desligado: o giro volta. p.setReducedMotion(bool) faz o mesmo por código. */
  function setReduce(r) {
    r = !!r;
    if (disposed || r === reduce) return;
    reduce = r;
    autoRotate = opts.autoRotate !== false && !reduce;
    if (reduce) {
      running = false;
      cancelAnimationFrame(raf);
      settle(null);
      draw(null);
    } else {
      kick();
    }
  }
  var reduceMQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function onReducePref(e) { setReduce(e.matches); }
  if (reduceMQ) {
    if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", onReducePref);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReducePref);
  }

  function settle(dt) {
    var moving = false;
    for (var k in tgt) {
      var a = cur[k], b = tgt[k];
      if (Math.abs(a - b) > 1e-4) { cur[k] = dt == null ? b : S.damp(a, b, 7, dt); moving = true; }
      else cur[k] = b;
    }
    if (colorK < 1) {
      colorK = dt == null ? 1 : Math.min(1, colorK + dt * 2.2);
      stone.paint(S.easeInOutCubic(colorK));
      moving = true;
    }
    return moving;
  }
  var compiled = false;
  function draw(dt) {
    if (!compiled) return false;
    if (!size.w) resize();
    if (!size.w) return;
    var moving = settle(dt);
    var total = layout();
    fit(total, dt);
    stack.rotation.y = yaw;
    renderer.render(scene, camera);
    frames++;
    return moving;
  }
  // vigia: GPU lenta demais (mediana acima de 50 ms nos primeiros ~45 quadros) volta para o corte 2D
  var dog = S.frameWatchdog({ warm: 8, samples: 45, limitMs: 50 });
  function tick(t) {
    if (!running) return;
    var raw = last ? t - last : 0;
    var dt = last ? Math.min(0.2, raw / 1000) : 1 / 60;
    last = t;
    if (autoRotate) yaw += dt * 0.32;
    var moving = draw(dt);
    if (!compiled) { running = false; return; }
    if (dog.sample(raw) === "slow") { giveUp("slow"); return; }
    if (!autoRotate && !moving) { running = false; return; }
    raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (disposed) return;
    var should = visible && onScreen && !document.hidden;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(tick); }
    else if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }
  var ro = new ResizeObserver(function () { if (resize()) { if (!running) draw(null); } });
  ro.observe(canvas);
  var io = new IntersectionObserver(function (en) { onScreen = en[en.length - 1].isIntersecting; kick(); });
  io.observe(canvas);
  function onVis() { kick(); }
  document.addEventListener("visibilitychange", onVis);

  var lostCtx = false;
  function giveUp(reason) {
    if (cleaned) return;
    if (window.StoneDren3D) window.StoneDren3D.previewBailed = reason;
    api.dispose();
    try { canvas.dispatchEvent(new CustomEvent("stonedren:preview3d-lost", { bubbles: true })); } catch (er) {}
    if (typeof opts.onLost === "function") opts.onLost();
  }
  function onLost(e) {
    e.preventDefault();
    lostCtx = true;
    giveUp("context-lost");
  }
  canvas.addEventListener("webglcontextlost", onLost);

  // ambiente e shaders em passos separados (sem tarefa longa quando a calculadora monta a amostra):
  // materiais da sala compilados em paralelo (KHR_parallel_shader_compile), PMREM num quadro, cena em outro
  var room = new RoomEnvironment();
  var pmrem = new THREE.PMREMGenerator(renderer);
  var envP = S.compileQuiet(renderer, room, camera).then(S.nextFrame).then(function () {
    if (disposed) return;
    envRT = pmrem.fromScene(room, 0.03);
    scene.environment = envRT.texture;
  }).catch(function () {}).then(function () {
    if (room.dispose) room.dispose();
    pmrem.dispose();
  });
  var compiledP = envP.then(S.nextFrame).then(function () {
    if (disposed) return;
    return S.compileQuiet(renderer, scene, camera);
  }).then(function () {
    compiled = true;
    if (!disposed) { draw(null); kick(); }
  });
  // fotos reais: a paleta da cor sai da própria foto (cai nos quantis enquanto carrega)
  var ready = Promise.all(S.CORES.map(function (c) {
    return S.loadImage(S.fotoUrl(c)).then(function (img) { palCache[c] = S.photoColors(img, 160); }).catch(function () {});
  }).concat([compiledP])).then(function () {
    if (disposed) return;
    applyColor(state.cor, true);
    draw(null);
    if (window.StoneDren3D) window.StoneDren3D.preview = { initMs: Math.round(performance.now() - t0), frames: frames };
  });

  resize();
  targetsFrom(state);
  settle(null);
  draw(null);
  kick();

  var api = {
    ready: ready,
    update: function (st) {
      if (disposed) return;
      var n = norm(st);
      var colorChanged = n.cor !== state.cor;
      state = n;
      targetsFrom(n);
      if (colorChanged) applyColor(n.cor, false);
      if (reduce) { settle(null); draw(null); return; }
      if (!running) kick();
      if (!running && visible && onScreen) draw(null);
    },
    setVisible: function (v) { visible = !!v; kick(); },
    setReducedMotion: function (v) { setReduce(v); },
    get stats() { return { frames: frames, dpr: renderer.getPixelRatio(), running: running, reduced: reduce }; },
    dispose: function () {
      if (cleaned) return;
      cleaned = true;
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      if (reduceMQ) {
        if (reduceMQ.removeEventListener) reduceMQ.removeEventListener("change", onReducePref);
        else if (reduceMQ.removeListener) reduceMQ.removeListener(onReducePref);
      }
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      S.disposeObject(scene);
      pebbleGeos.concat(gravelGeos).forEach(function (g) { g.dispose(); });
      if (envRT) envRT.dispose();
      renderer.dispose();
      if (!lostCtx) { try { renderer.forceContextLoss(); } catch (er) {} }
    }
  };
  return api;
}
