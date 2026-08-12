/* LaPink — Utilitários compartilhados admin */

// Service Worker do painel: serve CSS/JS/fontes do cache na hora e atualiza
// em segundo plano, o que tira a ida ao servidor por arquivo a cada troca de
// aba. Nunca guarda HTML (ver admin/sw-admin.js). Escopo /admin/ — não
// interfere no service worker da loja, que fica em /public/.
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw-admin.js').catch(function (e) {
      console.warn('[admin] service worker não registrado:', e && e.message);
    });
  });
}

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
  try {
    localStorage.setItem('lapinkProdutos', JSON.stringify(arr));
  } catch (e) {
    // Fotos em base64 deixam o catálogo perto do limite do navegador (~5 MB).
    // Estourando o limite, o setItem lança e NADA é salvo — antes isso
    // acontecia em silêncio e parecia que o produto tinha sido gravado.
    console.error('[produtos] falha ao salvar no navegador:', e && e.message);
    if (typeof showToast === 'function') {
      showToast('Armazenamento do navegador cheio — o produto NÃO foi salvo. Remova fotos ou produtos antigos e tente de novo.', 'erro');
    }
    throw e;
  }
}

/* ── Categorias da loja (fonte única: localStorage lapinkCategorias) ── */
var CATEGORIAS_PADRAO = ['Anéis','Brincos','Berloques','Chokers','Colares','Conjuntos','Piercing Pressão','Pulseiras','Bolsas'];

function getCategorias() {
  try {
    var arr = JSON.parse(localStorage.getItem('lapinkCategorias') || 'null');
    if (Array.isArray(arr) && arr.length) return arr;
  } catch(e) {}
  return CATEGORIAS_PADRAO.slice();
}

function saveCategorias(arr) {
  localStorage.setItem('lapinkCategorias', JSON.stringify(arr));
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

/* ── Status de pedido — fonte única (mesma regra de pedidos.html) ──
   Fluxo: aguardando → pagamento_analise → pedido_analise → pago →
          nota_fiscal → separacao → transporte | negado | cancelado */
var STATUS_PEDIDO_LEGADO = {
  aguardando_pagamento:   'pagamento_analise',
  aguardando_confirmacao: 'pagamento_analise',
  preparando:             'separacao',
  enviado:                'transporte',
  concluido:              'pago'
};
var STATUS_PEDIDO_LABELS = {
  aguardando:        'Aguardando',
  pagamento_analise: 'Pagamento em análise',
  pedido_analise:    'Pedido em análise',
  pago:              'Pago',
  nota_fiscal:       'Nota fiscal',
  separacao:         'Separação',
  transporte:        'Transporte',
  negado:            'Negado',
  cancelado:         'Cancelado'
};

// Normaliza status (legado → atual)
function normStatusPedido(st) {
  st = String(st || 'aguardando').toLowerCase();
  return STATUS_PEDIDO_LEGADO[st] || st;
}

// Pedido conta para a receita? (não cancelado nem negado)
function isPedidoAtivo(p) {
  var st = normStatusPedido(p && p.status);
  return st !== 'cancelado' && st !== 'negado';
}

// Pedido está pago? Flag manual (financeiro) OU status de pagamento confirmado
function isPedidoPago(p) {
  if (p && p.pago === true) return true;
  var st = normStatusPedido(p && p.status);
  return st === 'pago' || st === 'nota_fiscal' || st === 'separacao' || st === 'transporte';
}

// Pedido aguardando pagamento/confirmação (pendente de recebimento)
function isPedidoPendente(p) {
  return isPedidoAtivo(p) && !isPedidoPago(p);
}

/* ── Baixa de estoque de pedido local ───────────────────────────
   Só baixa pedidos com estoqueBaixado === false (checkout WhatsApp).
   Pedidos criados pelo admin já baixam na criação (flag undefined) e
   pedidos do Mercado Pago baixam no webhook — ambos ficam intactos. */
function baixarEstoquePedidoLocal(pedido) {
  if (!pedido || pedido.estoqueBaixado !== false || !Array.isArray(pedido.itens)) return false;
  var prods = getProdutos();
  var mudou = false;
  pedido.itens.forEach(function (it) {
    var i = prods.findIndex(function (p) {
      return (it.id != null && String(p.id) === String(it.id)) || (it.id == null && p.nome === it.nome);
    });
    if (i >= 0) {
      prods[i].estoque = Math.max(0, (parseInt(prods[i].estoque) || 0) - (it.qty || 1));
      mudou = true;
    }
  });
  if (mudou) saveProdutos(prods);
  pedido.estoqueBaixado = true;
  return mudou;
}

/* ── Preço / custo / lucro / margem de produto — fonte única ──
   O preço de venda é o de atacado (precoAtacado === precoVarejo, legado).
   custoTotal = peça bruta + banho×peso. margemLucro é % sobre o custo. */
function _numProduto(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  return parseBRL(String(v || '0'));
}

function getPrecoProduto(p) {
  return _numProduto(p.precoAtacado) || _numProduto(p.precoVarejo);
}

function getCustoProduto(p) {
  return _numProduto(p.custoTotal);
}

function getLucroProduto(p) {
  if (p.lucroUnitario !== undefined && p.lucroUnitario !== null && p.lucroUnitario !== '') {
    return _numProduto(p.lucroUnitario);
  }
  var preco = getPrecoProduto(p);
  var custo = getCustoProduto(p);
  return preco > 0 && custo > 0 ? preco - custo : 0;
}

function getMargemProduto(p) {
  if (p.margemLucro !== undefined && p.margemLucro !== null && p.margemLucro !== '') {
    var m = _numProduto(p.margemLucro);
    if (m > 0) return m;
  }
  var custo = getCustoProduto(p);
  var lucro = getLucroProduto(p);
  return custo > 0 ? (lucro / custo) * 100 : 0;
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

// ─── Seed v3 — SÓ para instalação vazia, e NUNCA sobe para a nuvem ───
//
// ATENÇÃO ao mexer aqui: este seed já apagou o catálogo real três vezes.
// Ele rodava sempre que a chave lapinkSeedV não estivesse neste navegador
// (navegador novo, "limpar dados", aba anônima, outro computador, ou a
// expiração automática de storage do Safari/iOS) e chamava saveProdutos()
// direto. Como o cloud-sync intercepta o setItem, os 61 produtos SEM FOTO
// de data/produtos.json subiam para o Firestore e substituíam o catálogo
// real — apagando as fotos de todos os produtos, para todo mundo.
//
// Agora existem três travas independentes:
//   1. se já existe catálogo neste dispositivo, o seed nem chega a rodar;
//   2. antes de semear, espera (e força) o download do catálogo da nuvem;
//   3. o seed grava com o setItem ORIGINAL, capturado antes do cloud-sync
//      instalar o interceptador — ou seja, fica só neste navegador e é
//      incapaz, por construção, de sobrescrever o catálogo da nuvem.
var _rawSetItem = Storage.prototype.setItem; // nativo: utils.js carrega antes do cloud-sync

window.lapinkReady = (function() {
  if (localStorage.getItem('lapinkSeedV') === '3') return Promise.resolve();

  function _temCatalogo() {
    try {
      var a = JSON.parse(localStorage.getItem('lapinkProdutos') || '[]');
      return Array.isArray(a) && a.length > 0;
    } catch (e) { return false; }
  }

  function _marcarFeito() {
    try { _rawSetItem.call(localStorage, 'lapinkSeedV', '3'); } catch (e) {}
  }

  // Trava 1 — já tem catálogo aqui: não há nada para semear.
  if (_temCatalogo()) { _marcarFeito(); return Promise.resolve(); }

  // Trava 2 — catálogo local vazio quase sempre significa "navegador novo",
  // e não "loja nova": o catálogo real ainda está vindo da nuvem. Espera o
  // cloud-sync entregar (forçando um pull, que ignora o intervalo mínimo).
  function _esperarNuvem(msMax) {
    return new Promise(function(resolve) {
      var t0 = Date.now(), forcou = false;
      (function tick() {
        if (_temCatalogo()) return resolve(true);
        if (!forcou && window.LaPinkSync && window.LaPinkSync.pull) {
          forcou = true;
          try { window.LaPinkSync.pull(); } catch (e) {}
        }
        if (Date.now() - t0 >= msMax) return resolve(false);
        setTimeout(tick, 300);
      })();
    });
  }

  function _aplicarLista(lista) {
    // Trava 3 — reconfere na hora de gravar (a nuvem pode ter chegado
    // durante o fetch) e grava sem passar pelo interceptador do cloud-sync.
    if (_temCatalogo()) { _marcarFeito(); return; }
    try {
      _rawSetItem.call(localStorage, 'lapinkProdutos', JSON.stringify(lista));
    } catch (e) {
      console.warn('[seed] não foi possível gravar o catálogo local:', e && e.message);
      return;
    }
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('lapinkLojaConfig')) || {}; } catch(e) {}
    if (!Array.isArray(cfg.destaque) || cfg.destaque.length < 5) {
      cfg.destaque = lista.slice(0, 15).map(function(p) { return { id: p.id, badge: '' }; });
      try { _rawSetItem.call(localStorage, 'lapinkLojaConfig', JSON.stringify(cfg)); } catch(e) {}
    }
    _marcarFeito();
    document.dispatchEvent(new CustomEvent('lapinkProdutosAtualizados'));
  }

  return _esperarNuvem(12000).then(function(veioDaNuvem) {
    if (veioDaNuvem || _temCatalogo()) { _marcarFeito(); return; }
    return _semearDoArquivo();
  });

  function _semearDoArquivo() {
  return fetch('../data/produtos.json')
    .then(function(r) { return r.json(); })
    .then(function(lista) { _aplicarLista(lista); })
    .catch(function() {
      // fallback caso o arquivo não esteja acessível via HTTP
      var IC = {
        'Anel':'ti-circle','Brinco':'ti-star','Berloque':'ti-bookmark',
        'Chocker':'ti-circle-dashed','Colar':'ti-diamond','Conjunto':'ti-package',
        'Piercing Pressão':'ti-circle-dot','Pulseira':'ti-bracelet','Bolsa':'ti-shopping-bag'
      };
      var fb = [
        {n:'PIERCING DE PRESSÃO CRAVEJADO',c:'Piercing Pressão',p:1.50,b:0.95,v:15.90},
        {n:'PIERCING PRESSÃO CORRENTE DOURADO',c:'Piercing Pressão',p:0.95,b:0,v:15.90},
        {n:'ESCAPULÁRIO "FOCO, FORÇA E FÉ"',c:'Colar',p:0.70,b:0,v:9.90},
        {n:'PULSEIRA AMOR DE MÃE',c:'Pulseira',p:0.70,b:0,v:12.90},
        {n:'PIERCING LISO DOURADO',c:'Piercing Pressão',p:0.70,b:0,v:9.99},
        {n:'PULSEIRA MEDALHA MUNDO',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'COLAR COROA',c:'Colar',p:0.70,b:0,v:19.90},
        {n:'BRINCO PRAIANA CONCHA',c:'Brinco',p:0.70,b:0,v:19.90},
        {n:'CONJUNTO CORAÇÃO DIAMANTADO',c:'Conjunto',p:0.70,b:0,v:21.90},
        {n:'BRINCO MÃO DE FÁTIMA',c:'Brinco',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA PÉROLA',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'ANEL TREVINHO DIAMANTADO AJUSTÁVEL',c:'Anel',p:0.70,b:0,v:15.90},
        {n:'ANEL BORBOLETA DIAMANTADA AJUSTÁVEL',c:'Anel',p:0.70,b:0,v:16.90},
        {n:'PULSEIRA PAI NOSSO ZIRCÔNIA',c:'Pulseira',p:0.70,b:0,v:39.90},
        {n:'ANEL AJUSTÁVEL ESTRELA CRAVEJADA',c:'Anel',p:0.70,b:0,v:15.90},
        {n:'COLAR TREVO 4 FOLHAS',c:'Colar',p:0.70,b:0,v:16.90},
        {n:'COLAR CORAÇÃO DIAMANTADO',c:'Colar',p:0.70,b:0,v:16.90},
        {n:'COLAR MARGARIDA',c:'Colar',p:0.70,b:0,v:15.90},
        {n:'COLAR I LOVE YOU',c:'Colar',p:0.70,b:0,v:13.90},
        {n:'ANEL CRAVEJADO PREGO TAM 16',c:'Anel',p:0.70,b:0,v:19.90},
        {n:'ANEL AJUSTÁVEL LISO',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'ANEL TREVO CRAVEJADO',c:'Anel',p:0.70,b:0,v:19.90},
        {n:'ANEL TRIÂNGULO ZIRCÔNIA',c:'Anel',p:0.70,b:0,v:15.90},
        {n:'ANEL NÃO AJUSTÁVEL',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'ANEL FLOR AJUSTÁVEL',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'ANEL AJUSTÁVEL LUA',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'ANEL AJUSTÁVEL OLHO',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'ANEL SOLITÁRIO AJUSTÁVEL',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'ANEL CORAÇÃO AJUSTÁVEL DIAMANTADO',c:'Anel',p:0.70,b:0,v:14.90},
        {n:'COLAR ELOS CARTIER + CORAÇÃO ZIRCÔNIA',c:'Colar',p:0.70,b:0,v:17.90},
        {n:'CHOCKER ENROLADA DIAMANTADA',c:'Chocker',p:0.70,b:0,v:15.90},
        {n:'CHOCKER CORDÃO BAHIANO',c:'Chocker',p:0.70,b:0,v:16.90},
        {n:'CHOCKER FITA LAMINADA 2mm',c:'Chocker',p:0.70,b:0,v:16.90},
        {n:'PULSEIRA BLUE',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA CORAÇÃO',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA TREVO',c:'Pulseira',p:0.70,b:0,v:15.90},
        {n:'PULSEIRA ZIRCÔNIA',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA ESCAMA VAZADA',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA PREMICIA DIAMANTADA',c:'Pulseira',p:0.70,b:0,v:16.90},
        {n:'PULSEIRA ZIRCÔNIA ROSA',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA OLHO GREGO',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA TRIO MINIMALISTA',c:'Pulseira',p:0.70,b:0,v:17.90},
        {n:'PULSEIRA CORDÃO BAHIANO',c:'Pulseira',p:0.70,b:0,v:16.90},
        {n:'PULSEIRA CORAÇÃO + PONTOS ROSA',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'PULSEIRA FITA LAMINADA 2mm',c:'Pulseira',p:0.70,b:0,v:14.90},
        {n:'BRINCO QUADRADINHO',c:'Brinco',p:0.70,b:0,v:14.90},
        {n:'BRINCO V DIAMANTADO',c:'Brinco',p:0.70,b:0,v:15.90},
        {n:'BERLOQUE FLOCO DE NEVE',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'BERLOQUE OLHO',c:'Berloque',p:0.70,b:0,v:15.90},
        {n:'BERLOQUE LOVE ROSA',c:'Berloque',p:0.70,b:0,v:15.90},
        {n:'SEPARADOR BERLOQUE FLOR',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'BERLOQUE BELIEVE "ACREDITAR"',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'BERLOQUE SEPARADOR CORAÇÃO ROSA',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'BERLOQUE ESTETOSCÓPIO CORAÇÃO',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'BERLOQUE CHOCOLATE',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'BERLOQUE ALOHA',c:'Berloque',p:0.70,b:0,v:17.90},
        {n:'PULSEIRA PARA BERLOQUES FECHO CORAÇÃO',c:'Pulseira',p:0.70,b:0,v:29.90},
        {n:'PULSEIRA PARA BERLOQUES FECHO TRADICIONAL',c:'Pulseira',p:0.70,b:0,v:29.90},
        {n:'BRINCO MADRE PÉROLA',c:'Brinco',p:0.70,b:0,v:14.90},
        {n:'PIERCING PRESSÃO',c:'Piercing Pressão',p:0.70,b:0,v:9.90},
        {n:'BERLOQUE AVIÃO',c:'Berloque',p:0,b:0,v:17.90}
      ].map(function(x,i){
        var custo=x.p+x.b;
        return {id:1700000000001+i,codigoPeca:String(100001+i),nome:x.n,categoria:x.c,
          icone:IC[x.c]||'ti-diamond',imagem:null,estoque:0,precoVarejo:x.v,
          precoAtacado:Math.round(x.v*0.8*100)/100,
          custoPecaDireto:x.p||undefined,custoBanhoDireto:x.b||undefined,
          custoTotal:custo||undefined,margemLucro:custo>0?Math.round((x.v-custo)/custo*100):undefined};
      });
      _aplicarLista(fb);
    });
  }
})();
