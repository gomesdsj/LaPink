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

// ─── Seed v3 — carrega de data/produtos.json (pasta como servidor) ───
window.lapinkReady = (function() {
  if (localStorage.getItem('lapinkSeedV') === '3') return Promise.resolve();

  function _aplicarLista(lista) {
    saveProdutos(lista);
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('lapinkLojaConfig')) || {}; } catch(e) {}
    if (!Array.isArray(cfg.destaque) || cfg.destaque.length < 5) {
      cfg.destaque = lista.slice(0, 15).map(function(p) { return { id: p.id, badge: '' }; });
      localStorage.setItem('lapinkLojaConfig', JSON.stringify(cfg));
    }
    localStorage.setItem('lapinkSeedV', '3');
    document.dispatchEvent(new CustomEvent('lapinkProdutosAtualizados'));
  }

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
})();
