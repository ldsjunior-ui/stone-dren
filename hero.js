/* Stone Dren · hero: chuva caindo sobre o piso de pedra e sendo drenada.
 * Cada gota cai, bate na superfície, abre um anel curto e deixa uma mancha
 * molhada que encolhe e some (a água atravessa o piso em vez de empoçar).
 * Respeita prefers-reduced-motion e pausa fora da tela.
 */
(function () {
  "use strict";
  var canvas = document.getElementById("hero-rain");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduce = !!(mq && mq.matches);
  var W = 0, H = 0, dpr = 1, running = false, last = 0;
  var drops = [], splashes = [], wets = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // A superfície começa perto do meio da tela e vai até embaixo (perspectiva).
  // mesma inclinação da chuva do vídeo de fundo (16 graus da vertical, topo para a direita)
  var TILT = Math.tan(16 * Math.PI / 180);
  function spawnDrop() {
    var targetY = rand(H * 0.52, H * 0.98);
    drops.push({
      x: rand(0, W * 1.15), y: rand(-H * 0.4, -10), vy: rand(900, 1300),
      len: rand(14, 26), targetY: targetY,
      scale: 0.45 + 0.75 * ((targetY - H * 0.5) / (H * 0.5)) // mais perto = maior
    });
  }

  function step(dt) {
    var density = W < 700 ? 38 : 70; // gotas por segundo
    var n = density * dt;
    while (n > 1) { spawnDrop(); n--; }
    if (Math.random() < n) spawnDrop();

    for (var i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.y += d.vy * dt;
      d.x -= d.vy * TILT * dt;
      if (d.y >= d.targetY) {
        splashes.push({ x: d.x, y: d.targetY, r: 1, max: 9 + 14 * d.scale, a: 0.55, s: d.scale });
        wets.push({ x: d.x, y: d.targetY, r: 3 + 7 * d.scale, a: 0.32, s: d.scale });
        drops.splice(i, 1);
      }
    }
    for (var j = splashes.length - 1; j >= 0; j--) {
      var s = splashes[j];
      s.r += (s.max - s.r) * Math.min(1, dt * 7);
      s.a -= dt * 1.6;
      if (s.a <= 0) splashes.splice(j, 1);
    }
    for (var k = wets.length - 1; k >= 0; k--) {
      var w = wets[k];
      w.r -= dt * (5 + 6 * w.s);   // a mancha encolhe: a água está descendo
      w.a -= dt * 0.28;
      if (w.r <= 0.5 || w.a <= 0) wets.splice(k, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // manchas molhadas (escurecem a pedra brevemente)
    for (var k = 0; k < wets.length; k++) {
      var w = wets[k];
      ctx.save();
      ctx.translate(w.x, w.y); ctx.scale(1, 0.38);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, w.r);
      g.addColorStop(0, "rgba(6,10,18," + (w.a * 0.9) + ")");
      g.addColorStop(1, "rgba(6,10,18,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, w.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // anéis de impacto
    ctx.lineWidth = 1;
    for (var j = 0; j < splashes.length; j++) {
      var s = splashes[j];
      ctx.save();
      ctx.translate(s.x, s.y); ctx.scale(1, 0.34);
      ctx.strokeStyle = "rgba(230,238,245," + Math.max(0, s.a) + ")";
      ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // gotas em queda
    ctx.lineCap = "round";
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      var grd = ctx.createLinearGradient(d.x + d.len * TILT, d.y - d.len, d.x, d.y);
      grd.addColorStop(0, "rgba(220,232,242,0)");
      grd.addColorStop(1, "rgba(225,236,246,0.55)");
      ctx.strokeStyle = grd;
      ctx.lineWidth = 1 + d.scale * 0.8;
      ctx.beginPath(); ctx.moveTo(d.x + d.len * TILT, d.y - d.len); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
  }

  var rafPending = false; // um único laço de animação, mesmo com pausa e retomada rápidas
  function frame(t) {
    rafPending = false;
    if (!running) return;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    step(dt); draw();
    rafPending = true; requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", function () { resize(); if (reduce && !retired) stillFrame(); });

  // Movimento reduzido: um quadro estático discreto, algumas manchas e anéis, sem animação.
  function stillFrame() {
    drops = []; splashes = []; wets = [];
    for (var i = 0; i < 40; i++) { spawnDrop(); var d = drops[i]; d.y = d.targetY; }
    step(0.05); draw();
  }
  var visible = true, retired = false; // retired: o hero 3D assumiu e o fallback 2D para de vez
  function play() {
    if (retired || reduce || !visible || document.hidden || running) return;
    running = true; last = 0;
    if (!rafPending) { rafPending = true; requestAnimationFrame(frame); }
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) play(); else running = false;
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) running = false; else play();
  });
  // a pessoa liga ou desliga "reduzir movimento" com a página aberta
  if (mq) {
    var onMq = function () {
      reduce = mq.matches;
      if (reduce) { running = false; if (!retired) stillFrame(); }
      else { drops = []; splashes = []; wets = []; play(); }
    };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  window.addEventListener("stonedren:hero3d-ready", function () {
    retired = true; running = false;
    ctx.clearRect(0, 0, W, H);
    canvas.style.display = "none";
  });
  // o 3D saiu (contexto perdido ou GPU lenta): a foto volta pelo CSS e a chuva 2D volta aqui
  window.addEventListener("stonedren:hero3d-lost", function () {
    if (!retired) return;
    retired = false;
    canvas.style.display = "";
    resize();
    if (reduce) stillFrame(); else play();
  });

  running = false;
  if (reduce) stillFrame(); else play();
})();
