/* LaPink — cálculo único de promoções por produto (frontend).
   O backend repete a validação antes de cobrar; este arquivo cuida só da UI. */
(function (g) {
  'use strict';

  function numero(v) {
    v = Number(v);
    return Number.isFinite(v) ? v : 0;
  }

  function precoOriginal(produto) {
    if (!produto) return 0;
    return Math.max(0, numero(produto.precoAtacado) || numero(produto.precoVarejo));
  }

  function dataMs(v, fimDoDia) {
    if (!v) return null;
    var s = String(v);
    var d = /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? new Date(s + (fimDoDia ? 'T23:59:59.999' : 'T00:00:00'))
      : new Date(s);
    var n = d.getTime();
    return Number.isFinite(n) ? n : null;
  }

  function listar() {
    try {
      var d = JSON.parse(localStorage.getItem('lapinkDescontos') || '[]');
      return Array.isArray(d) ? d : [];
    } catch (e) { return []; }
  }

  function melhorPara(produto, descontos, agora) {
    var id = String(produto && produto.id);
    var momento = numero(agora) || Date.now();
    var melhor = null;
    (Array.isArray(descontos) ? descontos : listar()).forEach(function (d) {
      var pct = numero(d && d.percentual);
      var inicio = dataMs(d && d.inicio, false);
      var fim = dataMs(d && d.fim, true);
      var ids = d && Array.isArray(d.produtoIds) ? d.produtoIds.map(String) : [];
      if (!d || d.ativo !== true || pct <= 0 || pct > 100 || ids.indexOf(id) < 0) return;
      if ((inicio !== null && momento < inicio) || (fim !== null && momento > fim)) return;
      if (!melhor || pct > melhor.percentual) melhor = { id: String(d.id), nome: String(d.nome || 'Promoção'), percentual: pct };
    });
    return melhor;
  }

  function calcular(produto, descontos, agora) {
    var original = precoOriginal(produto);
    var promocao = melhorPara(produto, descontos, agora);
    var pct = promocao ? promocao.percentual : 0;
    var final = Math.max(0, Math.round(original * (1 - pct / 100) * 100) / 100);
    return {
      precoOriginal: original,
      descontoPct: pct,
      descontoValor: Math.round((original - final) * 100) / 100,
      precoFinal: final,
      promocaoId: promocao ? promocao.id : null,
      promocaoNome: promocao ? promocao.nome : null
    };
  }

  g.LaPinkDescontos = { listar: listar, precoOriginal: precoOriginal, melhorPara: melhorPara, calcular: calcular };
})(window);
