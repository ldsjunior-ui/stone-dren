/* Stone Dren · amostra 3D da calculadora (corpo de prova do piso em corte), uma por ambiente.
 *
 * Um contexto WebGL só, num canvas só, para até 8 amostras: o canvas fica por cima de uma grade DOM
 * com uma célula por ambiente e cada amostra é desenhada no retângulo da própria célula
 * (setViewport + setScissor). A página principal já tem o hero e o corte explodido: um contexto por
 * ambiente passaria do limite do navegador e derrubaria um deles.
 *
 * API
 *   import { mountPreview } from "./preview3d.js";
 *   const p = mountPreview(canvas, opts);   // lança erro se não houver WebGL2 (use o corte 2D)
 *   p.update(lista);                        // até 8 itens (o resto é ignorado); pode chamar antes de p.ready
 *   p.update(item);                         // um objeto solto continua aceito: vira uma lista de 1
 *   p.setFoco(id);                          // o ambiente aberto: só ele gira, os outros ficam de frente
 *   p.setVisible(bool);                     // pausa/retoma (a amostra também pausa sozinha fora da tela e com a aba oculta)
 *   p.setReducedMotion(bool);               // liga/desliga o quadro parado (a mudança ao vivo do sistema já é seguida sozinha)
 *   p.stats                                 // { frames, dpr, running, reduced, samples, pending, still, steps, median }
 *   p.dispose();                            // libera GPU, observers e listeners
 *   await p.ready;                          // resolve quando o primeiro quadro com as fotos foi desenhado
 *
 *   item = {
 *     id: texto (o mesmo da célula; sem id, "s0", "s1"...),
 *     n: "01", rotulo: "Calçada" (só identificação; a legenda de verdade é DOM, na célula),
 *     cor: "branca" | "palha" | "cinza" | "preta" | "ouro",
 *     resina: "epoxi" | "pu" (só rótulo: a amostra NÃO desenha diferença entre epóxi e PU),
 *     espessuraMm: número de 10 a 40 (camada de pedra + resina),
 *     base: "solo" | "contrapiso",
 *     britaCm: número (0 quando contrapiso; só aparece com base "solo"),
 *     malha: boolean,
 *     uso: "jardim" | "calcada" | "piscina" | "garagem",
 *     estado: "ok" | "incompleto" | "consulte" (só rótulo; a célula DOM mostra o estado nomeado)
 *   }
 *   opts = {
 *     cellFor?: function (id) -> HTMLElement (a área da célula onde a amostra é desenhada; o retângulo
 *               dela vira o viewport). Sem cellFor, o próprio canvas é dividido em grade,
 *     observe?: HTMLElement (a grade: mudou de tamanho, redesenha),
 *     reducedMotion?: boolean (valor inicial; padrão: prefers-reduced-motion; sem giro, cada update desenha
 *                     um quadro; se a preferência do sistema mudar com a página aberta, a nova vale),
 *     maxDpr?: number (padrão 1.75 desktop, 1.25 tela estreita/toque; com 2 amostras ou mais o teto
 *              cai para 1.25 no desktop e 1 no celular, porque o canvas cobre a grade inteira),
 *     autoRotate?: boolean (padrão true),
 *     onLost?: function () (perda de contexto WebGL, ou GPU lenta demais mesmo depois da escada:
 *                           a amostra já se desmontou sozinha e a calculadora volta ao corte 2D)
 *   }
 *
 * Só roda com WebGL2 por hardware: com WebGL por software (SwiftShader, llvmpipe, WARP) mountPreview
 * lança erro e a calculadora fica no corte 2D. Para nem baixar este módulo (e o three) sem GPU, leia antes
 * window.StoneDren3D.hw (publicado pelo scenes.js na avaliação do módulo, também no evento
 * "stonedren:webgl-verdict"): false = fique no corte 2D. O mesmo veredito é reaproveitado aqui.
 *
 * Vigia de desempenho (mediana de ~45 quadros acima de 50 ms), em escada antes de desistir:
 *   1) baixa o DPR (primeiro o valor estimado para caber, depois 1x; a regra do hero);
 *   2) quadro parado (sem giro; cada mudança desenha um quadro), medido de novo com limite de 120 ms;
 *   3) só então desiste: onLost e o evento "stonedren:preview3d-lost" no canvas (o corte 2D mostra todos).
 * O vigia volta a medir quando o número de amostras cresce (depois de montar as novas). Com
 * window.STONE_DREN_3D = { watchdog: false } ele não reprova nunca.
 * Orçamento: com 4 amostras ou mais, todas usam a densidade de pedrinhas da tela baixa (também no
 * desktop); cada amostra nova é montada num quadro próprio (sem tarefa longa); a amostra de um
 * ambiente removido fica guardada e é reaproveitada pelo próximo.
 *
 * O fundo do canvas é transparente (o fundo fica em cada célula). Como o buffer não é preservado entre
 * quadros, todas as células são redesenhadas em cada quadro desenhado.
 * Camadas, de cima para baixo: pedra natural + resina (cor escolhida, foto real), laje de concreto
 * (uso garagem com malha, malha embutida), malha sob a pedra (demais usos com malha), contrapiso
 * existente (base contrapiso), brita (base solo, britaCm > 0) e solo compactado (base solo).
 * Escala: 1 unidade = 240 mm, real nos três eixos (sem exagero na vertical), e a MESMA em todas as
 * células (a pilha mais alta define o enquadramento). Em cima de cada amostra fica uma lata de
 * refrigerante de 350 ml sem marca (66 mm x 122 mm) como referência de tamanho e de espessura; ela entra
 * no enquadramento. Espessuras de laje, contrapiso e solo são ilustrativas.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as S from "./stone3d.js";

var MM = 1 / 240;              // unidades por milímetro (escala real, a mesma da lata de referência)
var BW = 1.0, BD = 0.7;         // 240 mm x 168 mm de amostra
var ILUS = { laje: 70, contrapiso: 50, solo: 55 };
var LATA_H = 122 * MM, LATA_R = 33 * MM;   // lata de 350 ml: 122 mm de altura, 66 mm de diâmetro
var MAX_AMOSTRAS = 8;
var USOS = ["jardim", "calcada", "piscina", "garagem"];
var ESTADOS = ["ok", "incompleto", "consulte"];
var YAW0 = -0.6;               // ângulo de repouso (três quartos)
var LIMITE_MS = 50, LIMITE_PARADO_MS = 120;

function texto(v, max) { return v == null ? "" : String(v).slice(0, max || 40); }

function norm(st, i) {
  st = st && typeof st === "object" ? st : {};
  var cor = S.CORES.indexOf(st.cor) >= 0 ? st.cor : "areia";
  var esp = Math.max(10, Math.min(40, Number(st.espessuraMm) || 15));
  var base = st.base === "contrapiso" ? "contrapiso" : "solo";
  var brita = base === "solo" ? Math.max(0, Math.min(30, Number(st.britaCm) || 0)) : 0;
  var uso = USOS.indexOf(st.uso) >= 0 ? st.uso : "calcada";
  var id = st.id != null && st.id !== "" ? texto(st.id, 40) : "s" + (i || 0);
  return {
    id: id, n: texto(st.n, 4), rotulo: texto(st.rotulo, 60),
    resina: st.resina === "pu" ? "pu" : "epoxi",
    estado: ESTADOS.indexOf(st.estado) >= 0 ? st.estado : "ok",
    cor: cor, espessuraMm: esp, base: base, britaCm: brita, malha: !!st.malha, uso: uso
  };
}
// lista de até 8 itens; um objeto solto vira lista de 1; id repetido vira outra amostra
function normLista(x) {
  var lista = Array.isArray(x) ? x : (x && typeof x === "object" ? [x] : []);
  var vistos = new Set(), out = [];
  for (var i = 0; i < lista.length && out.length < MAX_AMOSTRAS; i++) {
    if (!lista[i] || typeof lista[i] !== "object") continue;
    var it = norm(lista[i], out.length);
    while (vistos.has(it.id)) it.id = it.id + "~";
    vistos.add(it.id);
    out.push(it);
  }
  return out;
}

export function mountPreview(canvas, opts) {
  opts = opts || {};
  if (!canvas || !canvas.getContext) throw new Error("canvas inválido");
  var reduce = opts.reducedMotion != null ? !!opts.reducedMotion : S.prefersReducedMotion();
  var low = S.isLowTier();
  var t0 = performance.now();
  var cellFor = typeof opts.cellFor === "function" ? opts.cellFor : null;
  var fixo = !!(window.STONE_DREN_3D && window.STONE_DREN_3D.fixedDpr);

  var renderer = S.makeRenderer(canvas, { antialias: true, alpha: true, exposure: 1.08 });
  // teto de uma amostra só; a escada do vigia pode baixar (teto) e, com várias, vale o menor
  var teto = Math.min(opts.maxDpr || 9, S.dprCap());
  var TETO_MULTI = low ? 1 : 1.25;
  var multi = false;
  function tetoAtual() { return fixo ? S.dprCap() : (multi ? Math.min(teto, TETO_MULTI) : teto); }
  renderer.setPixelRatio(tetoAtual());

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

  /* ---------- recursos compartilhados por todas as amostras ---------- */
  var pebbleGeos = [0, 1, 2].map(function (i) { return S.pebbleGeometry(i + 11, { detail: 1, bump: 0.22 }); });
  var gravelGeos = [0, 1, 2].map(function (i) { return S.gravelGeometry(i + 21); });
  // um material de pedra só: a cor vem por instância, então as 5 cores usam o mesmo material.
  // Epóxi e PU não mudam o material (a amostra não modela a diferença; seria informação falsa).
  var stoneMat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.85, clearcoatRoughness: 0.18 });
  var gravelMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, envMapIntensity: 0.7 });

  var palCache = {};
  function paletteFor(cor) { return palCache[cor] || S.paletteColors(cor); }

  var stoneMax = 40 * MM;
  var britaMax = 30 * 10 * MM;
  function cols(list) { return list.map(function (h) { return new THREE.Color(h); }); }
  var greys = cols(["#4a4c52", "#5d6068", "#6f727a", "#80838a", "#90939a", "#3c3e44", "#a3a5aa"]);
  // com pedra cinza ou preta, a brita fica mais escura e azulada: as duas camadas não se confundem
  var greysCool = cols(["#2c323c", "#363d48", "#414955", "#4c5563", "#586271", "#262b33", "#66707f"]);
  function britaFor(cor) { return cor === "cinza" || cor === "preta" || cor === "madri" || cor === "submarino" || cor === "fullblack" || cor === "ouro-negro" ? greysCool : greys; }

  var soilTex = S.soilTexture(256), concTex = S.concreteTexture(256), contraTex = S.concreteTexture(256);
  var soilMat = new THREE.MeshStandardMaterial({ map: soilTex, roughness: 0.96, color: 0xd9bfa3 });
  var slabMat = new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.88, color: 0xc9c7c2 });
  var contraMat = new THREE.MeshStandardMaterial({ map: contraTex, roughness: 0.92, color: 0x9d9990 });

  // malha de reforço: as pontas das barras ficam rentes à face cortada (sem espetar para fora)
  var barras = (function () {
    var bars = [], step = 0.085, r = 0.0075, out = [];
    for (var x = -BW / 2 + step / 2; x < BW / 2; x += step) bars.push([x, 0, r, BD - 0.002, r * 1.5]);
    for (var z = -BD / 2 + step / 2; z < BD / 2; z += step) bars.push([0, z, BW - 0.002, r, r * 0.5]);
    bars.forEach(function (b) { out.push(new THREE.Matrix4().makeScale(b[2], r, b[3]).setPosition(b[0], b[4], b[1])); });
    return out;
  })();
  var barGeo = new THREE.BoxGeometry(1, 1, 1);

  // lata de referência (350 ml, alumínio liso, sem marca): perfil girado em mm, de baixo para cima
  var lataGeo = (function () {
    var p = [[0, 4], [19, 2.6], [23.5, 0], [26, 0.4], [30.5, 3.6], [33, 9], [33, 104], [31, 111], [27.6, 118],
      [27, 120.6], [27.4, 122], [26.6, 122.2], [25.6, 120.4], [24.6, 119.6], [0, 119.6]];
    var g = new THREE.LatheGeometry(p.map(function (q) { return new THREE.Vector2(q[0] * MM, q[1] * MM); }), 48);
    g.computeVertexNormals();
    return g;
  })();
  var lataMat = new THREE.MeshStandardMaterial({ color: 0xc9ced5, metalness: 0.92, roughness: 0.26, side: THREE.DoubleSide });
  var anelGeo = new THREE.BoxGeometry(19 * MM, 0.8 * MM, 11 * MM);
  var anelMat = new THREE.MeshStandardMaterial({ color: 0xb3b8bf, metalness: 0.9, roughness: 0.32 });
  // canto do fundo à direita (no ângulo de repouso): não cobre a face de corte da frente
  var LATA_X = BW / 2 - LATA_R - 0.035, LATA_Z = -(BD / 2 - LATA_R - 0.035);
  var barMat = new THREE.MeshStandardMaterial({ color: 0xd6d0c2, metalness: 0.7, roughness: 0.34 });

  // sombra de contato sob a amostra
  var shadowTex = (function () {
    var c = document.createElement("canvas"); c.width = c.height = 128;
    var g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(0.55, "rgba(0,0,0,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  var shadowGeo = new THREE.PlaneGeometry(1.9, 1.5);
  var shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });

  /* ---------- uma amostra (pilha de camadas) ---------- */
  function boxLayer(parent, mat) {
    var m = new THREE.Mesh(S.worldBox(BW, 1, BD, 1.4), mat);
    m.userData.h = -1;
    parent.add(m);
    return m;
  }
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
  function criarAmostra(baixa) {
    var raiz = new THREE.Group();          // não gira: leva a sombra
    raiz.visible = false;                  // só aparece enquanto a própria célula é desenhada
    var stack = new THREE.Group();         // gira; origem = topo da pedra
    raiz.add(stack);
    var stone = S.pebbleSlab({
      w: BW, d: BD, maxH: stoneMax, h: 15 * MM, spacing: baixa ? 0.042 : 0.034, size: baixa ? 0.024 : 0.02, seed: 31,
      geos: pebbleGeos, mat: stoneMat, colors: paletteFor("palha"), core: 0x17110b, flatTop: true, trim: true, reuse: true
    });
    stack.add(stone.group);
    var brita = S.pebbleSlab({
      w: BW, d: BD, maxH: britaMax, h: 0.2, spacing: baixa ? 0.075 : 0.06, size: baixa ? 0.038 : 0.032, seed: 41,
      geos: gravelGeos, mat: gravelMat, colors: greys, core: 0x1d1f23, flatTop: true, trim: true, reuse: true
    });
    stack.add(brita.group);
    var slab = boxLayer(stack, slabMat), contra = boxLayer(stack, contraMat), soil = boxLayer(stack, soilMat);
    var malha = new THREE.Group();
    var im = new THREE.InstancedMesh(barGeo, barMat, barras.length);
    barras.forEach(function (m4, i) { im.setMatrixAt(i, m4); });
    malha.add(im);
    stack.add(malha);
    var lata = new THREE.Group();
    lata.add(new THREE.Mesh(lataGeo, lataMat));
    var anel = new THREE.Mesh(anelGeo, anelMat);
    anel.position.set(5 * MM, 120 * MM, 0);
    lata.add(anel);
    lata.position.set(LATA_X, 0.0015, LATA_Z);
    lata.rotation.y = 0.9;
    stack.add(lata);
    var shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    raiz.add(shadow);
    scene.add(raiz);
    var cur = { stone: 15 * MM, slab: 0, contra: 0, brita: 0.2, soil: ILUS.solo * MM, mesh: 1, meshInSlab: 0 };
    return {
      raiz: raiz, stack: stack, stone: stone, brita: brita, slab: slab, contra: contra, soil: soil,
      malha: malha, malhaIM: im, shadow: shadow, baixa: baixa,
      cur: cur, tgt: Object.assign({}, cur), cor: "palha", colorK: 1, britaCols: greys,
      yaw: YAW0, fovY: null, total: 0, id: null
    };
  }
  // amostra removida da cena de vez (troca de densidade): só o que é dela, os recursos compartilhados ficam
  function descartarAmostra(s) {
    scene.remove(s.raiz);
    s.stone.meshes.concat(s.brita.meshes).forEach(function (m) { m.dispose(); });
    [s.stone.core, s.brita.core].forEach(function (c) { c.geometry.dispose(); c.material.dispose(); });
    [s.slab, s.contra, s.soil].forEach(function (m) { m.geometry.dispose(); });
    s.malhaIM.dispose();
  }

  function targetsFrom(s, st) {
    var laje = st.uso === "garagem" && st.malha;
    var t = s.tgt;
    t.stone = st.espessuraMm * MM;
    t.slab = laje ? ILUS.laje * MM : 0;
    t.contra = st.base === "contrapiso" ? ILUS.contrapiso * MM : 0;
    t.brita = st.base === "solo" ? st.britaCm * 10 * MM : 0;
    t.soil = st.base === "solo" ? ILUS.solo * MM : 0;
    t.mesh = st.malha ? 1 : 0;
    t.meshInSlab = laje ? 1 : 0;
  }
  function applyColor(s, cor, instant) {
    s.cor = cor;
    s.stone.setColors(paletteFor(cor), instant || reduce || parado);
    s.colorK = instant || reduce || parado ? 1 : 0;
    var bc = britaFor(cor);
    if (bc !== s.britaCols) { s.britaCols = bc; s.brita.setColors(bc, true); }
  }
  function settle(s, dt) {
    var moving = false, cur = s.cur, tgt = s.tgt;
    for (var k in tgt) {
      var a = cur[k], b = tgt[k];
      if (Math.abs(a - b) > 1e-4) { cur[k] = dt == null ? b : S.damp(a, b, 7, dt); moving = true; }
      else cur[k] = b;
    }
    if (s.colorK < 1) {
      s.colorK = dt == null ? 1 : Math.min(1, s.colorK + dt * 2.2);
      s.stone.paint(S.easeInOutCubic(s.colorK));
      moving = true;
    }
    return moving;
  }
  // uma fresta mínima entre camadas desenha a linha de corte e separa camadas de cor parecida
  // (a de baixo da pedra é um pouco maior: é a linha que separa a pedra da base)
  var SEAM = 0.006, SEAM_STONE = 0.011;
  function seam(h) { return Math.min(SEAM, h * 0.5); }
  function layout(s) {
    var cur = s.cur, y = 0;
    s.stone.setHeight(cur.stone);   // só recalcula quando a espessura muda (pebbleSlab guarda a última)
    y -= cur.stone + SEAM_STONE;
    // malha: numa fresta sob a pedra (fica à vista no corte) ou no terço de cima da laje
    var meshGap = cur.mesh * (1 - cur.meshInSlab) * 0.05;
    var meshY = y - 0.002 - meshGap * 0.3 - cur.meshInSlab * cur.slab * 0.35;
    y -= meshGap;
    s.malha.position.y = meshY;
    var ms = Math.max(0.001, cur.mesh);
    s.malha.scale.set(ms, ms, ms);
    s.malha.visible = cur.mesh > 0.01;
    sizeBox(s.slab, y, cur.slab); y -= cur.slab + seam(cur.slab);
    sizeBox(s.contra, y, cur.contra); y -= cur.contra + seam(cur.contra);
    s.brita.group.position.y = y;
    s.brita.group.visible = cur.brita > 0.004;
    if (s.brita.group.visible) s.brita.setHeight(cur.brita);
    y -= cur.brita + seam(cur.brita);
    sizeBox(s.soil, y, cur.soil); y -= cur.soil;
    s.shadow.position.y = y - 0.002;
    return -y;
  }
  // giro: só a amostra em foco gira (com uma só, ou sem foco válido, todas); as outras voltam
  // devagar ao ângulo de repouso pelo caminho mais curto
  function girar(s, dt, gira) {
    if (gira) { s.yaw += (dt || 0) * 0.32; return false; }
    var volta = Math.PI * 2;
    var alvo = YAW0 + volta * Math.round((s.yaw - YAW0) / volta);
    if (Math.abs(s.yaw - alvo) < 1e-3) { s.yaw = alvo; return false; }
    s.yaw = dt == null ? alvo : S.damp(s.yaw, alvo, 3, dt);
    return true;
  }

  /* ---------- lista, fila de montagem e reaproveitamento ---------- */
  var ordem = [];                 // ids na ordem da lista
  var itens = new Map();          // id -> item normalizado
  var porId = new Map();          // id -> amostra montada
  var pool = [];                  // amostras sem ambiente (escondidas), prontas para reaproveitar
  var fila = [];                  // ids sem amostra ainda (uma é montada por quadro)
  var refazer = [];               // ids cuja amostra troca para a densidade baixa
  var denso4 = false;             // já passou de 3 amostras: densidade baixa daqui em diante
  var maiorN = 0, reavaliar = false;
  var foco = null;

  function baixaAlvo() { return low || denso4; }
  function anexar(s, it) {
    s.id = it.id;
    porId.set(it.id, s);
    targetsFrom(s, it);
    settle(s, null);
    applyColor(s, it.cor, true);
    s.yaw = YAW0;
    s.fovY = null;
  }
  function soltar(s) {
    porId.delete(s.id);
    s.id = null;
    s.raiz.visible = false;
    pool.push(s);
  }
  function tirarDoPool() {
    var alvo = baixaAlvo();
    while (pool.length) {
      var s = pool.pop();
      if (s.baixa === alvo || s.baixa) return s;   // densidade baixa serve sempre
      descartarAmostra(s);
    }
    return null;
  }
  function aplicarLista(lista) {
    var novos = new Set();
    lista.forEach(function (it) { novos.add(it.id); });
    // quem saiu volta para o pool (escondido, sem dispose)
    Array.from(porId.keys()).forEach(function (id) { if (!novos.has(id)) soltar(porId.get(id)); });
    itens = new Map();
    lista.forEach(function (it) { itens.set(it.id, it); });
    ordem = lista.map(function (it) { return it.id; });
    fila = fila.filter(function (id) { return itens.has(id) && !porId.has(id); });
    refazer = refazer.filter(function (id) { return itens.has(id); });
    if (lista.length >= 4 && !low && !denso4) {
      denso4 = true;
      porId.forEach(function (s, id) { if (!s.baixa && refazer.indexOf(id) < 0) refazer.push(id); });
    }
    var colorMudou = false;
    lista.forEach(function (it) {
      var s = porId.get(it.id);
      if (s) {
        if (it.cor !== s.cor) { applyColor(s, it.cor, false); colorMudou = true; }
        targetsFrom(s, it);
        return;
      }
      s = tirarDoPool();
      if (s) { anexar(s, it); return; }
      if (fila.indexOf(it.id) < 0) fila.push(it.id);
    });
    if (lista.length > maiorN) { maiorN = lista.length; reavaliar = true; }
    var m = lista.length >= 2;
    if (m !== multi) { multi = m; aplicarTeto(); }
    publicar();
    return colorMudou;
  }
  // no máximo uma amostra nova por quadro: devolve true se montou alguma
  function montarUma() {
    while (fila.length) {
      var id = fila.shift(), it = itens.get(id);
      if (!it || porId.has(id)) continue;
      anexar(criarAmostra(baixaAlvo()), it);
      publicar();
      return true;
    }
    while (refazer.length) {
      var id2 = refazer.shift(), velho = porId.get(id2), it2 = itens.get(id2);
      if (!velho || velho.baixa || !it2) continue;
      var novo = criarAmostra(true);
      anexar(novo, it2);
      // continua de onde a outra estava (sem pulo de espessura, cor ou ângulo)
      novo.cur = Object.assign({}, velho.cur);
      novo.yaw = velho.yaw;
      novo.fovY = velho.fovY;
      descartarAmostra(velho);
      publicar();
      return true;
    }
    return false;
  }

  /* ---------- tamanho, retângulos das células, desenho ---------- */
  var size = { w: 0, h: 0 };
  function resize() {
    var w = Math.round(canvas.clientWidth), h = Math.round(canvas.clientHeight);
    if (!w || !h || (w === size.w && h === size.h)) return false;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    return true;
  }
  var gov = S.dprGovernor(tetoAtual(), function (d) { setDpr(d); });
  function setDpr(d) {
    if (Math.abs(renderer.getPixelRatio() - d) < 1e-3) return;
    renderer.setPixelRatio(d);           // o three refaz o buffer (e o limpa): o quadro é redesenhado
    size.w = 0;
    resize();
    publicar();
    if (!running && !disposed) draw(null);
  }
  function aplicarTeto() {
    if (fixo) return;
    gov.set(tetoAtual());
    setDpr(gov.dpr);
  }
  // retângulo da célula em px CSS relativos ao canvas, com o y de baixo para cima (GL)
  var cRect = null;
  function retangulo(id, k, n) {
    var x, y, w, h;
    if (cellFor) {
      var el = cellFor(id);
      if (!el || !el.getBoundingClientRect || !el.isConnected) return null;
      var r = el.getBoundingClientRect();
      // escala CSS aplicada por um ancestral (animação de entrada): converte para px do canvas
      var kx = size.w / (cRect.width || 1), ky = size.h / (cRect.height || 1);
      x = (r.left - cRect.left) * kx;
      w = r.width * kx;
      h = r.height * ky;
      y = (cRect.bottom - r.bottom) * ky;
    } else {
      // sem células DOM: o canvas vira uma grade de 1 ou 2 colunas
      var colsN = n > 1 ? 2 : 1, rows = Math.ceil(n / colsN), gap = n > 1 ? 8 : 0;
      w = (size.w - gap * (colsN - 1)) / colsN;
      h = (size.h - gap * (rows - 1)) / rows;
      x = (k % colsN) * (w + gap);
      y = size.h - (Math.floor(k / colsN) + 1) * h - Math.floor(k / colsN) * gap;
    }
    // só a parte dentro do canvas
    var x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(size.w, x + w), y1 = Math.min(size.h, y + h);
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    // o viewport é o da célula inteira (a câmera não deforma); a tesoura corta no canvas
    return { x: x, y: y, w: w, h: h, sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0 };
  }
  // com várias amostras a mais alta define a distância de todas: um pouco de folga para ela não
  // encostar na borda da célula (com uma só, o enquadramento de antes)
  function distPara(total, aspect) {
    var alto = total + LATA_H;   // a lata fica em cima da pedra e entra no enquadramento
    var r = Math.sqrt(0.25 * BW * BW + 0.25 * BD * BD + 0.25 * alto * alto) * (multi ? 1.02 : 0.9);
    var vf = THREE.MathUtils.degToRad(camera.fov / 2);
    var hf = Math.atan(Math.tan(vf) * aspect);
    return r / Math.sin(Math.min(vf, hf));
  }
  var escala = { dist: 0 };

  var visible = true, onScreen = true, running = false, raf = 0, last = 0, disposed = false, cleaned = false, frames = 0;
  var parado = false, sondando = false;
  var autoRotate = opts.autoRotate !== false && !reduce;
  var compiled = false;
  var ativos = [], rects = [], lastDrawn = 0;
  function draw(dt0) {
    if (!compiled || disposed) return false;
    if (!size.w) resize();
    if (!size.w) return false;
    // sem movimento (preferência do sistema ou quadro parado do vigia): toda mudança é instantânea
    var dt = reduce || parado ? null : dt0;
    var moving = false, maxTotal = 0, i, s;
    ativos.length = 0;
    for (i = 0; i < ordem.length; i++) {
      s = porId.get(ordem[i]);
      if (s) ativos.push(s);
    }
    var focoOk = foco != null && porId.has(foco);
    for (i = 0; i < ativos.length; i++) {
      s = ativos[i];
      if (settle(s, dt)) moving = true;
      s.total = layout(s);
      if (s.total > maxTotal) maxTotal = s.total;
      var gira = autoRotate && (ativos.length === 1 || !focoOk || s.id === foco);
      if (girar(s, dt, gira)) moving = true;
    }
    cRect = cellFor ? canvas.getBoundingClientRect() : null;
    rects.length = 0;
    var aspectRef = Infinity;
    for (i = 0; i < ativos.length; i++) {
      var rc = retangulo(ativos[i].id, i, ativos.length);
      rects.push(rc);
      if (rc && rc.w / rc.h < aspectRef) aspectRef = rc.w / rc.h;
    }
    // a mesma distância (a mesma escala vertical) para todas: a pilha mais alta define
    if (aspectRef !== Infinity) {
      var alvo = distPara(maxTotal, aspectRef);
      if (dt == null || !escala.dist) escala.dist = alvo;
      else { escala.dist = S.damp(escala.dist, alvo, 5, dt); if (Math.abs(escala.dist - alvo) > 1e-3) moving = true; }
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.w, size.h);
    renderer.clear();
    renderer.setScissorTest(true);
    var el = 0.36, desenhou = 0;
    for (i = 0; i < ativos.length; i++) {
      s = ativos[i];
      var q = rects[i];
      var yMid = (LATA_H - s.total) / 2;
      if (dt == null || s.fovY == null) s.fovY = yMid;
      else { s.fovY = S.damp(s.fovY, yMid, 5, dt); if (Math.abs(s.fovY - yMid) > 1e-4) moving = true; }
      if (!q) continue;
      camera.aspect = q.w / q.h;
      camera.position.set(0, s.fovY + Math.sin(el) * escala.dist, Math.cos(el) * escala.dist);
      camera.lookAt(0, s.fovY, 0);
      camera.updateProjectionMatrix();
      s.stack.rotation.y = s.yaw;
      renderer.setViewport(q.x, q.y, q.w, q.h);
      renderer.setScissor(q.sx, q.sy, q.sw, q.sh);
      s.raiz.visible = true;
      renderer.render(scene, camera);
      s.raiz.visible = false;
      desenhou++;
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.w, size.h);
    frames++;
    lastDrawn = desenhou;
    return moving;
  }

  /* "Reduzir movimento" ligado ou desligado com a página aberta: a preferência do sistema passa a valer
   * (opts.reducedMotion é só o valor inicial). Ligado: o loop para já e fica um quadro parado com o estado
   * atual; desligado: o giro volta (a não ser que o vigia tenha parado o giro). p.setReducedMotion(bool)
   * faz o mesmo por código. */
  function setReduce(r) {
    r = !!r;
    if (disposed || r === reduce) return;
    reduce = r;
    autoRotate = opts.autoRotate !== false && !reduce && !parado;
    if (reduce) {
      running = false;
      sondando = false;
      cancelAnimationFrame(raf);
      porId.forEach(function (s) { settle(s, null); });
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

  /* ---------- vigia em escada ---------- */
  var dog = S.frameWatchdog({ warm: 8, samples: 45, limitMs: LIMITE_MS });
  var passos = [];
  function publicar() {
    if (window.StoneDren3D) {
      if (!window.StoneDren3D.preview) window.StoneDren3D.preview = {};
      window.StoneDren3D.preview.samples = porId.size;
      window.StoneDren3D.preview.steps = passos.slice();
      window.StoneDren3D.preview.still = parado;
      window.StoneDren3D.preview.dpr = renderer.getPixelRatio();
    }
  }
  function entrarParado(ms) {
    parado = true;
    autoRotate = false;
    passos.push({ still: true, ms: ms });
    // quadro parado: sem giro e sem transição; a sonda mede quadros parados antes de aprovar
    porId.forEach(function (s) { settle(s, null); s.yaw = YAW0; });
    dog = S.frameWatchdog({ warm: 2, samples: 12, limitMs: LIMITE_PARADO_MS, warmMs: 300, windowMs: 2500 });
    sondando = !reduce;
    publicar();
  }
  function vigiar(raw) {
    if (!autoRotate && !sondando) return;
    var v = dog.sample(raw);
    if (v === "pending") return;
    if (v === "ok") {
      if (sondando) sondando = false;           // quadro parado aprovado: o loop para sozinho
      else if (!parado) gov.sample(raw);        // resolução adaptativa depois do veredito, como no hero
      return;
    }
    var ms = Math.round(dog.median * 10) / 10;
    if (!parado) {
      var cur = renderer.getPixelRatio();
      var nDpr = passos.filter(function (p) { return p.dpr != null; }).length;
      var d = S.dprStepDown(cur, dog.median, nDpr);
      if (d) {
        passos.push({ dpr: cur, ms: ms });
        teto = d;
        gov.limit(d);
        setDpr(d);
        dog.reset();
        publicar();
        return;
      }
      entrarParado(ms);
      return;
    }
    passos.push({ gaveUp: true, ms: ms });
    giveUp("slow");
  }
  // o número de amostras cresceu (e as novas já estão montadas): o vigia volta a medir
  function reavaliarSeCresceu() {
    if (!reavaliar || fila.length || refazer.length) return;
    reavaliar = false;
    if (reduce) return;
    if (parado) {
      dog = S.frameWatchdog({ warm: 2, samples: 12, limitMs: LIMITE_PARADO_MS, warmMs: 300, windowMs: 2500 });
      sondando = true;
    } else dog.reset();
  }

  function tick(t) {
    if (!running) return;
    var raw = last ? t - last : 0;
    var dt = last ? Math.min(0.2, raw / 1000) : 1 / 60;
    last = t;
    var montou = compiled ? montarUma() : false;
    if (!montou) reavaliarSeCresceu();
    var moving = draw(dt);
    if (!compiled) { running = false; return; }
    // quadro com montagem de amostra nova não conta para o vigia (o custo é da montagem)
    if (!montou) vigiar(raw);
    if (disposed) return;
    if (!autoRotate && !moving && !sondando && !fila.length && !refazer.length) { running = false; return; }
    raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (disposed) return;
    var should = visible && onScreen && !document.hidden;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(tick); }
    else if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }
  var ro = new ResizeObserver(function () {
    // o buffer é refeito (e limpo) no resize: redesenha já, mesmo com o loop rodando
    if (resize()) draw(running ? 0 : null);
    else if (!running) draw(null);
  });
  ro.observe(canvas);
  if (opts.observe && opts.observe.nodeType === 1) ro.observe(opts.observe);
  var io = new IntersectionObserver(function (en) { onScreen = en[en.length - 1].isIntersecting; kick(); });
  io.observe(canvas);
  function onVis() { kick(); }
  document.addEventListener("visibilitychange", onVis);

  var lostCtx = false;
  function giveUp(reason) {
    if (cleaned) return;
    if (window.StoneDren3D) window.StoneDren3D.previewBailed = reason;
    publicar();
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

  // primeira amostra montada já (a cena precisa de uma para compilar os shaders); as demais, uma por quadro
  pool.push(criarAmostra(baixaAlvo()));

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
    // compila com todas as camadas de uma amostra à vista (os materiais valem para todas)
    var s = porId.values().next().value || pool[0];
    var vis = [];
    if (s) {
      s.raiz.visible = true;
      [s.slab, s.contra, s.soil, s.malha, s.brita.group].forEach(function (o) { vis.push(o.visible); o.visible = true; });
    }
    return S.compileQuiet(renderer, scene, camera).then(function () {
      if (!s) return;
      s.raiz.visible = false;
      [s.slab, s.contra, s.soil, s.malha, s.brita.group].forEach(function (o, i) { o.visible = vis[i]; });
    });
  }).then(function () {
    compiled = true;
    if (!disposed) { draw(null); kick(); }
  });
  // fotos reais: a paleta da cor sai da própria foto (cai nos quantis enquanto carrega)
  var ready = Promise.all(S.CORES.map(function (c) {
    return S.loadImage(S.fotoUrl(c)).then(function (img) { palCache[c] = S.photoColors(img, 160); }).catch(function () {});
  }).concat([compiledP])).then(function () {
    if (disposed) return;
    porId.forEach(function (s) { applyColor(s, s.cor, true); });
    draw(null);
    if (window.StoneDren3D) window.StoneDren3D.preview = { initMs: Math.round(performance.now() - t0), frames: frames, samples: porId.size, steps: passos.slice(), still: parado, dpr: renderer.getPixelRatio() };
  });

  resize();
  aplicarLista([norm({}, 0)]);
  kick();

  var api = {
    ready: ready,
    update: function (x) {
      if (disposed) return;
      aplicarLista(normLista(x));
      if (fila.length || refazer.length) { kick(); return; }
      if (reduce || parado) { porId.forEach(function (s) { settle(s, null); }); if (!sondando) { draw(null); return; } }
      if (!running) kick();
      if (!running && visible && onScreen) draw(null);
    },
    setFoco: function (id) {
      if (disposed) return;
      var f = id == null || id === "" ? null : String(id);
      if (f === foco) return;
      foco = f;
      if (autoRotate && !running) kick();
    },
    setVisible: function (v) { visible = !!v; kick(); },
    setReducedMotion: function (v) { setReduce(v); },
    get stats() {
      return {
        frames: frames, dpr: renderer.getPixelRatio(), running: running, reduced: reduce,
        samples: porId.size, drawn: lastDrawn, pending: fila.length + refazer.length, pool: pool.length,
        dense: !baixaAlvo(), still: parado, probing: sondando, steps: passos.slice(),
        verdict: dog.verdict, median: Math.round(dog.median * 10) / 10, focus: foco
      };
    },
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
      porId.forEach(function (s) { s.stone.meshes.concat(s.brita.meshes, [s.malhaIM]).forEach(function (m) { m.dispose(); }); });
      pool.forEach(function (s) { s.stone.meshes.concat(s.brita.meshes, [s.malhaIM]).forEach(function (m) { m.dispose(); }); });
      pebbleGeos.concat(gravelGeos).forEach(function (g) { g.dispose(); });
      if (envRT) envRT.dispose();
      renderer.dispose();
      if (!lostCtx) { try { renderer.forceContextLoss(); } catch (er) {} }
    }
  };
  return api;
}
