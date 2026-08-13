/**
 * LaPink — Camada de API
 *
 * Abstração de dados pronta para banco de dados.
 * Hoje usa localStorage como backend. Quando o banco estiver
 * contratado, basta:
 *   1. Ajustar API_BASE_URL para a URL do servidor
 *   2. Trocar USE_REMOTE para true
 *   3. O resto do código permanece idêntico.
 *
 * Endpoints esperados (REST):
 *   GET/POST/PUT/DELETE /produtos
 *   GET/POST/PUT/DELETE /pedidos
 *   GET/POST/PUT/DELETE /clientes
 *   POST                /uploads          (retorna { url: '...' })
 *   GET                 /dashboard/stats
 *   GET/PUT             /config
 *   GET/PUT             /loja/config
 */

'use strict';
var LaPinkAPI = (function () {

  /* ── Configuração ──────────────────────────────────────────── */
  var USE_REMOTE   = false;                       // true → chama o servidor real
  var API_BASE_URL = 'https://api.lapink.com.br'; // URL do futuro back-end

  /* ── Chaves de localStorage (fallback offline) ─────────────── */
  var K = {
    produtos    : 'lapinkProdutos',
    pedidos     : 'lapinkPedidos',
    clients     : 'lapinkClients',
    users       : 'lapinkUsers',
    config      : 'lapinkStoreConfig',
    lojaConfig  : 'lapinkLojaConfig',
    counter     : 'lapinkPedidoCounter',
    token       : 'lapinkApiToken'
  };

  /* ── Helpers internos ──────────────────────────────────────── */
  function _get(key)      { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) { return null; } }
  function _set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function _token() { return _get(K.token) || ''; }

  function _fetch(method, path, body, multipart) {
    var opts = {
      method  : method,
      headers : { 'Authorization': 'Bearer ' + _token() }
    };
    if (body && !multipart) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (multipart) {
      opts.body = body; // FormData — não define Content-Type
    }
    return fetch(API_BASE_URL + path, opts)
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.message || 'HTTP ' + r.status); });
        return r.json();
      });
  }

  /* ═══════════════════════════════════════════════════════════
     PRODUTOS
  ═══════════════════════════════════════════════════════════ */
  function getProdutos() {
    if (USE_REMOTE) return _fetch('GET', '/api/produtos');
    return Promise.resolve(_get(K.produtos) || []);
  }

  function saveProduto(produto) {
    if (USE_REMOTE) {
      return produto.id
        ? _fetch('PUT',  '/api/produtos/' + produto.id, produto)
        : _fetch('POST', '/api/produtos', produto);
    }
    var lista = _get(K.produtos) || [];
    if (produto.id) {
      var i = lista.findIndex(function(p) { return p.id === produto.id; });
      if (i >= 0) lista[i] = produto; else lista.push(produto);
    } else {
      produto.id = Date.now();
      lista.push(produto);
    }
    _set(K.produtos, lista);
    return Promise.resolve(produto);
  }

  function deleteProduto(id) {
    if (USE_REMOTE) return _fetch('DELETE', '/api/produtos/' + id);
    _set(K.produtos, (_get(K.produtos) || []).filter(function(p) { return p.id !== id; }));
    return Promise.resolve({ ok: true });
  }

  /* ═══════════════════════════════════════════════════════════
     IMAGENS — upload pronto para S3 / Cloudinary / local
  ═══════════════════════════════════════════════════════════ */
  /**
   * uploadImagem(file) → Promise<string>
   *
   * Remoto : POST /api/uploads  (multipart/form-data)
   *          resposta: { url: 'https://cdn.lapink.com.br/img/abc.jpg' }
   *
   * Local  : converte para base64 e armazena no produto.
   *          Limite prático: ~1 MB por imagem (localStorage 5 MB total).
   *          Quando o banco estiver pronto, as imagens antigas podem ser
   *          migradas com um script de migração.
   */
  function uploadImagem(file) {
    if (USE_REMOTE) {
      var form = new FormData();
      form.append('file', file);
      return _fetch('POST', '/api/uploads', form, true).then(function(d) { return d.url; });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload  = function (e) { resolve(e.target.result); };
      reader.onerror = function ()  { reject(new Error('Falha ao ler imagem.')); };
      reader.readAsDataURL(file);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     PEDIDOS
  ═══════════════════════════════════════════════════════════ */
  function getPedidos() {
    if (USE_REMOTE) return _fetch('GET', '/api/pedidos');
    return Promise.resolve(_get(K.pedidos) || []);
  }

  /* Pedidos da coleção 'pedidos' do Firestore — é onde a Cloud Function grava
     as compras que passam pelo Mercado Pago. O localStorage (lapinkPedidos) só
     guarda os pedidos lançados à mão no painel. As telas de Pedidos e
     Relatórios já liam as duas fontes; o Dashboard lia só o localStorage e por
     isso ignorava as vendas de verdade. */
  function _pedidosFirestore() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
        return Promise.resolve([]);
      }
      var espera = (typeof aguardarFirebaseAuth === 'function')
        ? aguardarFirebaseAuth()
        : Promise.resolve();

      return espera
        .then(function () {
          return firebase.firestore().collection('pedidos')
            .orderBy('createdAt', 'desc').limit(200).get();
        })
        .then(function (snap) {
          var out = [];
          snap.forEach(function (doc) {
            var d = doc.data() || {};
            d._id = doc.id;
            d._fonte = 'firestore';
            // Pedido do Firestore usa createdAt (Timestamp); o resto do
            // sistema espera 'data' como string ISO.
            if (!d.data && d.createdAt && d.createdAt.seconds) {
              d.data = new Date(d.createdAt.seconds * 1000).toISOString();
            }
            out.push(d);
          });
          return out;
        })
        .catch(function (e) {
          console.warn('[api] não foi possível ler a coleção pedidos:', e && e.message);
          return []; // falha aberta: segue com o que houver no localStorage
        });
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  /* Une as duas fontes. O Firestore tem prioridade quando o mesmo número de
     pedido existe nos dois lados (mesma regra usada em pedidos.html). */
  function getPedidosUnificados() {
    if (USE_REMOTE) return _fetch('GET', '/api/pedidos');
    return Promise.all([getPedidos(), _pedidosFirestore()])
      .then(function (r) {
        var locais = r[0] || [], remotos = r[1] || [];
        var numsRemotos = {};
        remotos.forEach(function (p) { if (p && p.numero) numsRemotos[p.numero] = true; });
        var soLocais = locais.filter(function (p) { return !(p && p.numero && numsRemotos[p.numero]); });
        return remotos.concat(soLocais);
      });
  }

  function savePedido(pedido) {
    if (USE_REMOTE) {
      return pedido.id
        ? _fetch('PUT',  '/api/pedidos/' + pedido.id, pedido)
        : _fetch('POST', '/api/pedidos', pedido);
    }
    var lista = _get(K.pedidos) || [];
    if (pedido.id) {
      var i = lista.findIndex(function(p) { return p.id === pedido.id; });
      if (i >= 0) lista[i] = pedido; else lista.push(pedido);
    } else {
      pedido.id = Date.now();
      lista.push(pedido);
    }
    _set(K.pedidos, lista);
    return Promise.resolve(pedido);
  }

  function updatePedidoStatus(id, status) {
    if (USE_REMOTE) return _fetch('PATCH', '/api/pedidos/' + id + '/status', { status: status });
    var lista = _get(K.pedidos) || [];
    var i = lista.findIndex(function(p) { return p.id === id; });
    if (i >= 0) lista[i].status = status;
    _set(K.pedidos, lista);
    return Promise.resolve({ ok: true });
  }

  function markPedidoPago(id, pago) {
    if (USE_REMOTE) return _fetch('PATCH', '/api/pedidos/' + id + '/pagamento', { pago: pago });
    var lista = _get(K.pedidos) || [];
    var i = lista.findIndex(function(p) { return p.id === id; });
    if (i >= 0) lista[i].pago = pago;
    _set(K.pedidos, lista);
    return Promise.resolve({ ok: true });
  }

  function deletePedido(id) {
    if (USE_REMOTE) return _fetch('DELETE', '/api/pedidos/' + id);
    _set(K.pedidos, (_get(K.pedidos) || []).filter(function(p) { return p.id !== id; }));
    return Promise.resolve({ ok: true });
  }

  /* ═══════════════════════════════════════════════════════════
     CLIENTES
  ═══════════════════════════════════════════════════════════ */
  function getClients() {
    if (USE_REMOTE) return _fetch('GET', '/api/clientes');
    return Promise.resolve(_get(K.clients) || []);
  }

  function saveClient(client) {
    if (USE_REMOTE) {
      return client.email
        ? _fetch('PUT',  '/api/clientes/' + encodeURIComponent(client.email), client)
        : _fetch('POST', '/api/clientes', client);
    }
    var lista = _get(K.clients) || [];
    var i = lista.findIndex(function(c) { return c.email === client.email; });
    if (i >= 0) lista[i] = client; else lista.push(client);
    _set(K.clients, lista);
    return Promise.resolve(client);
  }

  function deleteClient(email) {
    if (USE_REMOTE) return _fetch('DELETE', '/api/clientes/' + encodeURIComponent(email));
    _set(K.clients, (_get(K.clients) || []).filter(function(c) { return c.email !== email; }));
    return Promise.resolve({ ok: true });
  }

  /* ═══════════════════════════════════════════════════════════
     DASHBOARD — métricas agregadas
  ═══════════════════════════════════════════════════════════ */
  function getDashboardStats() {
    if (USE_REMOTE) return _fetch('GET', '/api/dashboard/stats');

    return Promise.all([getProdutos(), getPedidosUnificados(), getClients()])
      .then(function (res) {
        var produtos = res[0], pedidos = res[1], clientes = res[2];

        var agora    = new Date();
        var mesAtual = agora.getMonth();
        var anoAtual = agora.getFullYear();

        var receita = 0, receitaMes = 0, receitaAnterior = 0;
        var aReceber = 0, pedidosPendentes = 0;
        var pedidosMes = 0;
        var vendasPorMes   = {};
        var vendasPorStatus = {};
        var receitaPorCategoria = {};
        var topProdutos    = {};

        // Índices para cruzar item de pedido → produto e descobrir a
        // categoria. Tenta pelo id e, se o pedido for antigo e não tiver
        // gravado o id, cai para o nome.
        var prodPorId = {}, prodPorNome = {};
        produtos.forEach(function (p) {
          prodPorId[String(p.id)] = p;
          prodPorNome[String(p.nome || '').trim().toLowerCase()] = p;
        });

        pedidos.forEach(function (p) {
          var st    = normStatusPedido(p.status);
          var total = parseFloat(p.total) || 0;
          var data  = p.data ? new Date(p.data) : null;

          vendasPorStatus[st] = (vendasPorStatus[st] || 0) + 1;

          if (!isPedidoAtivo(p)) return; // cancelado/negado fora da receita

          receita += total;

          // Mês anterior para delta
          if (data) {
            var mesD = data.getMonth(), anoD = data.getFullYear();
            var chave = anoD + '-' + String(mesD + 1).padStart(2, '0');
            if (!vendasPorMes[chave]) vendasPorMes[chave] = { receita: 0, count: 0, pagos: 0 };
            vendasPorMes[chave].receita += total;
            vendasPorMes[chave].count++;
            if (isPedidoPago(p)) vendasPorMes[chave].pagos += total;

            if (mesD === mesAtual && anoD === anoAtual) {
              receitaMes += total;
              pedidosMes++;
            }
            var mA = mesAtual === 0 ? 11 : mesAtual - 1;
            var aA = mesAtual === 0 ? anoAtual - 1 : anoAtual;
            if (mesD === mA && anoD === aA) receitaAnterior += total;
          }

          // A receber (financeiro) — pago = flag manual OU status confirmado
          if (!isPedidoPago(p)) { aReceber += total; pedidosPendentes++; }

          // Top produtos e receita por categoria — ambos saem dos ITENS
          // vendidos, que é a única fonte real de "o que foi vendido".
          if (Array.isArray(p.itens)) {
            p.itens.forEach(function (item) {
              var n = item.nome || 'Produto';
              var valorItem = (parseFloat(item.preco) || 0) * (parseInt(item.qty) || 1);

              if (!topProdutos[n]) topProdutos[n] = { qtd: 0, receita: 0 };
              topProdutos[n].qtd     += parseInt(item.qty) || 1;
              topProdutos[n].receita += valorItem;

              var prod = (item.id != null && prodPorId[String(item.id)]) ||
                         prodPorNome[String(n).trim().toLowerCase()];
              var cat = (prod && prod.categoria) || 'Outros';
              receitaPorCategoria[cat] = (receitaPorCategoria[cat] || 0) + valorItem;
            });
          }
        });

        // Valor PARADO em estoque (estoque × preço de atacado). É outra coisa
        // que receita: mede o quanto está investido em mercadoria, não o que
        // foi vendido. Antes os dois viviam no mesmo campo, e o dashboard
        // mostrava valor de estoque debaixo do título "Receita por categoria".
        var estoquePorCategoria = {};
        var valorEstoqueTotal = 0;
        produtos.forEach(function (p) {
          var cat = p.categoria || 'Outros';
          var val = getPrecoProduto(p) * (parseInt(p.estoque) || 0);
          estoquePorCategoria[cat] = (estoquePorCategoria[cat] || 0) + val;
          valorEstoqueTotal += val;
        });

        var estoqueBaixo = produtos
          .filter(function (p) { return (parseInt(p.estoque) || 0) <= 5; })
          .sort(function (a, b) { return (parseInt(a.estoque) || 0) - (parseInt(b.estoque) || 0); });

        var deltaMes = receitaAnterior > 0
          ? ((receitaMes - receitaAnterior) / receitaAnterior * 100).toFixed(1)
          : null;

        return {
          receita          : { total: receita, mes: receitaMes, deltaPct: deltaMes },
          pedidos          : { total: pedidos.length, mes: pedidosMes, pendentes: pedidosPendentes },
          financeiro       : { aReceber: aReceber, cobPendentes: pedidosPendentes },
          clientes         : { total: clientes.length },
          produtos         : { total: produtos.length, estoqueBaixo: estoqueBaixo.length },
          estoque          : { valorTotal: valorEstoqueTotal, porCategoria: estoquePorCategoria },
          vendasPorMes     : vendasPorMes,
          vendasPorStatus  : vendasPorStatus,
          receitaCategoria : receitaPorCategoria,
          pedidosRecentes  : pedidos.slice().sort(function (a, b) {
                               return new Date(b.data || 0) - new Date(a.data || 0);
                             }).slice(0, 5),
          topProdutos      : Object.keys(topProdutos)
                              .map(function (n) { return { nome: n, qtd: topProdutos[n].qtd, receita: topProdutos[n].receita }; })
                              .sort(function (a, b) { return b.receita - a.receita; })
                              .slice(0, 8),
          estoqueBaixo     : estoqueBaixo.slice(0, 8)
        };
      });
  }

  /* ═══════════════════════════════════════════════════════════
     VENDAS POR PERÍODO
  ═══════════════════════════════════════════════════════════ */
  function getVendasPorPeriodo(inicio, fim) {
    if (USE_REMOTE) return _fetch('GET', '/api/relatorios/vendas?inicio=' + inicio + '&fim=' + fim);
    return getPedidos().then(function (pedidos) {
      var dI = new Date(inicio), dF = new Date(fim);
      return pedidos.filter(function (p) {
        if (!p.data) return false;
        var d = new Date(p.data);
        return d >= dI && d <= dF;
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════
     CONFIGURAÇÕES
  ═══════════════════════════════════════════════════════════ */
  function getStoreConfig() {
    if (USE_REMOTE) return _fetch('GET', '/api/config');
    return Promise.resolve(_get(K.config) || {});
  }
  function saveStoreConfig(cfg) {
    if (USE_REMOTE) return _fetch('PUT', '/api/config', cfg);
    _set(K.config, cfg);
    return Promise.resolve(cfg);
  }
  function getLojaConfig() {
    if (USE_REMOTE) return _fetch('GET', '/api/loja/config');
    return Promise.resolve(_get(K.lojaConfig) || {});
  }
  function saveLojaConfig(cfg) {
    if (USE_REMOTE) return _fetch('PUT', '/api/loja/config', cfg);
    _set(K.lojaConfig, cfg);
    return Promise.resolve(cfg);
  }

  /* ═══════════════════════════════════════════════════════════
     AUTENTICAÇÃO
  ═══════════════════════════════════════════════════════════ */
  function login(email, passwordHash) {
    if (USE_REMOTE) {
      return _fetch('POST', '/api/auth/login', { email: email, password: passwordHash })
        .then(function (d) { if (d.token) _set(K.token, d.token); return d; });
    }
    var users = _get(K.users) || [];
    var user  = users.find(function (u) { return u.email === email && u.password === passwordHash; });
    return Promise.resolve(user ? { ok: true, user: user } : { ok: false, error: 'Credenciais inválidas.' });
  }

  function apiLogout() {
    if (USE_REMOTE) return _fetch('POST', '/api/auth/logout').catch(function(){});
    localStorage.removeItem(K.token);
    return Promise.resolve({ ok: true });
  }

  /* ═══════════════════════════════════════════════════════════
     EXPORTAÇÃO PÚBLICA
  ═══════════════════════════════════════════════════════════ */
  return {
    /** Ativa modo remoto — chame antes de qualquer operação */
    conectar: function (baseUrl) { USE_REMOTE = true; if (baseUrl) API_BASE_URL = baseUrl; },
    modoRemoto: function () { return USE_REMOTE; },
    baseUrl: function () { return API_BASE_URL; },

    // Produtos
    getProdutos   : getProdutos,
    saveProduto   : saveProduto,
    deleteProduto : deleteProduto,
    uploadImagem  : uploadImagem,

    // Pedidos
    getPedidos           : getPedidos,
    savePedido           : savePedido,
    updatePedidoStatus   : updatePedidoStatus,
    markPedidoPago       : markPedidoPago,
    deletePedido         : deletePedido,

    // Clientes
    getClients   : getClients,
    saveClient   : saveClient,
    deleteClient : deleteClient,

    // Analytics
    getDashboardStats    : getDashboardStats,
    getVendasPorPeriodo  : getVendasPorPeriodo,
    getPedidosUnificados : getPedidosUnificados,

    // Configurações
    getStoreConfig  : getStoreConfig,
    saveStoreConfig : saveStoreConfig,
    getLojaConfig   : getLojaConfig,
    saveLojaConfig  : saveLojaConfig,

    // Auth
    login      : login,
    apiLogout  : apiLogout
  };

})();
