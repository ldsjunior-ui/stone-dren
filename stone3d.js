/* Stone Dren · utilidades 3D compartilhadas (hero, corte explodido e amostra da calculadora).
 *
 * - paletas e fotos reais das cinco cores de pedra (img/pedra-*.jpg)
 * - geração de pedrinhas (geometria irregular) e distribuição em "casca" de uma camada
 * - bake na GPU de um piso de pedra com resina, sem costura, com albedo tirado das fotos,
 *   normal map, altura, rugosidade e visibilidade do sol (sombra própria das pedrinhas)
 * - texturas procedurais de solo, brita e concreto para os cortes
 *
 * Só é carregado por import dinâmico depois que a página já pintou.
 */
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export const CORES = ["branca", "palha", "cinza", "preta", "ouro"];

// Quantis de luminância das fotos (escuro para claro), usados quando a foto ainda não carregou.
export const PALETAS = {
  branca: ["#837d75", "#9f9991", "#b5aea6", "#cfcac1"],
  palha: ["#725938", "#a58b64", "#c4b08f", "#e4d1a9"],
  cinza: ["#5a595d", "#7e7d80", "#afadae", "#e0dad9"],
  preta: ["#353132", "#636062", "#888585", "#aea8a5"],
  ouro: ["#75451d", "#9c6a3c", "#bf925f", "#ecc68d"]
};

export function fotoUrl(cor) {
  return new URL("./img/pedra-" + cor + ".jpg", import.meta.url).href;
}

/* ---------- ambiente ---------- */

export function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function isLowTier() {
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  var narrow = Math.min(window.innerWidth, screen.width || window.innerWidth) < 760;
  var mem = navigator.deviceMemory || 8;
  return coarse || narrow || mem < 4;
}

// DPR limitado: 1.75 no desktop, 1.25 em tela estreita ou ponteiro grosso.
export function dprCap() {
  var over = window.STONE_DREN_3D && window.STONE_DREN_3D.fixedDpr;
  if (over) return over;
  return Math.min(window.devicePixelRatio || 1, isLowTier() ? 1.25 : 1.75);
}

/* WebGL por software (SwiftShader, llvmpipe, WARP em VM ou área de trabalho remota, GPU bloqueada)
 * roda a cena a 3 quadros por segundo e trava a página inteira: nesses casos fica a versão 2D.
 * Para testes headless com SwiftShader: window.STONE_DREN_3D = { allowSoftware: true }. */
export function allowSoftware() {
  return !!(window.STONE_DREN_3D && window.STONE_DREN_3D.allowSoftware);
}
var SOFT_RE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;
export function isSoftwareGL(gl) {
  try {
    var info = gl.getExtension("WEBGL_debug_renderer_info");
    var name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return SOFT_RE.test(String(name || ""));
  } catch (e) { return false; }
}

/* Sonda num canvas à parte (o canvas da cena fica livre para receber os atributos certos).
 * Se o scenes.js já publicou o veredito (window.StoneDren3D.hw, na avaliação do módulo), ele é
 * reaproveitado: nenhum segundo contexto é criado. Com economia de dados o veredito já vem false. */
var gl2ok = null;
export function webgl2Available() {
  if (gl2ok !== null) return gl2ok;
  var pub = window.StoneDren3D;
  if (pub && typeof pub.hw === "boolean") { gl2ok = pub.hw; return gl2ok; }
  try {
    var soft = allowSoftware();
    var c = document.createElement("canvas"), gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: !soft });
    gl2ok = !!gl && (soft || !isSoftwareGL(gl));
    var ext = gl && gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  } catch (e) { gl2ok = false; }
  if (pub && typeof pub.hw !== "boolean") pub.hw = gl2ok;
  return gl2ok;
}

export function makeRenderer(canvas, opts) {
  opts = opts || {};
  // sem WebGL2 por hardware lança um erro limpo antes do three tentar (e registrar erro no console)
  if (!webgl2Available()) throw new Error("WebGL2 por hardware indisponível");
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: opts.antialias !== false,
    alpha: !!opts.alpha,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: !allowSoftware()
  });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error("WebGL2 indisponível");
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure || 1;
  if (opts.alpha) renderer.setClearColor(0x000000, 0);
  return renderer;
}

/* Compila os shaders antes do primeiro quadro. Com KHR_parallel_shader_compile a compilação
 * não trava a thread principal; sem a extensão compila direto (sem o aviso do three no console). */
export function compileQuiet(renderer, scene, camera) {
  try {
    if (renderer.compileAsync && renderer.extensions.has("KHR_parallel_shader_compile")) {
      return renderer.compileAsync(scene, camera).catch(function () {});
    }
    renderer.compile(scene, camera);
  } catch (e) {}
  return Promise.resolve();
}

/* Espera o próximo quadro: divide a montagem das cenas em pedaços curtos (a thread principal
 * volta a responder entre um passo e outro). */
export function nextFrame() {
  return new Promise(function (resolve) {
    if (document.hidden) setTimeout(resolve, 0);
    else requestAnimationFrame(function () { resolve(); });
  });
}

/* Vigia de desempenho: mede o intervalo real entre quadros (sem o limite do dt da animação).
 * Descarta o aquecimento, junta uma janela de amostras e dá o veredito pela mediana.
 * sample(ms) devolve "pending", "ok" ou "slow". Com window.STONE_DREN_3D.watchdog === false fica sempre "ok". */
export function frameWatchdog(opts) {
  opts = opts || {};
  var warm = opts.warm == null ? 8 : opts.warm;
  var need = opts.samples || 45;
  var limit = opts.limitMs || 50;
  // numa máquina muito lenta 45 quadros levariam 15 s: a janela também fecha por tempo
  var warmMs = opts.warmMs || 600, windowMs = opts.windowMs || 1500;
  var off = window.STONE_DREN_3D && window.STONE_DREN_3D.watchdog === false;
  var n = 0, warmT = 0, total = 0, buf = [], verdict = off ? "ok" : "pending";
  function median() { if (!buf.length) return 0; var s = buf.slice().sort(function (a, b) { return a - b; }); return s[s.length >> 1]; }
  return {
    get verdict() { return verdict; },
    get median() { return median(); },
    reset: function () { if (!off) { n = 0; warmT = 0; total = 0; buf = []; verdict = "pending"; } },
    sample: function (ms) {
      if (verdict !== "pending") return verdict;
      if (!(ms > 0) || ms > 3000) return verdict; // pausa, aba oculta ou primeiro quadro: não conta
      if (n < warm && warmT < warmMs) { n++; warmT += ms; return verdict; }
      buf.push(ms);
      total += ms;
      if (buf.length >= need || (total >= windowMs && buf.length >= 3)) verdict = median() > limit ? "slow" : "ok";
      return verdict;
    }
  };
}

/* ---------- números aleatórios reprodutíveis ---------- */

export function rng(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- fotos das pedras ---------- */

var imgCache = new Map();
export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  var p = new Promise(function (resolve, reject) {
    var im = new Image();
    im.decoding = "async";
    im.onload = function () { resolve(im); };
    im.onerror = function () { reject(new Error("falha ao carregar " + url)); };
    im.src = url;
  });
  imgCache.set(url, p);
  return p;
}

export function photoTexture(img, renderer) {
  var t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

var colorCache = new Map();
/* Cores reais de pedrinhas: amostra a região central da foto (onde só há pedra),
 * com um leve desfoque para cada amostra representar um grão, e devolve cores lineares. */
export function photoColors(img, n) {
  n = n || 160;
  var key = img.src + "|" + n;
  if (colorCache.has(key)) return colorCache.get(key);
  var W = 40, H = 40;
  var c = document.createElement("canvas");
  c.width = W; c.height = H;
  var ctx = c.getContext("2d", { willReadFrequently: true });
  var sx = img.naturalWidth * 0.18, sy = img.naturalHeight * 0.35;
  var sw = img.naturalWidth * 0.64, sh = img.naturalHeight * 0.47;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  var d = ctx.getImageData(0, 0, W, H).data;
  var r = rng(n * 7919 + img.naturalWidth);
  var out = [];
  for (var i = 0; i < n; i++) {
    var x = Math.floor(r() * W), y = Math.floor(r() * H);
    var o = (y * W + x) * 4;
    var col = new THREE.Color().setRGB(d[o] / 255, d[o + 1] / 255, d[o + 2] / 255, THREE.SRGBColorSpace);
    out.push(col);
  }
  colorCache.set(key, out);
  return out;
}

export function paletteColors(cor) {
  return (PALETAS[cor] || PALETAS.palha).map(function (h) { return new THREE.Color(h); });
}

/* ---------- geometria de pedrinhas ---------- */

function lobes(r, count) {
  var L = [];
  for (var i = 0; i < count; i++) {
    var v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    L.push({ v: v, f: 1.2 + r() * 2.2, p: r() * 6.28, a: (0.5 + r()) / count });
  }
  return L;
}

/* Pedrinha arredondada irregular (pedra natural britada e rolada). */
export function pebbleGeometry(seed, opts) {
  opts = opts || {};
  var r = rng(seed * 131 + 17);
  var g = new THREE.IcosahedronGeometry(1, opts.detail == null ? 2 : opts.detail);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  var pos = g.attributes.position;
  var L = lobes(r, 5);
  var bump = opts.bump == null ? 0.2 : opts.bump;
  var sx = 1 + r() * 0.35, sy = 0.62 + r() * 0.22, sz = 0.85 + r() * 0.2;
  var v = new THREE.Vector3();
  for (var i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    var k = 0;
    for (var j = 0; j < L.length; j++) k += L[j].a * Math.sin(v.dot(L[j].v) * L[j].f * 3 + L[j].p);
    var s = 1 + bump * k;
    pos.setXYZ(i, v.x * s * sx, v.y * s * sy, v.z * s * sz);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* Pedra angulosa de brita: poucas faces, arestas vivas. */
export function gravelGeometry(seed) {
  var r = rng(seed * 977 + 3);
  var g = new THREE.IcosahedronGeometry(1, 0);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  var pos = g.attributes.position;
  var sx = 1 + r() * 0.4, sy = 0.7 + r() * 0.3, sz = 0.8 + r() * 0.3;
  for (var i = 0; i < pos.count; i++) {
    var s = 0.72 + r() * 0.45;
    pos.setXYZ(i, pos.getX(i) * s * sx, pos.getY(i) * s * sy, pos.getZ(i) * s * sz);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* Pontos numa "casca" de uma caixa: topo e quatro laterais, em duas fileiras,
 * para parecer um bloco maciço de pedras sem instanciar o miolo (que é uma caixa escura). */
export function shellPoints(box, spacing, seed, opts) {
  opts = opts || {};
  var r = rng(seed);
  var pts = [];
  var min = box.min, max = box.max;
  var layers = opts.layers || 2;
  function push(x, y, z, nx, ny, nz, depth) {
    pts.push({ x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, depth: depth, u: r(), v: r(), w: r() });
  }
  for (var L = 0; L < layers; L++) {
    var inset = spacing * (0.25 + L * 0.7);
    var jit = spacing * 0.42;
    // topo
    if (opts.top !== false) {
      for (var x = min.x + spacing * 0.5; x < max.x; x += spacing) {
        for (var z = min.z + spacing * 0.5; z < max.z; z += spacing) {
          var ox = (L % 2) * spacing * 0.5;
          push(clamp(x + ox + (r() - 0.5) * jit, min.x, max.x), max.y - inset, clamp(z + ox + (r() - 0.5) * jit, min.z, max.z), 0, 1, 0, L);
        }
      }
    }
    // laterais em z (frente e fundo)
    for (var s = 0; s < 2; s++) {
      var zz = s ? max.z - inset : min.z + inset, nz = s ? 1 : -1;
      for (var x2 = min.x + spacing * 0.5; x2 < max.x; x2 += spacing) {
        for (var y2 = min.y + spacing * 0.5; y2 < max.y; y2 += spacing * 0.9) {
          push(clamp(x2 + (r() - 0.5) * jit, min.x, max.x), clamp(y2 + (r() - 0.5) * jit, min.y, max.y), zz, 0, 0, nz, L);
        }
      }
    }
    // laterais em x
    for (var s2 = 0; s2 < 2; s2++) {
      var xx = s2 ? max.x - inset : min.x + inset, nx = s2 ? 1 : -1;
      for (var z3 = min.z + spacing * 0.5; z3 < max.z; z3 += spacing) {
        for (var y3 = min.y + spacing * 0.5; y3 < max.y; y3 += spacing * 0.9) {
          push(xx, clamp(y3 + (r() - 0.5) * jit, min.y, max.y), clamp(z3 + (r() - 0.5) * jit, min.z, max.z), nx, 0, 0, L);
        }
      }
    }
  }
  return pts;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ---------- texturas procedurais (canvas 2D) ---------- */

function noiseCanvas(size, seed, paint) {
  var c = document.createElement("canvas");
  c.width = c.height = size;
  var ctx = c.getContext("2d");
  paint(ctx, size, rng(seed));
  return c;
}

function canvasTex(c, srgb) {
  var t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function soilTexture(size) {
  size = size || 256;
  var c = noiseCanvas(size, 11, function (ctx, S, r) {
    ctx.fillStyle = "#5a4029";
    ctx.fillRect(0, 0, S, S);
    for (var i = 0; i < S * 9; i++) {
      var x = r() * S, y = r() * S, rr = 0.4 + r() * 2.2;
      var l = 30 + r() * 60;
      ctx.fillStyle = "rgba(" + Math.round(l * 1.25) + "," + Math.round(l * 0.9) + "," + Math.round(l * 0.6) + "," + (0.25 + r() * 0.5) + ")";
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.283); ctx.fill();
    }
    // estratos horizontais suaves da compactação
    for (var k = 0; k < 7; k++) {
      var yy = r() * S;
      ctx.fillStyle = "rgba(20,12,6," + (0.08 + r() * 0.1) + ")";
      ctx.fillRect(0, yy, S, 1 + r() * 3);
    }
  });
  return canvasTex(c, true);
}

export function concreteTexture(size) {
  size = size || 256;
  var c = noiseCanvas(size, 23, function (ctx, S, r) {
    ctx.fillStyle = "#8d8c88";
    ctx.fillRect(0, 0, S, S);
    for (var i = 0; i < S * 14; i++) {
      var x = r() * S, y = r() * S, rr = 0.3 + r() * 1.3;
      var l = 105 + r() * 70;
      ctx.fillStyle = "rgba(" + l + "," + (l - 2) + "," + (l - 6) + "," + (0.2 + r() * 0.5) + ")";
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.283); ctx.fill();
    }
    for (var j = 0; j < S * 0.8; j++) {
      ctx.fillStyle = "rgba(40,40,42," + (0.25 + r() * 0.4) + ")";
      ctx.beginPath(); ctx.arc(r() * S, r() * S, 0.5 + r() * 1.2, 0, 6.283); ctx.fill();
    }
  });
  return canvasTex(c, true);
}

/* ---------- bake do piso de pedra com resina (GPU) ---------- */

var BAKE_VERT = [
  "varying vec2 vUv;",
  "void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }"
].join("\n");

// Campo de pedrinhas: Voronoi periódico (sem costura) com borda suavizada, domínio distorcido,
// parte das células subdividida em grãos menores e alguns vazios (os poros por onde a água desce).
var FIELD_GLSL = [
  "uniform float uCells, uSeed, uFine, uVoid, uGap, uRound, uFacet;",
  "varying vec2 vUv;",
  "#define JIT 0.92",
  "#define SMK 0.085",
  "vec4 hash42(vec2 p){ vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099) + uSeed * 0.0137);",
  "  p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }",
  "float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed * 0.0123); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
  "float pnoise(vec2 p, float per){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);",
  "  float a = hash12(mod(i, per)), b = hash12(mod(i + vec2(1.0, 0.0), per));",
  "  float c = hash12(mod(i + vec2(0.0, 1.0), per)), d = hash12(mod(i + vec2(1.0, 1.0), per));",
  "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }",
  "vec4 voro(vec2 p, float N, out vec4 rnd){",
  "  vec2 ip = floor(p), fp = fract(p); vec2 mg = vec2(0.0), mr = vec2(0.0); float md = 8.0; rnd = vec4(0.0);",
  "  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {",
  "    vec2 g = vec2(float(i), float(j)); vec4 h = hash42(mod(ip + g, N));",
  "    vec2 r = g + 0.5 + (h.xy - 0.5) * JIT - fp; float d = dot(r, r);",
  "    if (d < md) { md = d; mr = r; mg = g; rnd = h; } }",
  "  float acc = 0.0;",
  "  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {",
  "    vec2 g = mg + vec2(float(i), float(j)); vec4 h = hash42(mod(ip + g, N));",
  "    vec2 r = g + 0.5 + (h.xy - 0.5) * JIT - fp; vec2 dd = r - mr;",
  "    if (dot(dd, dd) > 1e-6) acc += exp(-max(dot(0.5 * (mr + r), normalize(dd)), 0.0) / SMK); }",
  // distância à borda suavizada (log-sum-exp): cantos arredondados, sem vinco no eixo do grão
  "  float ed = -SMK * log(max(acc, 1e-8));",
  "  return vec4(ed, sqrt(md), mr); }",
  // x: altura 0..1, y: chave de cor, z: distância à borda, w: vazio; mrOut: vetor até o centro do grão
  "vec4 stoneField(vec2 uv, out vec2 mrOut){",
  "  vec2 w1 = vec2(pnoise(uv * 12.0, 12.0), pnoise(uv * 12.0 + 31.0, 12.0)) - 0.5;",
  "  vec2 w2 = vec2(pnoise(uv * 48.0, 48.0), pnoise(uv * 48.0 + 11.0, 48.0)) - 0.5;",
  "  vec2 p = uv * uCells + w1 * 0.95 + w2 * 0.28;",
  "  vec4 rnd; vec4 v = voro(p, uCells, rnd);",
  "  float e = v.x; vec4 key = rnd; mrOut = v.zw; float sz = 1.0; float f1s = v.y;",
  "  if (rnd.z < uFine) {",
  "    vec4 rnd2; vec4 v2 = voro(p * 2.0 + 17.0, uCells * 2.0, rnd2);",
  "    float e2 = v2.x * 0.5; e = min(e, e2); key = rnd2; mrOut = v2.zw * 0.5; sz = 0.5; f1s = v2.y * 0.5; }",
  "  float gap = uGap * (0.25 + 1.5 * key.w * key.w);",
  "  float inside = smoothstep(gap, gap + 0.02, e);",
  "  float en = clamp((e - gap) / (uRound * sz), 0.0, 1.0);",
  "  float prof = 1.0 - (1.0 - en) * (1.0 - en);",
  "  float fr = clamp(f1s / (0.62 * sz), 0.0, 1.0);",
  "  float dome = 1.0 - 0.4 * fr * fr;",
  // pedra britada: três planos por grão cortam o domo em faces com arestas (não parece seixo liso)
  "  vec2 q = -mrOut / sz; float a0 = fract(key.x * 7.31 + key.y * 3.7) * 6.2831;",
  "  vec2 n1 = vec2(cos(a0), sin(a0)), n2 = vec2(cos(a0 + 2.0 + key.y), sin(a0 + 2.0 + key.y)), n3 = vec2(cos(a0 + 4.1 - key.w), sin(a0 + 4.1 - key.w));",
  "  float fc = min(min(1.0 - dot(q, n1) * 1.25, 1.0 - dot(q, n2) * 1.05), 1.0 - dot(q, n3) * 1.45);",
  "  dome = mix(dome, min(dome, 0.12 + 0.88 * clamp(fc, 0.0, 1.0)), uFacet);",
  // cada grão assenta com uma leve inclinação própria: pega a luz de um jeito diferente
  "  vec2 tilt = (vec2(fract(key.z * 11.7), fract(key.w * 5.3)) - 0.5) * 0.9;",
  "  float h = prof * dome * (0.42 + 0.58 * key.y) * (1.0 + dot(-mrOut / sz, tilt));",
  "  h += (pnoise(uv * 384.0, 384.0) - 0.5) * 0.07 * inside;",
  "  float vr = fract(key.z * 17.13 + key.w * 7.31);",
  "  float vflag = step(vr, uVoid);",
  "  h *= mix(1.0, 0.1, vflag);",
  "  return vec4(clamp(h, 0.0, 1.0), fract(key.z * 3.17 + key.w * 1.71), e, vflag); }"
].join("\n");

var FRAG_HEIGHT = FIELD_GLSL + "\nvoid main(){ vec2 mr; gl_FragColor = stoneField(vUv, mr); }";

var FRAG_ALBEDO = FIELD_GLSL + "\n" + [
  "uniform sampler2D tP0, tP1, tP2; uniform vec2 uW; uniform float uBaseLod, uSat;",
  "vec2 h22(float k){ vec3 p3 = fract(vec3(k) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }",
  "vec3 pick(float s, vec2 L, float lod){ if (s < uW.x) return textureLod(tP0, L, lod).rgb; if (s < uW.y) return textureLod(tP1, L, lod).rgb; return textureLod(tP2, L, lod).rgb; }",
  "void main(){",
  "  vec2 mr; vec4 F = stoneField(vUv, mr);",
  "  float k = F.y; vec2 r1 = h22(k * 97.3 + 1.1); vec2 r2 = h22(k * 53.1 + 7.7);",
  "  vec2 L = vec2(0.2 + 0.6 * r1.x, 0.2 + 0.44 * r1.y);",
  "  float a = r2.y * 6.2831; mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));",
  "  vec2 D = L + R * (-mr) * 0.07;",
  // cor do grão: um ponto pequeno da foto (um grão real), não a média dela; o detalhe vem de perto do mesmo ponto
  "  vec3 base = pick(r2.x, L, uBaseLod); vec3 det = pick(r2.x, D, 0.6);",
  "  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);",
  "  float df = clamp(dot(det, LW) / max(dot(base, LW), 1e-4), 0.6, 1.5);",
  "  vec3 c = base * mix(1.0, df, 0.45);",
  "  c *= 0.84 + 0.3 * fract(k * 29.7);",
  "  float l = dot(c, LW); c = max(mix(vec3(l), c, uSat), 0.0) * 0.98;",
  "  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.55, F.x));",
  "  vec3 gapc = vec3(0.022, 0.017, 0.012);",
  "  gl_FragColor = vec4(mix(gapc, c * ao, smoothstep(0.01, 0.16, F.x)), 1.0); }"
].join("\n");

var FRAG_NORMAL = [
  "uniform sampler2D tH; uniform vec2 uTexel; uniform float uSlope;",
  "varying vec2 vUv;",
  "float H(vec2 o){ return texture2D(tH, vUv + o * uTexel).r; }",
  "void main(){",
  "  float tl = H(vec2(-1.0, 1.0)), t = H(vec2(0.0, 1.0)), tr = H(vec2(1.0, 1.0));",
  "  float l = H(vec2(-1.0, 0.0)), r = H(vec2(1.0, 0.0));",
  "  float bl = H(vec2(-1.0, -1.0)), b = H(vec2(0.0, -1.0)), br = H(vec2(1.0, -1.0));",
  "  float dx = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) / (8.0 * uTexel.x);",
  "  float dy = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) / (8.0 * uTexel.y);",
  "  vec3 n = normalize(vec3(-dx * uSlope, -dy * uSlope, 1.0));",
  "  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }"
].join("\n");

var FRAG_DATA = [
  "uniform sampler2D tH; uniform vec2 uSun2; uniform float uTanE, uHm, uTile;",
  "varying vec2 vUv;",
  "void main(){",
  "  vec4 A = texture2D(tH, vUv); float h0 = A.r;",
  "  float kr = fract(A.g * 41.7);",
  "  float rough = mix(0.92, 0.46 + 0.2 * kr, smoothstep(0.04, 0.3, h0));",
  "  float vis = 1.0;",
  "  float maxD = (uHm / max(uTanE, 0.03)) / uTile * 1.25;",
  "  for (int i = 1; i <= 26; i++) {",
  "    float t = maxD * float(i) / 26.0;",
  "    float hs = texture2D(tH, vUv + uSun2 * t).r;",
  "    float rayH = h0 + t * uTile * uTanE / uHm;",
  "    vis = min(vis, clamp(1.0 + (rayH - hs) * 4.0, 0.0, 1.0)); }",
  "  gl_FragColor = vec4(h0, rough, vis, 1.0); }"
].join("\n");

/* Gera os mapas do piso. Tudo em espaço de textura: u = x/tile, v = z/tile.
 * opts: size, cells, tileMeters, heightMeters, photos [{tex, weight}] (1 a 3), sunDir (Vector3 para o sol, mundo),
 *       fine (fração de células subdivididas), voids (fração de vazios), gap, round, seed,
 *       baseLod (quanto a cor de cada grão é média da foto: menor = grãos mais variados), sat (saturação),
 *       facets (0 a 1: grão britado com faces planas em vez de seixo liso).
 * Devolve uma Promise: cada passe roda num quadro (sem tarefa longa na thread principal). */
export async function bakeStoneMaps(renderer, opts) {
  var size = opts.size || 1024;
  var tile = opts.tileMeters || 0.6;
  var Hm = opts.heightMeters || 0.004;
  var halfOk = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  var aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function rt(o) {
    return new THREE.WebGLRenderTarget(size, size, Object.assign({
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, depthBuffer: false, anisotropy: aniso
    }, o));
  }
  var rtH = rt({ type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, anisotropy: 1 });
  var rtAlb = rt({ colorSpace: THREE.SRGBColorSpace });
  var rtNor = rt({});
  var rtDat = rt({});

  var photos = opts.photos.slice(0, 3);
  while (photos.length < 3) photos.push(photos[photos.length - 1]);
  var tw = photos.reduce(function (s, p) { return s + (p.weight || 1); }, 0);
  var w0 = (photos[0].weight || 1) / tw, w1 = w0 + (photos[1].weight || 1) / tw;

  var common = {
    uCells: { value: opts.cells || 64 }, uSeed: { value: opts.seed || 3 },
    uFine: { value: opts.fine == null ? 0.45 : opts.fine }, uVoid: { value: opts.voids == null ? 0.06 : opts.voids },
    uGap: { value: opts.gap == null ? 0.028 : opts.gap }, uRound: { value: opts.round == null ? 0.3 : opts.round },
    uFacet: { value: opts.facets == null ? 0.6 : opts.facets }
  };
  var sun = (opts.sunDir || new THREE.Vector3(0.4, 0.14, -0.9)).clone().normalize();
  var sun2 = new THREE.Vector2(sun.x, sun.z).normalize();
  var tanE = Math.tan(Math.asin(Math.max(0.03, sun.y)));

  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var mesh = new THREE.Mesh(geo);
  mesh.frustumCulled = false;
  var scene = new THREE.Scene();
  scene.add(mesh);

  async function pass(frag, uniforms, target) {
    await nextFrame();
    var m = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: frag, uniforms: uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    mesh.material = m;
    var prevTarget = renderer.getRenderTarget();
    var prevTM = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTM;
    m.dispose();
  }

  await pass(FRAG_HEIGHT, Object.assign({}, common), rtH);
  await pass(FRAG_ALBEDO, Object.assign({
    tP0: { value: photos[0].tex }, tP1: { value: photos[1].tex }, tP2: { value: photos[2].tex },
    uW: { value: new THREE.Vector2(w0, w1) }, uBaseLod: { value: opts.baseLod == null ? 2.4 : opts.baseLod },
    uSat: { value: opts.sat == null ? 1.1 : opts.sat }
  }, common), rtAlb);
  await pass(FRAG_NORMAL, {
    tH: { value: rtH.texture }, uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
    uSlope: { value: (Hm / tile) * (opts.normalK || 0.8) }
  }, rtNor);
  await pass(FRAG_DATA, {
    tH: { value: rtH.texture }, uSun2: { value: sun2 }, uTanE: { value: tanE },
    uHm: { value: Hm }, uTile: { value: tile }
  }, rtDat);

  geo.dispose();
  rtH.dispose();

  return {
    albedo: rtAlb.texture, normal: rtNor.texture, data: rtDat.texture,
    tile: tile, heightMeters: Hm, size: size,
    dispose: function () { rtAlb.dispose(); rtNor.dispose(); rtDat.dispose(); }
  };
}

/* Camada de pedrinhas instanciadas (casca do topo e das laterais + miolo escuro).
 * Origem do grupo = superfície de cima; a camada cresce para baixo (y negativo).
 * setHeight(h) mostra só as fileiras laterais que cabem na espessura; setColors troca a paleta. */
export function pebbleSlab(opts) {
  var w = opts.w, d = opts.d, maxH = opts.maxH, sp = opts.spacing, size = opts.size;
  var group = new THREE.Group();
  // a casca entra um pouco nas laterais: a face externa das pedrinhas fica rente ao bloco de baixo
  var inset = size * (opts.inset == null ? 0.75 : opts.inset);
  var box = new THREE.Box3(new THREE.Vector3(-w / 2 + inset, 0, -d / 2 + inset), new THREE.Vector3(w / 2 - inset, maxH, d / 2 - inset));
  var pts = shellPoints(box, sp, opts.seed || 1, { layers: 2 });
  var geos = opts.geos;
  var core = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: opts.core || 0x1a130c, roughness: 0.9 }));
  core.receiveShadow = true;
  group.add(core);
  var buckets = geos.map(function () { return []; });
  pts.forEach(function (p, i) {
    p.s = size * (0.72 + p.u * 0.6);
    p.top = p.ny > 0;
    p.dep = maxH - p.y;
    p.ci = Math.floor(p.u * 997 + p.v * 131);
    p.bright = 0.85 + p.w * 0.3;
    p.q = new THREE.Quaternion().setFromEuler(p.top && opts.flatTop
      ? new THREE.Euler((p.v - 0.5) * 0.5, p.w * 6.28, (p.u - 0.5) * 0.5)
      : new THREE.Euler(p.v * 6.28, p.w * 6.28, p.u * 6.28));
    buckets[i % geos.length].push(p);
  });
  var meshes = buckets.map(function (list, gi) {
    var m = new THREE.InstancedMesh(geos[gi], opts.mat, list.length);
    m.userData.list = list;
    m.castShadow = !!opts.castShadow;
    m.receiveShadow = !!opts.receiveShadow;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  var m4 = new THREE.Matrix4(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  var fromCols = null, toCols = opts.colors, lastH = NaN;
  function setHeight(h) {
    // só recalcula as matrizes (e reenvia o buffer à GPU) quando a espessura muda de fato
    if (Math.abs(h - lastH) < 1e-5) return;
    lastH = h;
    meshes.forEach(function (m) {
      m.userData.list.forEach(function (p, i) {
        var s = p.s, k = 1;
        ps.set(p.x, 0, p.z);
        if (p.top) {
          ps.y = -(s * 0.5 + p.depth * s * 0.6);
          k = Math.min(1, h / (s * 0.9));
        } else {
          ps.y = -Math.max(s * 0.45, Math.min(p.dep, h - s * 0.45));
          k = Math.max(0, Math.min(1, (h - p.dep + s * 0.6) / (s * 0.8)));
        }
        sc.set(s * k, s * k, s * k);
        m4.compose(ps, p.q, sc);
        m.setMatrixAt(i, m4);
      });
      m.instanceMatrix.needsUpdate = true;
    });
    var ch = Math.max(0.0005, h - sp * 0.5);
    core.scale.set(w - 2 * inset - sp * 0.9, ch, d - 2 * inset - sp * 0.9);
    core.position.y = -sp * 0.5 - ch / 2;
    core.visible = h > sp * 0.5;
  }
  function paint(k) {
    meshes.forEach(function (m) {
      m.userData.list.forEach(function (p, i) {
        var b = toCols[p.ci % toCols.length];
        if (fromCols && k < 1) col.copy(fromCols[p.ci % fromCols.length]).lerp(b, k);
        else col.copy(b);
        col.multiplyScalar(p.bright);
        m.setColorAt(i, col);
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
  function setColors(cols, instant) {
    fromCols = instant ? null : toCols;
    toCols = cols;
    if (instant) paint(1);
  }
  paint(1);
  setHeight(opts.h == null ? maxH : opts.h);
  return { group: group, setHeight: setHeight, setColors: setColors, paint: paint, meshes: meshes, core: core };
}

/* Caixa com UV em escala de mundo (a textura não estica quando a altura muda). */
export function worldBox(w, h, d, density) {
  var g = new THREE.BoxGeometry(w, h, d);
  var pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  density = density || 1;
  for (var i = 0; i < pos.count; i++) {
    var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    var nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x * density, z * density);
    else if (nx > 0.5) uv.setXY(i, z * density, y * density);
    else uv.setXY(i, x * density, y * density);
  }
  return g;
}

/* ---------- utilidades de cena ---------- */

export function disposeObject(root) {
  root.traverse(function (o) {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      var ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(function (m) {
        for (var k in m) { var v = m[k]; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      });
    }
  });
}

export function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
export function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
export function damp(a, b, lambda, dt) { return a + (b - a) * (1 - Math.exp(-lambda * dt)); }
