/* Stone Dren · motor da calculadora de materiais, V2 (puro, sem DOM).
 *
 * Roda no navegador (window.StoneDrenCalc) e no Node (module.exports), para os
 * testes em tests/calc.test.js. Nenhuma função daqui mexe na página: recebe a
 * obra (ambientes + resina + cor) e devolve números, estados nomeados e textos.
 *
 * Todos os coeficientes moram em TABELA, versionada. A versão 2026-09 é
 * PROVISÓRIA: os valores são referências de mercado até a Stone Dren confirmar
 * o consumo real dos próprios produtos. A página mostra essas premissas.
 *
 * Regra da casa: dado que falta vira estado nomeado ("a confirmar", "não se
 * aplica", "consulte a equipe técnica"), nunca zero.
 */
(function (root) {
  "use strict";

  var TABELA = {
    versao: "2026-09",
    rotulo: "versão 2026-09 (provisória)",
    provisorio: true,

    pedra: {
      kgPorM2PorMm: 1.7,      // kg de pedra por m² para cada mm de espessura
      perda: 0.07,            // 7% de perda sobre a pedra
      fatorGrao: 3,           // espessura mínima = 3 x grão máximo
      sacoKg: 20,             // PROVISÓRIO: peso real do saco a confirmar
      sacoProvisorio: true
    },

    resina: {
      tipos: {
        epoxi: { rotulo: "Epóxi", curto: "epóxi" },
        pu: { rotulo: "PU", curto: "PU" }
      },
      kitKg: 21.5,            // kit de referência: resina já misturada com o endurecedor
      kitProvisorio: true,
      kitPremissa: "kit de referência provisório: balde de resina com o endurecedor correspondente, 21,5 kg depois de misturados; confirme na ficha técnica"
    },

    brita: {
      densidadeKgM3: 1450,
      empolamento: 1.15,      // volume solto = volume compactado x 1,15
      sacoKg: 20,
      granelAcimaM3: 2        // acima disso, vale comprar a granel em m³
    },

    malha: {
      painelRotulo: "2 x 3 m",
      m2PorPainel: 4.59,      // 6 m² por painel / 1,31 m² de tela por m² (transpasse)
      telaPorM2: 1.31,
      premissa: "arma a laje de concreto; o concreto não entra no cálculo"
    },

    laje: { cm: 8, rotulo: "Laje de concreto armado" },

    limites: { areaMinM2: 0.01, areaMaxM2: 100000, medidaMaxM: 2000, ambientesMax: 8, espessuraMaxMm: 100 },

    // Perfis de uso. graoMinMm null = "até X mm".
    perfis: {
      jardim: {
        rotulo: "Jardim", descricao: "Caminho decorativo",
        espessuraMm: 12, graoMinMm: null, graoMaxMm: 4,
        resinaPct: { epoxi: 0.05, pu: 0.04 },
        bases: { solo: { britaCm: 10 }, contrapiso: {} }
      },
      calcada: {
        rotulo: "Calçada", descricao: "Área de pedestre",
        espessuraMm: 20, graoMinMm: null, graoMaxMm: 6,
        resinaPct: { epoxi: 0.05, pu: 0.04 },
        bases: { solo: { britaCm: 10 }, contrapiso: {} }
      },
      piscina: {
        rotulo: "Entorno de piscina", descricao: "Borda e área molhada",
        espessuraMm: 15, graoMinMm: 2, graoMaxMm: 4,
        resinaPct: { epoxi: 0.05, pu: 0.04 },
        aConfirmar: true,
        bases: { contrapiso: { caimentoPct: 2 } },
        baseBloqueada: {
          solo: "No entorno de piscina, o cálculo vale só sobre contrapiso existente com caimento de 2% para a água escoar. Sobre o solo, consulte a equipe técnica."
        }
      },
      garagem: {
        rotulo: "Garagem", descricao: "Carro leve",
        espessuraMm: 30, graoMinMm: 4, graoMaxMm: 6,
        resinaPct: { epoxi: 0.08, pu: 0.05 },
        bases: { contrapiso: { rotulo: "Concreto ou asfalto existente" }, solo: { britaCm: 15, laje: true, malha: true } },
        consulte: {
          brita: "Garagem aplicada direto sobre a brita, sem laje, não é calculada nesta versão. Consulte a equipe técnica."
        }
      }
    },

    bases: {
      solo: { rotulo: "Solo", descricao: "Sobre o terreno, com base de brita" },
      contrapiso: { rotulo: "Contrapiso existente", descricao: "Sobre piso ou concreto que já existe" },
      brita: { rotulo: "Direto sobre brita", descricao: "Sem laje de concreto" }
    },

    recomendados: [
      { id: "manta", rotulo: "Manta geotêxtil", texto: "entre o solo e a brita, para separar as camadas" },
      { id: "primer", rotulo: "Primer", texto: "sobre contrapiso existente, conforme a ficha técnica" }
    ],

    cores: {
      branca: "Branca", palha: "Palha", cinza: "Cinza", preta: "Preta", ouro: "Ouro"
    }
  };

  var EPS = 1e-9;
  function ceilPack(kg, packKg) { return Math.ceil(kg / packKg - EPS); }
  function r2(n) { return Math.round(n * 100) / 100; }
  // Tira o ruído de ponto flutuante antes de arredondar: 18 x 0,15 x 1,15 dá 3,1049999999999995
  // em binário e viraria 3,1 na tela; com 12 dígitos significativos volta a ser 3,105 (e mostra 3,11).
  function limpo(n) { return typeof n === "number" && isFinite(n) && n !== 0 ? Number(n.toPrecision(12)) : n; }

  /* ---------- números em pt-BR ---------- */

  // Aceita "12,5", "12.5", "1.234,5", "1 234,5" e "1.500" (milhar). Devolve NaN se não for número.
  function parseNumero(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    if (v == null) return NaN;
    var s = String(v).trim().replace(/\s+/g, "").replace(/m²|m2|m$/i, "");
    if (!s) return NaN;
    if (!/^[+]?[\d.,]+$/.test(s)) return NaN;
    var temPonto = s.indexOf(".") >= 0, temVirgula = s.indexOf(",") >= 0;
    if (temPonto && temVirgula) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (temVirgula) {
      if ((s.match(/,/g) || []).length > 1) return NaN;
      s = s.replace(",", ".");
    } else if (temPonto) {
      // "1.500" e "12.000.000" são milhar no Brasil; "1.5" e "12.25" são decimal
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
      else if ((s.match(/\./g) || []).length > 1) return NaN;
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  // Arredondamento comercial em decimal (5,175 -> 5,18). toFixed sozinho erra
  // porque 5,175 em binário é 5,17499...; o deslocamento pelo expoente em texto não.
  function arred(n, casas) {
    var s = String(n);
    if (/e/i.test(s)) return Number(n.toFixed(casas));
    return Number(Math.round(Number(s + "e" + casas)) + "e-" + casas);
  }
  function fmt(n, casas) {
    if (casas == null) casas = 0;
    var neg = n < 0; n = Math.abs(n);
    var fixo = arred(n, casas).toFixed(casas);
    var partes = fixo.split(".");
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "-" : "") + inteiro + (partes[1] ? "," + partes[1] : "");
  }
  // até 2 casas, sem zeros sobrando: 12 -> "12", 12,5 -> "12,5", 0,125 -> "0,13"
  function fmtAuto(n, max) {
    if (max == null) max = 2;
    var s = fmt(n, max);
    if (s.indexOf(",") >= 0) s = s.replace(/0+$/, "").replace(/,$/, "");
    return s;
  }
  // Nunca mostra "0,0 kg" para uma quantidade que existe: abaixo de 0,1 kg vira texto.
  function fmtKg(kg) {
    if (kg > 0 && kg < 0.1) return "menos de 0,1 kg";
    if (kg < 1) return fmtAuto(kg, 2) + " kg";
    return fmt(kg, kg < 100 ? 1 : 0) + " kg";
  }
  function fmtM3(m3) {
    if (m3 > 0 && m3 < 0.01) return "menos de 0,01 m³";
    return fmtAuto(m3, 2) + " m³";
  }
  function fmtCmDeMm(mm) { return fmtAuto(mm / 10, 1) + " cm"; }
  // Espessura da camada Stone Dren: sempre em mm, a mesma unidade do controle da página.
  function fmtMm(mm) { return fmt(mm) + " mm"; }
  // Contagem de embalagens com milhar e plural: 1 saco, 1.455.200 sacos.
  function qtd(n, singular, plural) { return fmt(n) + " " + (n === 1 ? singular : plural); }

  /* ---------- perfis ---------- */

  function perfil(uso) { return TABELA.perfis[uso] || null; }

  function graoRotulo(p) {
    return p.graoMinMm ? "de " + p.graoMinMm + " a " + p.graoMaxMm + " mm" : "até " + p.graoMaxMm + " mm";
  }
  // "pedra com grãos de até 6 mm" / "pedra com grãos de 2 a 4 mm" (sem o termo técnico granulometria)
  function graoFrase(p) {
    return "pedra com grãos " + (p.graoMinMm ? "de " + p.graoMinMm + " a " + p.graoMaxMm + " mm" : "de até " + p.graoMaxMm + " mm");
  }

  // Limites do controle de espessura de cada uso.
  function espessuraLimites(uso) {
    var p = perfil(uso);
    if (!p) return null;
    var pisoTecnico = TABELA.pedra.fatorGrao * p.graoMaxMm;
    var minimo = Math.max(p.espessuraMm, pisoTecnico);
    return {
      padraoMm: p.espessuraMm,
      minimoMm: minimo,                  // abaixo disso a página avisa
      sliderMinMm: Math.min(pisoTecnico, minimo),
      sliderMaxMm: Math.max(40, p.espessuraMm * 2),
      passoMm: 1
    };
  }

  function basesDoUso(uso) {
    var p = perfil(uso);
    if (!p) return [];
    var lista = [];
    ["solo", "contrapiso"].forEach(function (b) {
      lista.push({
        id: b,
        rotulo: (p.bases[b] && p.bases[b].rotulo) || TABELA.bases[b].rotulo,
        permitido: !!p.bases[b],
        motivo: p.baseBloqueada && p.baseBloqueada[b] || ""
      });
    });
    if (p.consulte && p.consulte.brita) lista.push({ id: "brita", rotulo: TABELA.bases.brita.rotulo, permitido: true, consulte: true, motivo: p.consulte.brita });
    return lista;
  }

  /* ---------- validação ---------- */

  // Devolve { ok, areaM2, erros:{campo: mensagem} } sem lançar exceção.
  function validarAmbiente(amb) {
    var erros = {};
    amb = amb || {};
    var L = TABELA.limites;
    var area = NaN;
    if (!perfil(amb.uso)) erros.uso = "Escolha o tipo de uso.";
    if (amb.modo === "medidas") {
      var c = parseNumero(amb.comprimento), l = parseNumero(amb.largura);
      var vazioC = amb.comprimento == null || String(amb.comprimento).trim() === "";
      var vazioL = amb.largura == null || String(amb.largura).trim() === "";
      if (vazioC) erros.comprimento = "Informe o comprimento em metros.";
      else if (isNaN(c)) erros.comprimento = "Use só números, por exemplo 4,5.";
      else if (!(c > 0)) erros.comprimento = "O comprimento precisa ser maior que zero.";
      else if (c > L.medidaMaxM) erros.comprimento = "Medida acima de " + fmt(L.medidaMaxM) + " m. Confira o número.";
      if (vazioL) erros.largura = "Informe a largura em metros.";
      else if (isNaN(l)) erros.largura = "Use só números, por exemplo 2,5.";
      else if (!(l > 0)) erros.largura = "A largura precisa ser maior que zero.";
      else if (l > L.medidaMaxM) erros.largura = "Medida acima de " + fmt(L.medidaMaxM) + " m. Confira o número.";
      if (!erros.comprimento && !erros.largura) {
        area = c * l;
        if (area > L.areaMaxM2) erros.largura = "A área passa de " + fmt(L.areaMaxM2) + " m². Para obras desse porte, fale com a equipe técnica.";
        else if (area < L.areaMinM2) erros.largura = "A área ficou menor que 0,01 m². Confira as medidas em metros.";
      }
    } else {
      var a = parseNumero(amb.area);
      if (amb.area == null || String(amb.area).trim() === "") erros.area = "Informe a área em m².";
      else if (isNaN(a)) erros.area = "Use só números, por exemplo 12,5.";
      else if (!(a > 0)) erros.area = "A área precisa ser maior que zero.";
      else if (a > L.areaMaxM2) erros.area = "A área passa de " + fmt(L.areaMaxM2) + " m². Para obras desse porte, fale com a equipe técnica.";
      else if (a < L.areaMinM2) erros.area = "Área menor que 0,01 m². Confira o número.";
      else area = a;
    }
    var ok = Object.keys(erros).length === 0;
    return { ok: ok, areaM2: ok ? area : null, erros: erros };
  }

  /* ---------- cálculo de um ambiente ---------- */

  // opts: { resina: "epoxi" | "pu" }
  function calcularAmbiente(amb, opts) {
    amb = amb || {};
    opts = opts || {};
    var resinaTipo = TABELA.resina.tipos[opts.resina] ? opts.resina : "epoxi";
    var p = perfil(amb.uso);
    var v = validarAmbiente(amb);
    var base = { id: amb.id != null ? amb.id : null, nome: String(amb.nome || "").trim(), uso: amb.uso };
    if (!v.ok) {
      base.estado = "incompleto";
      base.erros = v.erros;
      return base;
    }

    var area = v.areaM2;
    var lim = espessuraLimites(amb.uso);
    var baseId = amb.base === "solo" || amb.base === "contrapiso" || amb.base === "brita" ? amb.base : "contrapiso";
    var baseForcada = false, motivoBase = "";
    if (!p.bases[baseId] && !(p.consulte && p.consulte[baseId])) {
      motivoBase = (p.baseBloqueada && p.baseBloqueada[baseId]) || "Base não disponível para este uso.";
      baseId = "contrapiso";
      baseForcada = true;
    }

    var esp = parseNumero(amb.espessuraMm);
    var espAjustada = false;
    if (!(esp > 0)) esp = lim.padraoMm;
    if (esp < lim.sliderMinMm) { esp = lim.sliderMinMm; espAjustada = true; }
    if (esp > TABELA.limites.espessuraMaxMm) { esp = TABELA.limites.espessuraMaxMm; espAjustada = true; }
    esp = Math.round(esp);

    var r = {
      id: base.id, nome: base.nome, uso: amb.uso,
      usoRotulo: p.rotulo, usoDescricao: p.descricao,
      estado: "ok",
      aConfirmar: !!p.aConfirmar,
      areaM2: area,
      modo: amb.modo === "medidas" ? "medidas" : "area",
      base: baseId,
      baseRotulo: (p.bases[baseId] && p.bases[baseId].rotulo) || TABELA.bases[baseId].rotulo,
      baseForcada: baseForcada, motivoBase: motivoBase,
      espessuraMm: esp,
      espessuraPadraoMm: lim.padraoMm,
      espessuraMinimaMm: lim.minimoMm,
      abaixoDoMinimo: esp < lim.minimoMm,
      espessuraAjustada: espAjustada,
      graoMaxMm: p.graoMaxMm, graoMinMm: p.graoMinMm, graoRotulo: graoRotulo(p),
      resinaTipo: resinaTipo,
      pedra: null, resina: null, brita: null, laje: null, malha: null,
      caimentoPct: p.bases[baseId] && p.bases[baseId].caimentoPct || null,
      camadas: []
    };

    // Garagem direto sobre brita: estado nomeado, sem quantidades.
    if (p.consulte && p.consulte[baseId]) {
      r.estado = "consulte";
      r.motivo = p.consulte[baseId];
      r.camadas = [
        { id: "stone", rotulo: "Stone Dren", espessuraMm: esp, emEscala: true },
        { id: "brita", rotulo: "Brita", espessuraMm: null, emEscala: false },
        { id: "solo", rotulo: "Solo compactado", espessuraMm: null, emEscala: false }
      ];
      return r;
    }

    var T = TABELA;
    var pedraSemPerda = limpo(area * esp * T.pedra.kgPorM2PorMm);
    var pedraKg = limpo(pedraSemPerda * (1 + T.pedra.perda));
    r.pedra = {
      kg: pedraKg, kgSemPerda: pedraSemPerda, perdaPct: T.pedra.perda * 100,
      sacos: ceilPack(pedraKg, T.pedra.sacoKg), sacoKg: T.pedra.sacoKg, sacoProvisorio: T.pedra.sacoProvisorio
    };

    var pct = p.resinaPct[resinaTipo];
    var resinaKg = limpo(pedraKg * pct);
    r.resina = {
      tipo: resinaTipo, rotulo: T.resina.tipos[resinaTipo].rotulo, curto: T.resina.tipos[resinaTipo].curto, pct: pct,
      kg: resinaKg, kits: ceilPack(resinaKg, T.resina.kitKg), kitKg: T.resina.kitKg, kitProvisorio: T.resina.kitProvisorio
    };

    var cfgBase = p.bases[baseId] || {};
    if (baseId === "solo" && cfgBase.britaCm) {
      // em inteiros até a última divisão (area x cm x 115 / 10000) e sem o ruído binário
      var m3 = limpo(area * cfgBase.britaCm * Math.round(T.brita.empolamento * 100) / 10000);
      var kgB = limpo(m3 * T.brita.densidadeKgM3);
      r.brita = {
        cm: cfgBase.britaCm, m3: m3, kg: kgB, sacos: ceilPack(kgB, T.brita.sacoKg), sacoKg: T.brita.sacoKg,
        granel: m3 > T.brita.granelAcimaM3
      };
    }
    if (baseId === "solo" && cfgBase.laje) {
      r.laje = { cm: T.laje.cm, calculado: false, rotulo: T.laje.rotulo };
    }
    if (baseId === "solo" && cfgBase.malha) {
      r.malha = { paineis: ceilPack(area, T.malha.m2PorPainel), painelRotulo: T.malha.painelRotulo, premissa: T.malha.premissa };
    }

    // Camadas do corte, de cima para baixo. espessuraMm null = fora de escala.
    r.camadas.push({ id: "stone", rotulo: "Stone Dren (pedra + resina)", espessuraMm: esp, emEscala: true });
    if (baseId === "solo") {
      if (r.laje) r.camadas.push({ id: "laje", rotulo: "Laje de concreto com malha POP", espessuraMm: T.laje.cm * 10, emEscala: true, naoCalculado: true });
      if (r.brita) r.camadas.push({ id: "brita", rotulo: "Brita compactada", espessuraMm: r.brita.cm * 10, emEscala: true });
      r.camadas.push({ id: "solo", rotulo: "Solo compactado", espessuraMm: null, emEscala: false });
    } else {
      r.camadas.push({
        id: "contrapiso",
        rotulo: amb.uso === "garagem" ? "Concreto ou asfalto existente" : (r.caimentoPct ? "Contrapiso existente, caimento de " + r.caimentoPct + "%" : "Contrapiso existente"),
        espessuraMm: null, emEscala: false
      });
    }
    return r;
  }

  /* ---------- a obra inteira ---------- */

  // obra: { ambientes:[...], resina, cor }
  function calcularObra(obra) {
    obra = obra || {};
    var resina = TABELA.resina.tipos[obra.resina] ? obra.resina : "epoxi";
    var cor = TABELA.cores[obra.cor] ? obra.cor : "branca";
    var lista = (obra.ambientes || []).slice(0, TABELA.limites.ambientesMax);
    var res = lista.map(function (a) { return calcularAmbiente(a, { resina: resina }); });
    var ok = res.filter(function (a) { return a.estado === "ok"; });
    var consulte = res.filter(function (a) { return a.estado === "consulte"; });

    var tot = null;
    if (ok.length) {
      var T = TABELA;
      var area = 0, pedraKg = 0, resinaKg = 0, britaKg = 0, britaM3 = 0, malhaArea = 0, temBrita = false, temMalha = false, temLaje = false, aConfirmar = false;
      ok.forEach(function (a) {
        area += a.areaM2;
        pedraKg += a.pedra.kg;
        resinaKg += a.resina.kg;
        if (a.brita) { temBrita = true; britaKg += a.brita.kg; britaM3 += a.brita.m3; }
        if (a.malha) { temMalha = true; malhaArea += a.areaM2; }
        if (a.laje) temLaje = true;
        if (a.aConfirmar) aConfirmar = true;
      });
      area = limpo(area); pedraKg = limpo(pedraKg); resinaKg = limpo(resinaKg); britaKg = limpo(britaKg); britaM3 = limpo(britaM3);
      // A compra é da obra toda: as embalagens arredondam sobre o total.
      tot = {
        areaM2: area,
        pedra: { kg: pedraKg, sacos: ceilPack(pedraKg, T.pedra.sacoKg), sacoKg: T.pedra.sacoKg },
        resina: { tipo: resina, rotulo: T.resina.tipos[resina].rotulo, curto: T.resina.tipos[resina].curto, kg: resinaKg, kits: ceilPack(resinaKg, T.resina.kitKg), kitKg: T.resina.kitKg },
        brita: temBrita ? { kg: britaKg, m3: britaM3, sacos: ceilPack(britaKg, T.brita.sacoKg), sacoKg: T.brita.sacoKg, granel: britaM3 > T.brita.granelAcimaM3 } : null,
        malha: temMalha ? { paineis: ceilPack(malhaArea, T.malha.m2PorPainel), painelRotulo: T.malha.painelRotulo, areaM2: malhaArea } : null,
        laje: temLaje,
        aConfirmar: aConfirmar,
        massaKg: limpo(pedraKg + resinaKg + britaKg)
      };
    }
    return {
      versao: TABELA.versao, tabela: TABELA.rotulo, provisorio: TABELA.provisorio,
      resina: resina, cor: cor, corRotulo: TABELA.cores[cor],
      ambientes: res,
      calculados: ok.length,
      consulte: consulte.length,
      areaConsulteM2: limpo(consulte.reduce(function (s, a) { return s + a.areaM2; }, 0)),
      incompletos: res.filter(function (a) { return a.estado === "incompleto"; }).length,
      totais: tot
    };
  }

  /* ---------- textos ---------- */

  function nomeAmbiente(a, i) {
    return a.nome || ("Ambiente " + (i + 1));
  }

  function listaE(itens) {
    if (itens.length <= 1) return itens.join("");
    return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
  }

  // Tipos de uso por estado: "ok" (calculados) ou "consulte" (fora do cálculo).
  function tiposDaObra(r, estado) {
    var vistos = [];
    estado = estado || "ok";
    r.ambientes.forEach(function (a) {
      if (a.estado !== estado) return;
      var t = a.usoRotulo.toLowerCase() + (estado === "consulte" ? " " + a.baseRotulo.toLowerCase() : "");
      if (vistos.indexOf(t) < 0) vistos.push(t);
    });
    return listaE(vistos);
  }

  function proporcao(a) {
    return fmtAuto(a.resina.pct * 100, 1) + " kg de resina para cada 100 kg de pedra (" + a.resina.curto + ")";
  }

  // Espessura abaixo da referência do uso: o aviso segue junto em todo texto que sai da página.
  function notaAbaixo(a) {
    return a.abaixoDoMinimo ? " (abaixo da referência de " + a.espessuraMinimaMm + " mm)" : "";
  }

  function premissaAmbiente(a) {
    return "espessura de " + fmtMm(a.espessuraMm) + notaAbaixo(a) + ", " + graoFrase(a) + ", proporção de " + proporcao(a);
  }

  // Frase sobre a área que ficou fora do cálculo (garagem direto sobre brita).
  function fraseConsulte(r) {
    if (!r.consulte) return "";
    return fmtAuto(r.areaConsulteM2) + " m² (" + tiposDaObra(r, "consulte") + ")";
  }

  var AVISO_ABERTURA = "Este cálculo é uma estimativa de referência, não é orçamento nem oferta de venda.";

  // Premissas da base sobre solo (brita, malha e laje), só quando algum ambiente calculado fica
  // sobre o solo. A espessura da brita sai agrupada pelos usos que a pedem.
  function premissaBase(r) {
    var T = TABELA;
    var sobreSolo = r.ambientes.filter(function (a) { return a.estado === "ok" && a.base === "solo" && a.brita; });
    if (!sobreSolo.length) return "";
    var grupos = {}, ordem = [];
    sobreSolo.forEach(function (a) {
      var k = a.brita.cm, u = a.usoRotulo.toLowerCase();
      if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
      if (grupos[k].indexOf(u) < 0) grupos[k].push(u);
    });
    ordem.sort(function (x, y) { return x - y; });
    var britas = ordem.map(function (k) { return k + " cm (" + listaE(grupos[k]) + ")"; }).join(" ou ");
    var s = "Premissas da base sobre solo: brita compactada de " + britas + ", densidade de " + fmt(T.brita.densidadeKgM3) + " kg/m³ e " +
      fmtAuto(limpo((T.brita.empolamento - 1) * 100)) + "% de acréscimo por volume solto";
    var t = r.totais || {};
    if (t.malha) s += "; malha POP de " + T.malha.painelRotulo + " cobrindo " + fmtAuto(T.malha.m2PorPainel) + " m² por painel, já com transpasse";
    if (t.laje) s += "; laje de " + T.laje.cm + " cm não calculada";
    return s + ".";
  }

  // Aviso completo, com os valores reais. Devolve { paragrafos:[p1, p2], premissas:[], base:"" }.
  // base = premissas da brita, da malha e da laje (vazio quando nenhum ambiente fica sobre o solo).
  function aviso(r) {
    var t = r.totais;
    var T = TABELA;
    var fraseBase = t && t.brita && t.malha ? "A brita e a malha dependem das condições da base. " : (t && t.brita ? "A brita depende das condições da base. " : "");
    var p2 = fraseBase + "O consumo real pode variar conforme o tipo e o nivelamento da base, o caimento, a porosidade da pedra, a temperatura, a técnica de aplicação e os recortes da área. Antes de comprar, confirme com a equipe técnica Stone Dren ou com um aplicador da sua região, que pode fazer a medição no local. Preço, disponibilidade, frete e prazo constam apenas no orçamento formal, com validade informada. Tabela de consumo: " + T.rotulo + ".";
    var p1 = AVISO_ABERTURA + " ";
    if (!t) {
      if (!r.consulte) return null;
      p1 += "A área informada, " + fraseConsulte(r) + ", não entra nesta versão do cálculo e precisa de avaliação da equipe técnica, que indica a base e as quantidades.";
      return { paragrafos: [p1, p2], premissas: [], base: "" };
    }
    var ok = r.ambientes.filter(function (a) { return a.estado === "ok"; });
    var premissas = [];
    var fim = "margem de perda de " + fmtAuto(T.pedra.perda * 100) + "% e arredondamento para embalagens inteiras (sacos de " + T.pedra.sacoKg + " kg e kits de referência).";
    if (ok.length === 1) {
      p1 += "As quantidades foram calculadas para " + fmtAuto(t.areaM2) + " m² considerando " + premissaAmbiente(ok[0]) + ", " + fim;
    } else {
      p1 += "As quantidades foram calculadas para " + fmtAuto(t.areaM2) + " m², com as premissas de cada ambiente listadas abaixo, " + fim;
      premissas = ok.map(function (a) {
        var i = r.ambientes.indexOf(a);
        var nome = nomeAmbiente(a, i);
        var rot = nome.toLowerCase() === a.usoRotulo.toLowerCase() ? "" : a.usoRotulo.toLowerCase() + ", ";
        return nome + " (" + rot + fmtAuto(a.areaM2) + " m²): " + premissaAmbiente(a) + ".";
      });
    }
    if (r.consulte) p1 += " Ficaram fora do cálculo " + fraseConsulte(r) + ", que dependem de avaliação da equipe técnica.";
    return { paragrafos: [p1, p2], premissas: premissas, base: premissaBase(r) };
  }

  var SEGURANCA = "Resinas, endurecedores e fixadores são produtos químicos. Use luvas, óculos e máscara adequados, aplique em local ventilado, mantenha fora do alcance de crianças e animais e leia o rótulo e a Ficha com Dados de Segurança (FDS) antes de usar.";
  var AVISO_CURTO = "Estimativa de referência. Confirme as quantidades com a equipe técnica antes de comprar.";

  // Recomendados (não inclusos) filtrados pelo que a obra tem: manta só com ambiente sobre solo,
  // primer só com ambiente sobre contrapiso existente.
  function recomendadosDaObra(r) {
    var bases = {};
    r.ambientes.forEach(function (a) { if (a.estado === "ok") bases[a.base] = true; });
    return TABELA.recomendados.filter(function (x) {
      return (x.id === "manta" && bases.solo) || (x.id === "primer" && bases.contrapiso);
    });
  }
  function linhaRecomendados(r) {
    var rec = recomendadosDaObra(r);
    return rec.length ? "Recomendado, não incluso: " + listaE(rec.map(function (x) { return x.rotulo.toLowerCase(); })) + "." : "";
  }

  // Linhas da lista de materiais (texto puro, para copiar e para o WhatsApp).
  function linhasMateriais(r) {
    var t = r.totais;
    if (!t) return [];
    var L = [];
    L.push("• Pedra " + r.corRotulo.toLowerCase() + ": " + qtd(t.pedra.sacos, "saco", "sacos") + " de " + t.pedra.sacoKg + " kg (" + fmtKg(t.pedra.kg) + ")");
    L.push("• Resina " + t.resina.curto + ": " + qtd(t.resina.kits, "kit", "kits") + " de referência (" + fmtKg(t.resina.kg) + " de resina já misturada com o endurecedor)");
    if (t.brita) L.push("• Brita: " + qtd(t.brita.sacos, "saco", "sacos") + " de " + t.brita.sacoKg + " kg (" + fmtKg(t.brita.kg) + ", " + fmtM3(t.brita.m3) + " de brita solta" + (t.brita.granel ? ", vale comprar a granel" : "") + ")");
    if (t.malha) L.push("• Malha POP: " + qtd(t.malha.paineis, "painel", "painéis") + " de " + t.malha.painelRotulo);
    if (t.laje) L.push("• Laje de concreto da garagem: não calculada");
    return L;
  }

  function linhasAmbientes(r, comNome) {
    var L = [];
    r.ambientes.forEach(function (a, i) {
      var titulo = comNome ? nomeAmbiente(a, i) + " · " : "";
      if (a.estado === "ok") {
        L.push("- " + titulo + a.usoRotulo + ", " + fmtAuto(a.areaM2) + " m², " + a.baseRotulo.toLowerCase() + ", " + fmtMm(a.espessuraMm) + notaAbaixo(a) +
          (a.aConfirmar ? " (consumo de referência a confirmar)" : "") + ": pedra " + fmtKg(a.pedra.kg) + ", resina " + fmtKg(a.resina.kg) +
          (a.brita ? ", brita " + fmtKg(a.brita.kg) + " (camada de " + a.brita.cm + " cm)" : "") + (a.malha ? ", malha " + qtd(a.malha.paineis, "painel", "painéis") : ""));
      } else if (a.estado === "consulte") {
        L.push("- " + titulo + a.usoRotulo + ", " + fmtAuto(a.areaM2) + " m², " + a.baseRotulo.toLowerCase() + ": consulte a equipe técnica");
      }
    });
    return L;
  }

  // Mensagem do WhatsApp: SEM nome, telefone, cidade ou nomes dos ambientes.
  function mensagemWhatsApp(r) {
    var t = r.totais;
    var linhas;
    if (!t && r.consulte) {
      linhas = ["Olá! Fiz o cálculo no site da Stone Dren para uma área de " + fraseConsulte(r) + " e quero confirmar com a equipe técnica e pedir um orçamento.", ""];
      linhas.push("Por ambiente:");
      linhas = linhas.concat(linhasAmbientes(r, false));
      linhas.push("", "Tabela de consumo " + TABELA.rotulo + ".");
      return linhas.join("\n");
    }
    if (!t) return "Olá! Estou usando a calculadora do site da Stone Dren e quero falar com a equipe técnica.";
    // obra mista: a abertura já diz a área que ficou para a equipe técnica avaliar
    var mais = r.consulte ? ", mais " + fraseConsulte(r) + " a avaliar com a equipe técnica," : "";
    linhas = ["Olá! Fiz o cálculo no site da Stone Dren para uma área de " + fmtAuto(t.areaM2) + " m² (" + tiposDaObra(r) + ")" + mais + " e quero confirmar as quantidades e pedir um orçamento.", ""];
    linhas.push("Materiais estimados:");
    linhas = linhas.concat(linhasMateriais(r));
    linhas.push("", "Por ambiente:");
    linhas = linhas.concat(linhasAmbientes(r, false));
    var rec = linhaRecomendados(r);
    if (rec) linhas.push("", rec);
    linhas.push("", "Tabela de consumo " + TABELA.rotulo + ".");
    return linhas.join("\n");
  }

  // Lista para copiar (fica no aparelho da pessoa, pode ter os nomes dos ambientes).
  function textoLista(r) {
    var t = r.totais;
    if (!t && !r.consulte) return "";
    var L;
    if (!t) {
      L = ["Stone Dren · estimativa de materiais", fraseConsulte(r) + " · a consultar com a equipe técnica", ""];
    } else {
      var mais = r.consulte ? " mais " + fraseConsulte(r) + " a avaliar com a equipe técnica" : "";
      L = ["Stone Dren · estimativa de materiais", fmtAuto(t.areaM2) + " m²" + mais + " · resina " + t.resina.curto + " · pedra " + r.corRotulo.toLowerCase(), ""];
      L = L.concat(linhasMateriais(r));
      L.push("");
    }
    L.push("Por ambiente:");
    L = L.concat(linhasAmbientes(r, true));
    var rec = linhaRecomendados(r);
    if (rec) L.push("", rec);
    // a lista sai da página sozinha: leva o aviso de que não é orçamento e a linha de segurança química
    L.push("", AVISO_ABERTURA + " Confirme as quantidades com a equipe técnica antes de comprar.", SEGURANCA, "Tabela de consumo " + TABELA.rotulo + ".");
    return L.join("\n");
  }

  // Entrada crua da obra (o que a pessoa digitou), para o servidor refazer a conta com este mesmo motor.
  // Só os campos que o cálculo usa, cada um curto e em texto; nada de número pronto vindo da página.
  function entradaDaObra(obra) {
    obra = obra || {};
    var curto = function (v, n) { return v == null ? "" : String(v).slice(0, n); };
    return {
      resina: curto(obra.resina, 12), cor: curto(obra.cor, 12),
      ambientes: (obra.ambientes || []).slice(0, TABELA.limites.ambientesMax).map(function (a) {
        a = a || {};
        return {
          nome: curto(a.nome, 60).trim(), uso: curto(a.uso, 16), modo: a.modo === "medidas" ? "medidas" : "area",
          area: curto(a.area, 16), comprimento: curto(a.comprimento, 16), largura: curto(a.largura, 16),
          base: curto(a.base, 16), espessuraMm: a.espessuraMm == null ? null : curto(a.espessuraMm, 8)
        };
      })
    };
  }

  // Payload do lead para o webhook. extra (opcional): { email, id, pagina, teste, site }.
  // Sem extra o formato é o de sempre (a página principal manda fire and forget).
  function montarPayload(lead, obra, r, optin, extra) {
    var p = {
      origem: "calculadora-stone-dren",
      tabela: TABELA.versao, tabelaProvisoria: TABELA.provisorio,
      lead: {
        nome: String(lead && lead.nome || ""),
        whatsapp: String(lead && lead.whatsapp || "").replace(/\D/g, ""),
        cidadeUf: String(lead && lead.cidadeUf || ""),
        perfil: String(lead && lead.perfil || "")
      },
      optinNovidades: !!optin,
      obra: {
        resina: r.resina, cor: r.cor,
        ambientes: r.ambientes.map(function (a, i) {
          var o = { nome: nomeAmbiente(a, i), uso: a.uso, estado: a.estado };
          if (a.estado === "ok" || a.estado === "consulte") {
            o.areaM2 = r2(a.areaM2); o.base = a.base; o.espessuraMm = a.espessuraMm;
          }
          if (a.estado === "ok") {
            o.pedraKg = r2(a.pedra.kg); o.resinaKg = r2(a.resina.kg);
            if (a.brita) { o.britaKg = r2(a.brita.kg); o.britaM3 = r2(a.brita.m3); }
            if (a.malha) o.malhaPaineis = a.malha.paineis;
          }
          return o;
        })
      },
      totais: r.totais ? {
        areaM2: r2(r.totais.areaM2),
        pedraKg: r2(r.totais.pedra.kg), pedraSacos: r.totais.pedra.sacos,
        resinaKg: r2(r.totais.resina.kg), resinaKits: r.totais.resina.kits,
        britaKg: r.totais.brita ? r2(r.totais.brita.kg) : null,
        britaM3: r.totais.brita ? r2(r.totais.brita.m3) : null,
        britaSacos: r.totais.brita ? r.totais.brita.sacos : null,
        malhaPaineis: r.totais.malha ? r.totais.malha.paineis : null
      } : null,
      enviadoEm: new Date().toISOString()
    };
    if (extra) {
      p.lead.email = String(extra.email || "").trim().slice(0, 254);
      p.entrada = entradaDaObra(obra);
      p.id = String(extra.id || "").slice(0, 64);
      p.pagina = String(extra.pagina || "").slice(0, 60);
      p.teste = !!extra.teste;
      p.hp = String(extra.hp || "").slice(0, 200);   // campo isca: gente não preenche
    }
    return p;
  }

  var api = {
    TABELA: TABELA,
    versao: TABELA.versao,
    parseNumero: parseNumero,
    fmt: fmt, fmtAuto: fmtAuto, fmtKg: fmtKg, fmtM3: fmtM3, fmtCmDeMm: fmtCmDeMm, fmtMm: fmtMm, qtd: qtd,
    perfil: perfil, graoRotulo: graoRotulo, graoFrase: graoFrase, espessuraLimites: espessuraLimites, basesDoUso: basesDoUso,
    validarAmbiente: validarAmbiente,
    calcularAmbiente: calcularAmbiente,
    calcularObra: calcularObra,
    aviso: aviso, premissaBase: premissaBase, SEGURANCA: SEGURANCA, AVISO_CURTO: AVISO_CURTO, AVISO_ABERTURA: AVISO_ABERTURA,
    recomendadosDaObra: recomendadosDaObra,
    linhasMateriais: linhasMateriais,
    mensagemWhatsApp: mensagemWhatsApp,
    textoLista: textoLista,
    montarPayload: montarPayload,
    entradaDaObra: entradaDaObra,
    nomeAmbiente: nomeAmbiente,
    tiposDaObra: tiposDaObra
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.StoneDrenCalc = api;
})(typeof window !== "undefined" ? window : null);
