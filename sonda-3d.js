/* Stone Dren · veredito de WebGL2 por hardware para páginas SEM o hero 3D (ex.: calculadora-teste.html).
 * Na página principal quem publica o veredito é o scenes.js; aqui a sonda é a mesma, sem baixar o three:
 * um worker com OffscreenCanvas (não trava a página com WebGL por software) e uma conferência rápida
 * na thread principal. Publica window.StoneDren3D.hw e o evento "stonedren:webgl-verdict", que a
 * calculadora lê antes de importar a amostra 3D (preview3d.js).
 */
(function () {
  "use strict";
  var W = window;
  var stats = (W.StoneDren3D = W.StoneDren3D || {});
  if (stats.hw === true || stats.hw === false) return;
  var SOFT_GL = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;
  var saveData = false;
  try { saveData = !!(navigator.connection && navigator.connection.saveData); } catch (e) { saveData = false; }
  var enviado = false;
  function publicar(hw) {
    if (enviado) return;
    enviado = true;
    stats.hw = hw;
    stats.saveData = saveData;
    try { W.dispatchEvent(new CustomEvent("stonedren:webgl-verdict", { detail: { hw: hw, saveData: saveData } })); } catch (e) {}
  }
  function naPagina() {
    try {
      var c = document.createElement("canvas"), gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
      if (!gl) return false;
      var info = gl.getExtension("WEBGL_debug_renderer_info");
      var nome = String((info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || "");
      var x = gl.getExtension("WEBGL_lose_context");
      if (x) x.loseContext();
      return !SOFT_GL.test(nome);
    } catch (e) { return false; }
  }
  if (saveData) { publicar(false); return; }
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined" || !W.Blob || !W.URL || !URL.createObjectURL) { publicar(naPagina()); return; }
  var SRC = "onmessage=function(){var r={gl:false};try{var c=new OffscreenCanvas(1,1),gl=c.getContext('webgl2',{failIfMajorPerformanceCaveat:true});" +
    "if(gl){r.gl=true;var i=gl.getExtension('WEBGL_debug_renderer_info');r.name=String((i?gl.getParameter(i.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER))||'');" +
    "var x=gl.getExtension('WEBGL_lose_context');if(x)x.loseContext();}}catch(er){}postMessage(r);};";
  var url = null, wk = null, relogio = 0;
  function fim() { clearTimeout(relogio); try { wk.terminate(); } catch (e) {} try { URL.revokeObjectURL(url); } catch (e) {} }
  try {
    url = URL.createObjectURL(new Blob([SRC], { type: "text/javascript" }));
    wk = new Worker(url);
    wk.onmessage = function (e) {
      fim();
      var r = e.data || {};
      if (!r.gl) { publicar(naPagina()); return; }        // pode ser só falta de WebGL em worker
      if (SOFT_GL.test(r.name || "")) { publicar(false); return; }
      publicar(naPagina());
    };
    wk.onerror = function () { fim(); publicar(naPagina()); };
    wk.postMessage({});
    relogio = setTimeout(function () { fim(); publicar(false); }, 2000);
  } catch (e) { fim(); publicar(naPagina()); }
})();
