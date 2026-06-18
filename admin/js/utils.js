/* LaPink — Utilitários compartilhados admin */

function formatBRL(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseBRL(s) {
  return parseFloat(String(s || '0').replace(/[^\d,]/g, '').replace(',', '.')) || 0;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, tipo) {
  var t = document.createElement('div');
  t.className = 'toast' + (tipo === 'erro' ? ' toast-erro' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.classList.add('toast-hide'); setTimeout(function() { t.remove(); }, 400); }, 3000);
}

function getProdutos() {
  try { return JSON.parse(localStorage.getItem('lapinkProdutos') || '[]'); } catch(e) { return []; }
}

function saveProdutos(arr) {
  localStorage.setItem('lapinkProdutos', JSON.stringify(arr));
}

function getPedidos() {
  try { return JSON.parse(localStorage.getItem('lapinkPedidos') || '[]'); } catch(e) { return []; }
}

function savePedidos(arr) {
  localStorage.setItem('lapinkPedidos', JSON.stringify(arr));
}

function getClients() {
  try { return JSON.parse(localStorage.getItem('lapinkClients') || '[]'); } catch(e) { return []; }
}

function saveClients(arr) {
  localStorage.setItem('lapinkClients', JSON.stringify(arr));
}

function formatPesoInput(input) {
  var raw = input.value.replace(/\D/g, '').replace(/^0+/, '') || '0';
  while (raw.length < 4) raw = '0' + raw;
  input.value = (raw.slice(0, -3) || '0') + ',' + raw.slice(-3);
}

function parsePesoGramas(v) {
  var s = String(v || '').replace(',', '.');
  return Math.round(parseFloat(s) * 1000) || 0;
}

function parseCustoG(v) {
  return parseFloat(String(v || '0').replace(',', '.')) || 0;
}

// ─── Seed inicial — popula lapinkProdutos se ainda estiver vazio ───
(function seedProdutosLaPink() {
  try {
    var atual = JSON.parse(localStorage.getItem('lapinkProdutos') || '[]');
    if (atual.length > 0) return; // já tem dados, não sobrescreve
  } catch(e) {}

  var IC = {
    'Anel': 'ti-circle', 'Brinco': 'ti-star', 'Berloque': 'ti-bookmark',
    'Chocker': 'ti-circle-dashed', 'Colar': 'ti-diamond', 'Conjunto': 'ti-package',
    'Piercing Pressão': 'ti-circle-dot', 'Pulseira': 'ti-bracelet', 'Bolsa': 'ti-shopping-bag'
  };

  var BASE = 1700000000000;
  var produtos = [
    { nome: 'PIERCING DE PRESSÃO CRAVEJADO',          cat: 'Piercing Pressão', peca: 1.50, banho: 0.95, vr: 15.90 },
    { nome: 'PIERCING PRESSÃO CORRENTE DOURADO',       cat: 'Piercing Pressão', peca: 0.95, banho: 0,    vr: 15.90 },
    { nome: 'ESCAPULÁRIO "FOCO, FORÇA E FÉ"',         cat: 'Colar',            peca: 0.70, banho: 0,    vr: 9.90  },
    { nome: 'PULSEIRA AMOR DE MÃE',                   cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 12.90 },
    { nome: 'PIERCING LISO DOURADO',                  cat: 'Piercing Pressão', peca: 0.70, banho: 0,    vr: 9.99  },
    { nome: 'PULSEIRA MEDALHA MUNDO',                 cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'COLAR COROA',                            cat: 'Colar',            peca: 0.70, banho: 0,    vr: 19.90 },
    { nome: 'BRINCO PRAIANA CONCHA',                  cat: 'Brinco',           peca: 0.70, banho: 0,    vr: 19.90 },
    { nome: 'CONJUNTO CORAÇÃO DIAMANTADO',            cat: 'Conjunto',         peca: 0.70, banho: 0,    vr: 21.90 },
    { nome: 'BRINCO MÃO DE FÁTIMA',                  cat: 'Brinco',           peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA PÉROLA',                        cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL TREVINHO DIAMANTADO AJUSTÁVEL',     cat: 'Anel',             peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'ANEL BORBOLETA DIAMANTADA AJUSTÁVEL',    cat: 'Anel',             peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'PULSEIRA PAI NOSSO ZIRCÔNIA',            cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 39.90 },
    { nome: 'ANEL AJUSTÁVEL ESTRELA CRAVEJADA',       cat: 'Anel',             peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'COLAR TREVO 4 FOLHAS',                   cat: 'Colar',            peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'COLAR CORAÇÃO DIAMANTADO',               cat: 'Colar',            peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'COLAR MARGARIDA',                        cat: 'Colar',            peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'COLAR I LOVE YOU',                       cat: 'Colar',            peca: 0.70, banho: 0,    vr: 13.90 },
    { nome: 'ANEL CRAVEJADO PREGO TAM 16',            cat: 'Anel',             peca: 0.70, banho: 0,    vr: 19.90 },
    { nome: 'ANEL AJUSTÁVEL LISO',                    cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL TREVO CRAVEJADO ×2',                cat: 'Anel',             peca: 0.70, banho: 0,    vr: 19.90 },
    { nome: 'ANEL TRIÂNGULO ZIRCÔNIA',                cat: 'Anel',             peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'ANEL NÃO AJUSTÁVEL',                     cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL FLOR AJUSTÁVEL',                    cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL AJUSTÁVEL LUA',                     cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL AJUSTÁVEL OLHO',                    cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL SOLITÁRIO AJUSTÁVEL',               cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'ANEL CORAÇÃO AJUSTÁVEL DIAMANTADO',      cat: 'Anel',             peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'COLAR ELOS CARTIER + CORAÇÃO ZIRCÔNIA',  cat: 'Colar',            peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'CHOCKER ENROLADA DIAMANTADA',            cat: 'Chocker',          peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'CHOCKER CORDÃO BAHIANO',                 cat: 'Chocker',          peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'CHOCKER FITA LAMINADA 2mm',              cat: 'Chocker',          peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'PULSEIRA BLUE',                          cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA CORAÇÃO ×2',                   cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA TREVO',                         cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'PULSEIRA ZIRCÔNIA ×2',                  cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA ESCAMA VAZADA',                 cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA PREMICIA DIAMANTADA',           cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'PULSEIRA ZIRCÔNIA ROSA',                 cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA OLHO GREGO',                    cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA TRIO MINIMALISTA',              cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'PULSEIRA CORDÃO BAHIANO',                cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 16.90 },
    { nome: 'PULSEIRA CORAÇÃO + PONTOS ROSA',         cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PULSEIRA FITA LAMINADA 2mm',             cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'BRINCO QUADRADINHO ×2',                 cat: 'Brinco',           peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'BRINCO V DIAMANTADO',                    cat: 'Brinco',           peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'BERLOQUE FLOCO DE NEVE',                 cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'BERLOQUE OLHO',                          cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'BERLOQUE LOVE ROSA',                     cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 15.90 },
    { nome: 'SEPARADOR BERLOQUE FLOR',                cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'BERLOQUE BELIEVE "ACREDITAR"',           cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'BERLOQUE SEPARADOR CORAÇÃO ROSA',        cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'BERLOQUE ESTETOSCÓPIO CORAÇÃO',          cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'BERLOQUE CHOCOLATE',                     cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'BERLOQUE ALOHA',                         cat: 'Berloque',         peca: 0.70, banho: 0,    vr: 17.90 },
    { nome: 'PULSEIRA P/ BERLOQUES FECHO CORAÇÃO',   cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 29.90 },
    { nome: 'PULSEIRA P/ BERLOQUES FECHO TRAD.',     cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 29.90 },
    { nome: 'PULSEIRA P/ BERLOQUES FECHO TRAD. II',  cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 29.90 },
    { nome: 'PULSEIRA P/ BERLOQUES FECHO TRAD. III', cat: 'Pulseira',         peca: 0.70, banho: 0,    vr: 29.90 },
    { nome: 'BRINCO MADRE PÉROLA',                   cat: 'Brinco',           peca: 0.70, banho: 0,    vr: 14.90 },
    { nome: 'PIERCING PRESSÃO',                       cat: 'Piercing Pressão', peca: 0.70, banho: 0,    vr: 9.90  },
    { nome: 'PIERCING PRESSÃO II',                    cat: 'Piercing Pressão', peca: 0.70, banho: 0,    vr: 9.90  },
    { nome: 'PIERCING PRESSÃO III',                   cat: 'Piercing Pressão', peca: 0.70, banho: 0,    vr: 9.90  },
    { nome: 'BERLOQUE AVIÃO',                         cat: 'Berloque',         peca: 0,    banho: 0,    vr: 17.90 }
  ];

  var lista = produtos.map(function(p, i) {
    var custo = p.peca + p.banho;
    var mar   = custo > 0 ? Math.round((p.vr - custo) / custo * 100) : 0;
    return {
      id:               BASE + i,
      codigoPeca:       String(100001 + i),
      nome:             p.nome,
      categoria:        p.cat,
      icone:            IC[p.cat] || 'ti-diamond',
      imagem:           null,
      estoque:          0,
      precoVarejo:      p.vr,
      precoAtacado:     Math.round(p.vr * 0.8 * 100) / 100,
      custoPecaDireto:  p.peca || undefined,
      custoBanhoDireto: p.banho || undefined,
      custoTotal:       custo || undefined,
      margemLucro:      mar   || undefined
    };
  });

  try {
    localStorage.setItem('lapinkProdutos', JSON.stringify(lista));

    // Configura os 15 primeiros como destaque se ainda não houver configuração
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('lapinkLojaConfig')) || {}; } catch(e2) {}
    if (!Array.isArray(cfg.destaque) || cfg.destaque.length < 5) {
      cfg.destaque = lista.slice(0, 15).map(function(p) { return { id: p.id, badge: '' }; });
      localStorage.setItem('lapinkLojaConfig', JSON.stringify(cfg));
    }
  } catch(e) {}
})();
