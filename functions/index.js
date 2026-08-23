'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });
const webpush = require('web-push');

// ---------------------------------------------------------------------------
// IP real do visitante — usado por todo limite/dedupe baseado em IP
// (verificarLimiteIP, registrarVisita, registrarVisualizacaoProduto).
//
// NUNCA usar req.ip diretamente: o Express que o Functions Framework monta
// roda com "trust proxy" ativado (necessário, pois o Google Front End É um
// proxy legítimo) — e isso faz req.ip usar automaticamente o cabeçalho
// X-Forwarded-For, pegando o PRIMEIRO valor da lista. Esse primeiro valor é
// justamente o que o CLIENTE controla: um atacante manda
// "X-Forwarded-For: qualquer-coisa" na requisição e vira req.ip.
//
// Confirmado ao vivo nesta função em produção: forjar esse header zerava o
// bloqueio do limitador de login a cada tentativa — apesar de uma correção
// anterior já ter trocado headers['x-forwarded-for'] por req.ip pensando
// que isso bastava (não basta: o bug estava um nível abaixo, dentro do
// próprio req.ip).
//
// O valor confiável é o ÚLTIMO da lista: o Google Front End SEMPRE anexa o
// IP real do cliente como o último hop ao encaminhar para o Cloud
// Functions — tudo antes dele é o que o cliente (ou um proxy do lado dele)
// inseriu, e não pode ser usado para decidir bloqueio.
// https://cloud.google.com/load-balancing/docs/https#x-forwarded-for_header
function _ipReal(req) {
  var xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) {
    var partes = String(xff).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (partes.length) return partes[partes.length - 1];
  }
  var direto = req.connection && req.connection.remoteAddress;
  return (direto || 'desconhecido').toString().trim();
}

// Busca a chave secreta do Webhook do MP: variável de ambiente primeiro
// (functions/.env), senão o Firestore (lapink/apiConfig.mpWebhookSecret,
// salvo pelo admin em Configurações → Mercado Pago — mesmo padrão do
// Access Token: leitura bloqueada nas rules, só a Function lê via Admin SDK).
function getMpWebhookSecret() {
  if (process.env.MP_WEBHOOK_SECRET) return Promise.resolve(process.env.MP_WEBHOOK_SECRET);
  return db.collection('lapink').doc('apiConfig').get().then(function (snap) {
    var data = snap.exists && snap.data();
    return (data && data.data && data.data.mpWebhookSecret) || null;
  }).catch(function () { return null; });
}

// Valida a assinatura x-signature do webhook do Mercado Pago contra o
// segredo informado. secret nulo/vazio => modo permissivo (aceita, loga
// aviso) até o admin configurar a chave.
function validarAssinaturaMP(req, dataId, secret) {
  if (!secret) {
    functions.logger.warn('mpWebhook: chave do webhook não configurada — assinatura não verificada.');
    return true;
  }
  try {
    var sig = req.headers['x-signature'] || '';
    var reqId = req.headers['x-request-id'] || '';
    var parts = {};
    sig.split(',').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    var ts = parts.ts, v1 = parts.v1;
    if (!ts || !v1) return false;
    // O SDK oficial omite do manifesto qualquer par ausente. Em algumas
    // notificações o payment id vem apenas no corpo, mas a assinatura foi
    // calculada sem `id:` porque não havia `data.id` na URL.
    var manifest = '';
    if (dataId) manifest += 'id:' + String(dataId).toLowerCase() + ';';
    if (reqId) manifest += 'request-id:' + reqId + ';';
    manifest += 'ts:' + ts + ';';
    var hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch (e) {
    functions.logger.error('mpWebhook: erro ao validar assinatura', e);
    return false;
  }
}

admin.initializeApp();
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Helpers: sanitização de texto vindo do cliente (cliente/endereço no
// checkout) antes de gravar no Firestore. createPreference é uma rota
// pública (checkout de visitante), então nome/endereço chegam sem
// autenticação nenhuma — sem isso, esses campos viravam um vetor de XSS
// persistente: o mesmo texto reaparece sem escape em meus-pedidos.html e
// sucesso.html. Remove os caracteres que formam tags HTML (< >) e limita o
// tamanho; não precisa ser um sanitizador de HTML completo, já que o único
// objetivo aqui é impedir a formação de qualquer tag.
function _sanitizarTexto(v, maxLen) {
  return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, maxLen || 200);
}
function _sanitizarCliente(c) {
  c = c || {};
  return {
    nome: _sanitizarTexto(c.nome, 120),
    email: _sanitizarTexto(c.email, 180),
    cpf: String(c.cpf || '').replace(/\D/g, '').slice(0, 11),
    celular: _sanitizarTexto(c.celular || c.whatsapp, 20)
  };
}
function _sanitizarEndereco(e) {
  e = e || {};
  return {
    cep: String(e.cep || '').replace(/\D/g, '').slice(0, 8),
    rua: _sanitizarTexto(e.rua, 150),
    numero: _sanitizarTexto(e.numero, 20),
    complemento: _sanitizarTexto(e.complemento, 100),
    bairro: _sanitizarTexto(e.bairro, 100),
    cidade: _sanitizarTexto(e.cidade, 100),
    estado: _sanitizarTexto(e.estado, 2).toUpperCase(),
    referencia: _sanitizarTexto(e.referencia, 150)
  };
}

// ---------------------------------------------------------------------------
// Helper: busca MP access token (env var ou Firestore)
// ---------------------------------------------------------------------------
async function getMpToken() {
  if (process.env.MP_ACCESS_TOKEN) {
    return process.env.MP_ACCESS_TOKEN;
  }
  const snap = await db.collection('lapink').doc('apiConfig').get();
  if (!snap.exists) throw new Error('apiConfig não encontrado no Firestore');
  const data = snap.data();
  const token = data && data.data && data.data.mpAccessToken;
  if (!token) throw new Error('mpAccessToken ausente no documento apiConfig');
  return token;
}

// ---------------------------------------------------------------------------
// Helper: base URL do site para links de retorno (aceita só domínios da loja)
// ---------------------------------------------------------------------------
const ORIGENS_PERMITIDAS = [
  'https://www.lapinkacessorios.com.br',
  'https://lapinkacessorios.com.br',
  'https://lapink-82a39.web.app',
  'https://lapink-82a39.firebaseapp.com',
];
function baseUrlDe(req, domainConfig) {
  var configurada = domainConfig && domainConfig.dnsUrl;
  if (configurada) {
    try {
      var url = new URL(String(configurada));
      if (url.protocol === 'https:' && !url.username && !url.password) return url.origin;
    } catch (e) {}
  }
  const origem = (req.headers && req.headers.origin) || '';
  return ORIGENS_PERMITIDAS.indexOf(origem) >= 0 ? origem : 'https://www.lapinkacessorios.com.br';
}

// Autentica quando o cliente estiver logado, sem impedir checkout de visitante.
function usuarioOpcional(req) {
  var header = (req.headers && req.headers.authorization) || '';
  var token = header.indexOf('Bearer ') === 0 ? header.slice(7) : '';
  if (!token) return Promise.resolve(null);
  return admin.auth().verifyIdToken(token).catch(function () { return null; });
}

function hashAcessoPedido(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function assinarCotacaoFrete(opcao, cep, segredo) {
  var dados = {
    id: 'me_' + String(opcao.id),
    preco: Math.round(Number(opcao.preco) * 100) / 100,
    cep: String(cep),
    exp: Date.now() + 15 * 60 * 1000
  };
  var payload = Buffer.from(JSON.stringify(dados)).toString('base64url');
  var assinatura = crypto.createHmac('sha256', segredo).update(payload).digest('base64url');
  return payload + '.' + assinatura;
}

function validarCotacaoFrete(token, segredo) {
  try {
    var partes = String(token || '').split('.');
    if (partes.length !== 2) return null;
    var esperada = crypto.createHmac('sha256', segredo).update(partes[0]).digest();
    var informada = Buffer.from(partes[1], 'base64url');
    if (esperada.length !== informada.length || !crypto.timingSafeEqual(esperada, informada)) return null;
    var dados = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
    return dados.exp >= Date.now() ? dados : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Helper: lê o catálogo completo, remontando as partes quando o doc principal
// está particionado ({chunked, chunks} — catálogos com fotos > 1 MiB).
// Retorna { prods, chunkArrays } — chunkArrays = null quando não particionado.
// Os objetos de chunkArrays são os MESMOS de prods (mutar um muta o outro).
// ---------------------------------------------------------------------------
function lerCatalogo() {
  return db.collection('lapink').doc('lapinkProdutos').get().then(function (snap) {
    if (!snap.exists) return { prods: [], chunkArrays: null };
    var d = snap.data() || {};
    if (d.chunked && d.chunks > 0) {
      var reads = [];
      for (var i = 0; i < d.chunks; i++) {
        reads.push(db.collection('lapink').doc('lapinkProdutos_' + i).get());
      }
      return Promise.all(reads).then(function (snaps) {
        var chunkArrays = snaps.map(function (s) {
          var x = s.exists ? s.data() : null;
          return x && Array.isArray(x.data) ? x.data : [];
        });
        return { prods: [].concat.apply([], chunkArrays), chunkArrays: chunkArrays };
      });
    }
    return { prods: Array.isArray(d.data) ? d.data : [], chunkArrays: null };
  });
}

// ---------------------------------------------------------------------------
// Helper: gera orderId único
// ---------------------------------------------------------------------------
function gerarOrderId() {
  return (
    'LPK-' +
    Date.now().toString(36).toUpperCase() +
    '-' +
    Math.random().toString(36).slice(2, 4).toUpperCase()
  );
}

// ---------------------------------------------------------------------------
// Helper: mapeia status do MP para status interno
// ---------------------------------------------------------------------------
function mapearStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved':
      return 'pago';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'aguardando_confirmacao';
    case 'rejected':
    case 'cancelled':
    case 'refunded':
    case 'charged_back':
      return 'cancelado';
    default:
      return 'aguardando_pagamento';
  }
}

// ---------------------------------------------------------------------------
// 1. createPreference — cria preferência de pagamento no Mercado Pago
// ---------------------------------------------------------------------------
exports.createPreference = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }

    const body = req.body || {};
    const { itens, subtotal, frete, total } = body;
    // Sanitizados aqui: rota pública (checkout de visitante, sem
    // autenticação), então nome/endereço/modalidade chegam como texto livre
    // do cliente e não podem ir pro Firestore (nem pro payer do MP) sem
    // passar por isso — ver _sanitizarCliente/_sanitizarEndereco.
    const cliente = _sanitizarCliente(body.cliente);
    const endereco = _sanitizarEndereco(body.endereco);
    const modalidadeFrete = _sanitizarTexto(body.modalidadeFrete, 60);

    if (!itens || !Array.isArray(itens) || itens.length === 0 || itens.length > 50) {
      res.status(400).json({ error: 'Campo "itens" é obrigatório e deve ser um array não vazio.' });
      return;
    }

    const orderId = gerarOrderId();
    const acessoPedido = crypto.randomBytes(32).toString('hex');
    // Valores recalculados no servidor (não confiar no payload do cliente)
    var _itensCalc = [], _subtotalCalc = 0, _freteCalc = 0, _totalCalc = 0, _pesoCalc = 0;
    var _descontoInfo = { pct: 0, valor: 0 };
    var _ownerUid = null;
    var _descontoReservado = false;
    var _usouBoasVindas = false;
    var _cupomInfo = null;
    var _domainConfig = {};

    Promise.all([
      getMpToken(),
      lerCatalogo(), // suporta catálogo particionado (fotos > 1 MiB)
      db.collection('lapink').doc('lapinkLojaConfig').get(), // desconto boas-vindas
      usuarioOpcional(req),
      db.collection('lapink').doc('lapinkEntregaConfig').get(),
      db.collection('lapink').doc('lapinkDomainConfig').get(),
      lerDescontos(),
      lerCupons()
    ])
      .then(function (arr) {
        var token = arr[0];
        var prods = arr[1].prods;
        var lojaCfg = (arr[2].exists && arr[2].data() && arr[2].data().data) || {};
        var usuario = arr[3];
        var entregaCfg = (arr[4].exists && arr[4].data() && arr[4].data().data) || {};
        _domainConfig = (arr[5].exists && arr[5].data() && arr[5].data().data) || {};
        var descontosProduto = arr[6];
        var cupons = arr[7];
        _ownerUid = usuario ? usuario.uid : null;
        var mapa = {};
        (Array.isArray(prods) ? prods : []).forEach(function (p) { if (p && typeof p.id !== 'undefined') mapa[String(p.id)] = p; });

        function precoDe(p) { var a = Number(p.precoAtacado) || 0, v = Number(p.precoVarejo) || 0; return a > 0 ? a : v; }

        // Desconto de boas-vindas: valida contra a config da loja (nunca
        // confia no % vindo do cliente — usa o MENOR entre pedido e config)
        var descCfg = lojaCfg.descontoBoasVindas || {};
        var descontoPct = 0;
        if (descCfg.ativo && Number(descCfg.percentual) > 0 && Number(body.descontoPct) > 0) {
          if (!usuario) throw new Error('Entre na sua conta para usar o desconto de boas-vindas.');
          descontoPct = Math.min(Number(body.descontoPct), Number(descCfg.percentual), 90);
        }
        var subtotalCatalogo = itens.reduce(function (s, item) {
          var produto = mapa[String(item.id)], qtd = Number(item.qty);
          return s + (produto && Number.isInteger(qtd) && qtd > 0 ? precoDe(produto) * qtd : 0);
        }, 0);
        var cupom = cupomValido(body.cupom, cupons, subtotalCatalogo, Date.now());
        if (String(body.cupom || '').trim() && !cupom) throw new Error('Cupom inválido, inativo, fora do período ou abaixo do valor mínimo.');
        _cupomInfo = cupom;
        var cupomPct = cupom ? cupom.percentual : 0;
        // Recalcula preços e valida estoque a partir do catálogo no servidor
        const mpItems = [];
        var agoraDesconto = Date.now();
        itens.forEach(function (item) {
          var p = mapa[String(item.id)];
          if (!p) throw new Error('Produto inválido no carrinho: ' + (item.nome || item.id));
          var estoque = (typeof p.estoque !== 'undefined') ? (parseInt(p.estoque) || 0) : null;
          var qtyOriginal = Number(item.qty);
          if (!Number.isInteger(qtyOriginal) || qtyOriginal < 1 || qtyOriginal > 100) {
            throw new Error('Quantidade inválida no carrinho.');
          }
          var qty = qtyOriginal;
          if (estoque !== null) {
            if (estoque <= 0) throw new Error('Produto esgotado: ' + (p.nome || item.id));
            if (qty > estoque) qty = estoque; // limita ao estoque disponível
          }
          var preco = precoDe(p);
          var promocao = descontoProdutoValido(p.id, descontosProduto, agoraDesconto);
          var usarPromocao = !!(promocao && promocao.percentual >= Math.max(descontoPct, cupomPct));
          var pctItem = usarPromocao ? promocao.percentual : Math.max(descontoPct, cupomPct);
          var usarCupom = !usarPromocao && cupomPct >= descontoPct && cupomPct > 0;
          if (!usarPromocao && !usarCupom && pctItem > 0) _usouBoasVindas = true;
          var precoCobrado = Math.max(0, Math.round(preco * (1 - pctItem / 100) * 100) / 100);
          var descontoUnitario = Math.round((preco - precoCobrado) * 100) / 100;
          _subtotalCalc += preco * qty;
          _pesoCalc += (Number(p.pesoEnvioGramas || p.pesoEnvioG) || 0) * qty;
          _itensCalc.push({
            id: p.id, nome: p.nome, qty: qty, preco: precoCobrado,
            precoOriginal: preco, descontoPct: pctItem,
            descontoValor: descontoUnitario,
            precoUnitarioFinal: precoCobrado,
            subtotalFinal: Math.round(precoCobrado * qty * 100) / 100,
            promocaoId: usarPromocao ? promocao.id : (usarCupom ? cupom.id : null),
            promocaoNome: usarPromocao ? promocao.nome : (usarCupom ? cupom.nome : (pctItem > 0 ? 'Boas-vindas' : null)),
            tipoDesconto: pctItem > 0 ? (usarPromocao ? 'produto' : (usarCupom ? 'cupom' : 'boas_vindas')) : null
          });
          mpItems.push({ id: String(p.id), title: String(p.nome || 'Produto'), quantity: qty, unit_price: precoCobrado, currency_id: 'BRL' });
        });

        _subtotalCalc = Math.round(_subtotalCalc * 100) / 100;
        var _descontoCalc = Math.round(mpItems.reduce(function (s, it) {
          return s + it.unit_price * it.quantity;
        }, 0) * 100) / 100;
        _descontoCalc = Math.round((_subtotalCalc - _descontoCalc) * 100) / 100; // valor do desconto

        // Frete sempre recalculado ou validado por assinatura do servidor.
        _pesoCalc += Number(entregaCfg.embalagem && entregaCfg.embalagem.pesoG) || 75;
        var gratis = !!(entregaCfg.gratis && entregaCfg.gratis.ativo
          && (_subtotalCalc - _descontoCalc) >= Number(entregaCfg.gratis.minimo || 0));
        function tabelaPreco(tipo) {
          var cfg = entregaCfg[tipo] || {};
          if (!cfg.ativo || !Array.isArray(cfg.tabela)) return null;
          var faixa = cfg.tabela.slice().sort(function (a, b) { return Number(a.ateG) - Number(b.ateG); })
            .find(function (r) { return _pesoCalc <= Number(r.ateG); });
          return faixa ? Number(faixa.preco) : null;
        }
        if (modalidadeFrete === 'retirada' && entregaCfg.retirada && entregaCfg.retirada.ativo) {
          _freteCalc = 0;
        } else if (modalidadeFrete === 'local' && entregaCfg.local && entregaCfg.local.ativo) {
          _freteCalc = gratis ? 0 : Number(entregaCfg.local.taxa || 0);
        } else if (modalidadeFrete === 'pac' || modalidadeFrete === 'sedex') {
          var tabela = tabelaPreco(modalidadeFrete);
          if (tabela === null || !Number.isFinite(tabela)) throw new Error('Modalidade de frete indisponível.');
          _freteCalc = gratis ? 0 : tabela;
        } else if (modalidadeFrete.indexOf('me_') === 0) {
          var cotacao = validarCotacaoFrete(body.freteToken, token);
          if (!cotacao || cotacao.id !== modalidadeFrete || cotacao.cep !== endereco.cep) {
            throw new Error('Cotação de frete inválida ou expirada. Calcule o frete novamente.');
          }
          _freteCalc = gratis ? 0 : Number(cotacao.preco);
        } else {
          throw new Error('Modalidade de frete inválida.');
        }
        if (!Number.isFinite(_freteCalc) || _freteCalc < 0 || _freteCalc > 10000) throw new Error('Valor de frete inválido.');
        _totalCalc = Math.round((_subtotalCalc - _descontoCalc + _freteCalc) * 100) / 100;
        if (_freteCalc > 0) {
          mpItems.push({ id: 'FRETE', title: 'Frete', quantity: 1, unit_price: _freteCalc, currency_id: 'BRL' });
        }
        _descontoInfo = {
          pct: _itensCalc.reduce(function (m, it) { return Math.max(m, Number(it.descontoPct) || 0); }, 0),
          valor: _descontoCalc
        };

        // Monta payer
        const clienteNome = (cliente && cliente.nome) || 'Comprador';
        const clienteEmail = (cliente && cliente.email) || 'comprador@lapink.com.br';
        const clienteCpf = (cliente && cliente.cpf) ? cliente.cpf.replace(/\D/g, '') : '';

        const payer = {
          name: clienteNome,
          email: clienteEmail,
        };
        if (clienteCpf) {
          payer.identification = { type: 'CPF', number: clienteCpf };
        }

        const preference = {
          items: mpItems,
          payer: payer,
          back_urls: {
            success: baseUrlDe(req, _domainConfig) + '/public/sucesso.html?pedido=' + orderId + '&acesso=' + acessoPedido,
            failure: baseUrlDe(req, _domainConfig) + '/public/pagamento.html?erro=pagamento',
            pending: baseUrlDe(req, _domainConfig) + '/public/sucesso.html?pedido=' + orderId + '&acesso=' + acessoPedido + '&pendente=1',
          },
          auto_return: 'approved',
          notification_url: 'https://us-central1-lapink-82a39.cloudfunctions.net/mpWebhook',
          external_reference: orderId,
          statement_descriptor: 'LAPINK',
          expires: true,
          expiration_date_from: new Date().toISOString(),
          expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        };

        var reservarDesconto = Promise.resolve();
        if (_ownerUid && _usouBoasVindas) {
          var usoRef = db.collection('descontoBoasVindasUsos').doc(_ownerUid);
          reservarDesconto = db.runTransaction(function (tx) {
            return tx.get(usoRef).then(function (uso) {
              var atual = uso.exists ? (uso.data() || {}) : {};
              var expirou = atual.status === 'reservado' && Number(atual.expiresAt || 0) <= Date.now();
              if (uso.exists && !expirou) throw new Error('O desconto de boas-vindas já foi utilizado ou está reservado em outro pagamento.');
              tx.set(usoRef, {
                pedidoId: orderId,
                status: 'reservado',
                expiresAt: Date.now() + 30 * 60 * 1000,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
            });
          }).then(function () { _descontoReservado = true; });
        }
        return reservarDesconto.then(function () {
          if (_totalCalc === 0) {
            var urlGratis = baseUrlDe(req, _domainConfig) + '/public/sucesso.html?pedido=' + orderId + '&acesso=' + acessoPedido;
            return { ok: true, json: function () { return Promise.resolve({ id: 'GRATIS-' + orderId, init_point: urlGratis, sandbox_init_point: urlGratis, gratuito: true }); } };
          }
          return fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify(preference),
          });
        });
      })
      .then(function (mpRes) {
        return mpRes.json().then(function (mpData) {
          if (!mpRes.ok) {
            functions.logger.error('Erro MP createPreference', mpData);
            throw new Error('Erro ao criar preferência no Mercado Pago: ' + JSON.stringify(mpData));
          }
          return mpData;
        });
      })
      .then(function (mpData) {
        // Salva pedido rascunho no Firestore
        const pedido = {
          numero: orderId,
          status: mpData.gratuito ? 'pago' : 'aguardando_pagamento',
          mp_preference_id: mpData.id || null,
          mp_payment_id: null,
          mp_status: null,
          cliente: cliente || {},
          endereco: endereco || {},
          itens: _itensCalc,            // itens validados no servidor
          subtotal: _subtotalCalc,      // recalculado no servidor
          desconto: _descontoInfo.valor,
          descontoPct: _descontoInfo.pct,
          cupom: _cupomInfo ? _cupomInfo.codigo : null,
          usouDescontoBoasVindas: _usouBoasVindas,
          frete: _freteCalc,
          total: _totalCalc,            // recalculado no servidor
          modalidadeFrete: modalidadeFrete || '',
          pagamento: mpData.gratuito ? 'gratuito' : 'mercadopago',
          rastreio: null,
          ownerUid: _ownerUid,
          acessoHash: hashAcessoPedido(acessoPedido),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        return db
          .collection('pedidos')
          .doc(orderId)
          .set(pedido)
          .then(function () {
            if (!mpData.gratuito) return mpData;
            return processarPagamentoAtomico({ external_reference:orderId, transaction_amount:0, currency_id:'BRL', status:'approved' }, 'GRATIS-' + orderId)
              .then(function () { return mpData; });
          });
      })
      .then(function (mpData) {
        functions.logger.info('Pedido criado com sucesso', { orderId, mp_id: mpData.id });
        res.status(200).json({
          preference_id: mpData.id,
          init_point: mpData.init_point,
          sandbox_init_point: mpData.sandbox_init_point,
          pedido_id: orderId,
          acesso_pedido: acessoPedido,
          gratuito: !!mpData.gratuito,
          usou_desconto_boas_vindas: _usouBoasVindas,
        });
      })
      .catch(function (err) {
        functions.logger.error('createPreference erro', err);
        var liberar = Promise.resolve();
        if (_descontoReservado && _ownerUid) {
          var reservaRef = db.collection('descontoBoasVindasUsos').doc(_ownerUid);
          liberar = db.runTransaction(function (tx) {
            return tx.get(reservaRef).then(function (snap) {
              var d = snap.exists ? (snap.data() || {}) : {};
              if (d.status === 'reservado' && d.pedidoId === orderId) tx.delete(reservaRef);
            });
          }).catch(function (e) {
            functions.logger.error('Falha ao liberar reserva de desconto', e);
          });
        }
        liberar.then(function () {
          res.status(500).json({ error: err.message || 'Erro interno ao processar preferência.' });
        });
      });
  });
});

// Consulta individual para o retorno do pagamento. O token aleatório substitui
// a antiga leitura pública do documento inteiro no Firestore.
exports.obterPedido = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var pedidoId = String((req.body && req.body.pedidoId) || '');
    var acesso = String((req.body && req.body.acesso) || '');
    if (!/^LPK-[A-Z0-9-]{4,40}$/.test(pedidoId) || !/^[a-f0-9]{64}$/.test(acesso)) {
      res.status(400).json({ error: 'Identificador de pedido inválido.' });
      return;
    }
    db.collection('pedidos').doc(pedidoId).get().then(function (snap) {
      if (!snap.exists) { res.status(404).json({ error: 'Pedido não encontrado.' }); return; }
      var pedido = snap.data() || {};
      var informado = Buffer.from(hashAcessoPedido(acesso), 'hex');
      var esperado = Buffer.from(String(pedido.acessoHash || ''), 'hex');
      if (informado.length !== esperado.length || !crypto.timingSafeEqual(informado, esperado)) {
        res.status(403).json({ error: 'Acesso ao pedido negado.' }); return;
      }
      delete pedido.acessoHash;
      res.status(200).json({ pedido: pedido });
    }).catch(function (err) {
      functions.logger.error('obterPedido erro', err);
      res.status(500).json({ error: 'Erro ao consultar pedido.' });
    });
  });
});

// Lista pedidos da conta autenticada e recupera pedidos antigos/órfãos pelo
// e-mail presente no token do Firebase Auth. O e-mail nunca vem do corpo.
exports.listarMeusPedidos = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var authHeader = req.headers.authorization || '';
    var idToken = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
    if (!idToken) { res.status(401).json({ error: 'Autenticação necessária.' }); return; }

    var usuario;
    admin.auth().verifyIdToken(idToken)
      .then(function (decoded) {
        usuario = decoded;
        var email = String(decoded.email || '').trim().toLowerCase();
        if (!email) { var e = new Error('Conta sem e-mail.'); e._status = 400; throw e; }
        var consultas = [db.collection('pedidos').where('ownerUid', '==', decoded.uid).limit(50).get()];
        // A busca legada por e-mail pode vincular pedidos sem ownerUid. Ela
        // só é segura depois que o Firebase comprovou a posse do e-mail.
        if (decoded.email_verified === true) {
          consultas.push(db.collection('pedidos').where('cliente.email', '==', email).limit(50).get());
        }
        return Promise.all(consultas);
      })
      .then(function (snaps) {
        var porId = {};
        var vincular = [];
        snaps.forEach(function (qs) {
          qs.forEach(function (doc) {
            var d = doc.data() || {};
            porId[doc.id] = d;
            if (!d.ownerUid) vincular.push(doc.ref.update({
              ownerUid: usuario.uid,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }));
          });
        });
        var ids = Object.keys(porId);
        var pendentes = ids.filter(function (id) {
          return ['pago', 'cancelado', 'concluido'].indexOf(String(porId[id].status || '')) === -1;
        }).slice(0, 10);
        return Promise.all(vincular)
          .then(function () {
            return Promise.all(pendentes.map(function (id) {
              return reconciliarPedidoPendente(id).catch(function (e) {
                functions.logger.warn('Reconciliação automática falhou para ' + id + ': ' + e.message);
              });
            }));
          })
          .then(function () {
            return Promise.all(ids.map(function (id) { return db.collection('pedidos').doc(id).get(); }));
          })
          .then(function (docsAtualizados) {
          var pedidos = docsAtualizados.filter(function (s) {
            return s.exists && snapNaoArquivado(s);
          }).map(function (snap) {
            var d = snap.data() || {};
            d.ownerUid = usuario.uid;
            delete d.acessoHash;
            ['createdAt', 'updatedAt'].forEach(function (campo) {
              if (d[campo] && typeof d[campo].toMillis === 'function') {
                d[campo] = { seconds: Math.floor(d[campo].toMillis() / 1000) };
              }
            });
            return d;
          }).sort(function (a, b) {
            function ms(x) { return x && typeof x.toMillis === 'function' ? x.toMillis() : Number(x && x.seconds || 0) * 1000; }
            return ms(b.createdAt) - ms(a.createdAt);
          }).slice(0, 20);
          res.status(200).json({ pedidos: pedidos });
        });
      })
      .catch(function (err) {
        var status = (err && err._status) || ((err && String(err.code || '').indexOf('auth/') === 0) ? 401 : 500);
        if (status >= 500) functions.logger.error('listarMeusPedidos erro', err);
        if (!res.headersSent) res.status(status).json({ error: status === 500 ? 'Erro ao consultar pedidos.' : err.message });
      });
  });
});

function snapNaoArquivado(snap) {
  return !(snap.data() || {}).arquivado;
}

// Confere um pedido pendente diretamente na API do Mercado Pago. É usado
// como recuperação quando uma entrega do webhook falha; processarPagamento-
// Atomico continua validando valor/moeda e garante idempotência do estoque.
function reconciliarPedidoPendente(orderId) {
  return getMpToken().then(function (token) {
    var url = 'https://api.mercadopago.com/v1/payments/search?external_reference=' + encodeURIComponent(orderId)
      + '&sort=date_created&criteria=desc&limit=5';
    return fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  }).then(function (mpRes) {
    return mpRes.json().then(function (data) {
      if (!mpRes.ok) throw new Error('Mercado Pago respondeu ' + mpRes.status);
      var resultados = Array.isArray(data.results) ? data.results : [];
      var pagamento = resultados.find(function (p) {
        return String(p.external_reference || '') === String(orderId)
          && ['approved', 'refunded', 'charged_back'].indexOf(p.status) !== -1;
      });
      if (!pagamento) return null;
      return processarPagamentoAtomico(pagamento, pagamento.id);
    });
  });
}

function lerDescontos() {
  return db.collection('lapink').doc('lapinkDescontos').get().then(function (snap) {
    var d = snap.exists ? (snap.data() || {}) : {};
    return Array.isArray(d.data) ? d.data : [];
  });
}

function lerCupons() {
  return db.collection('lapink').doc('lapinkCupons').get().then(function (snap) {
    var d = snap.exists ? (snap.data() || {}) : {};
    return Array.isArray(d.data) ? d.data : [];
  });
}

function cupomValido(codigo, cupons, subtotal, agora) {
  var normalizado = String(codigo || '').trim().toUpperCase();
  if (!normalizado || !/^[A-Z0-9_-]{3,30}$/.test(normalizado)) return null;
  var cupom = (Array.isArray(cupons) ? cupons : []).find(function (c) {
    return c && String(c.codigo || '').toUpperCase() === normalizado;
  });
  if (!cupom || cupom.ativo !== true) return null;
  var pct = Number(cupom.percentual);
  var minimo = Math.max(0, Number(cupom.valorMinimo) || 0);
  var inicio = new Date(String(cupom.inicio) + 'T00:00:00').getTime();
  var fim = new Date(String(cupom.fim) + 'T23:59:59.999').getTime();
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100 || subtotal < minimo || agora < inicio || agora > fim) return null;
  return { id: String(cupom.id), codigo: normalizado, nome: _sanitizarTexto(cupom.nome || normalizado, 80), percentual: pct };
}

// Retorna apenas a maior promoção válida para o produto. Percentuais nunca
// são somados e datas são verificadas novamente no servidor.
function descontoProdutoValido(produtoId, descontos, agora) {
  var melhor = null;
  (Array.isArray(descontos) ? descontos : []).forEach(function (d) {
    var pct = Number(d && d.percentual);
    var ids = d && Array.isArray(d.produtoIds) ? d.produtoIds.map(String) : [];
    if (!d || d.ativo !== true || !Number.isFinite(pct) || pct <= 0 || pct > 100 || ids.indexOf(String(produtoId)) < 0) return;
    var inicio = d.inicio ? new Date(String(d.inicio) + (/^\d{4}-\d{2}-\d{2}$/.test(String(d.inicio)) ? 'T00:00:00' : '')).getTime() : null;
    var fim = d.fim ? new Date(String(d.fim) + (/^\d{4}-\d{2}-\d{2}$/.test(String(d.fim)) ? 'T23:59:59.999' : '')).getTime() : null;
    if ((Number.isFinite(inicio) && agora < inicio) || (Number.isFinite(fim) && agora > fim)) return;
    if (!melhor || pct > melhor.percentual) melhor = { id: String(d.id), nome: _sanitizarTexto(d.nome || 'Promoção', 80), percentual: pct };
  });
  return melhor;
}

// ---------------------------------------------------------------------------
// 2. mpWebhook — recebe notificações do Mercado Pago
// ---------------------------------------------------------------------------
exports.mpWebhook = functions.https.onRequest(function (req, res) {
  var paymentId = null;

  var bodyType = req.body && req.body.type;
  var bodyDataId = req.body && req.body.data && req.body.data.id;
  var queryTopic = req.query && req.query.topic;
  var queryId = req.query && req.query.id;

  if (bodyType === 'payment' && bodyDataId) {
    paymentId = String(bodyDataId);
  } else if (queryTopic === 'payment' && queryId) {
    paymentId = String(queryId);
  } else {
    functions.logger.info('mpWebhook: notificação ignorada (não é payment)', {
      type: bodyType,
      topic: queryTopic,
    });
    res.status(200).send('IGNORED');
    return;
  }

  // Valida a assinatura do Mercado Pago (se a chave estiver configurada —
  // env var ou Firestore, ver getMpWebhookSecret)
  // Usa exatamente o data.id da URL. O id do corpo serve para consultar o
  // pagamento, mas não entra no manifesto se não veio na query.
  var dataIdAssinatura = (req.query && req.query['data.id']) || '';

  getMpWebhookSecret()
    .then(function (secret) {
      if (!validarAssinaturaMP(req, dataIdAssinatura, secret)) {
        functions.logger.warn('mpWebhook: assinatura inválida — notificação descartada.', { paymentId });
        var eAssinatura = new Error('Assinatura inválida.');
        eAssinatura._status = 403;
        throw eAssinatura;
      }

      functions.logger.info('mpWebhook: processando payment_id=' + paymentId);
      return getMpToken();
    })
    .then(function (token) {
      return fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
        },
      });
    })
    .then(function (mpRes) {
      return mpRes.json().then(function (data) {
        if (!mpRes.ok) {
          throw new Error('Erro ao buscar pagamento MP: ' + JSON.stringify(data));
        }
        return data;
      });
    })
    .then(function (payment) {
      return processarPagamentoAtomico(payment, paymentId);
    })
    .then(function (resultado) {
      if (resultado && resultado.notificar) {
        _notificarVendaAdmins(resultado.pedido, resultado.orderId).catch(function (e) {
          functions.logger.warn('notificação de venda falhou (pedido processado normalmente): ' + (e && e.message));
        });
      }
      if (!res.headersSent) res.status(200).send('OK');
    })
    .catch(function (err) {
      functions.logger.error('mpWebhook erro ao processar payment_id=' + paymentId, err);
      if (!res.headersSent) res.status((err && err._status) || 500).send('ERROR');
    });
});

// Atualiza pedido e estoque na MESMA transação. Isso torna o webhook
// idempotente mesmo quando o Mercado Pago envia a mesma notificação em
// paralelo, e impede que duas vendas sobrescrevam a baixa de estoque uma da outra.
function processarPagamentoAtomico(payment, paymentId) {
  var externalRef = String(payment.external_reference || '');
  if (!/^LPK-[A-Z0-9-]{4,40}$/.test(externalRef)) {
    var eRef = new Error('Pagamento sem referência de pedido válida.');
    eRef._status = 400;
    return Promise.reject(eRef);
  }
  var orderRef = db.collection('pedidos').doc(externalRef);
  var resultado = { orderId: externalRef, notificar: false, pedido: null };

  return db.runTransaction(function (tx) {
    return tx.get(orderRef).then(function (orderSnap) {
      if (!orderSnap.exists) {
        var ePedido = new Error('Pedido do pagamento não encontrado.');
        ePedido._status = 404;
        throw ePedido;
      }
      var pedido = orderSnap.data() || {};
      var recebido = Math.round(Number(payment.transaction_amount) * 100);
      var esperado = Math.round(Number(pedido.total) * 100);
      if (!Number.isFinite(recebido) || recebido !== esperado || String(payment.currency_id || '') !== 'BRL') {
        var eValor = new Error('Valor ou moeda do pagamento não corresponde ao pedido.');
        eValor._status = 409;
        throw eValor;
      }

      var novoStatus = mapearStatus(payment.status);
      var primeiraBaixa = novoStatus === 'pago' && pedido.estoqueProcessado !== true;
      var restaurarEstoque = (payment.status === 'refunded' || payment.status === 'charged_back')
        && pedido.estoqueBaixado === true && pedido.estoqueEstornado !== true;
      var updatePedido = {
        status: novoStatus,
        mp_payment_id: String(paymentId),
        mp_status: payment.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      resultado.pedido = pedido;

      if (!primeiraBaixa && !restaurarEstoque) {
        tx.update(orderRef, updatePedido);
        return;
      }

      var catalogRef = db.collection('lapink').doc('lapinkProdutos');
      return tx.get(catalogRef).then(function (catalogSnap) {
        if (!catalogSnap.exists) throw new Error('Catálogo não encontrado para baixa de estoque.');
        var catalog = catalogSnap.data() || {};
        var refs = [];
        if (catalog.chunked && Number(catalog.chunks) > 0) {
          for (var i = 0; i < Number(catalog.chunks); i++) refs.push(db.collection('lapink').doc('lapinkProdutos_' + i));
        }
        return Promise.all(refs.map(function (ref) { return tx.get(ref); })).then(function (chunkSnaps) {
          var partes = refs.length
            ? chunkSnaps.map(function (s) { var d = s.exists ? s.data() : {}; return Array.isArray(d.data) ? d.data : []; })
            : [Array.isArray(catalog.data) ? catalog.data : []];
          var faltas = [];
          (pedido.itens || []).forEach(function (item) {
            var prod = null;
            for (var p = 0; p < partes.length && !prod; p++) {
              prod = partes[p].find(function (x) { return String(x.id) === String(item.id); });
            }
            var qtd = Math.max(1, Number(item.qty) || 1);
            if (restaurarEstoque && prod) {
              prod.estoque = Number(prod.estoque || 0) + qtd;
            } else if (!prod || Number(prod.estoque || 0) < qtd) {
              faltas.push(String(item.nome || item.id));
            } else {
              prod.estoque = Number(prod.estoque) - qtd;
            }
          });
          var agora = Date.now();
          if (refs.length) {
            refs.forEach(function (ref, idx) { tx.set(ref, { data: partes[idx], updatedAt: agora }); });
            tx.set(catalogRef, { chunked: true, chunks: refs.length, updatedAt: agora }, { merge: true });
          } else {
            tx.set(catalogRef, { data: partes[0], updatedAt: agora }, { merge: true });
          }
          if (restaurarEstoque) {
            updatePedido.estoqueEstornado = true;
          } else {
            updatePedido.estoqueProcessado = true;
            updatePedido.estoqueBaixado = faltas.length === 0;
          }
          if (!restaurarEstoque && faltas.length) {
            updatePedido.revisaoEstoque = true;
            updatePedido.estoquePendente = faltas;
          }
          tx.update(orderRef, updatePedido);
          resultado.notificar = primeiraBaixa;

          if (pedido.ownerUid && pedido.usouDescontoBoasVindas === true) {
            tx.set(db.collection('descontoBoasVindasUsos').doc(pedido.ownerUid), {
              pedidoId: externalRef,
              status: 'usado',
              usedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
        });
      });
    });
  }).then(function () { return resultado; });
}

// ---------------------------------------------------------------------------
// Helper: decrementa estoque dos produtos no Firestore
// ---------------------------------------------------------------------------
function decrementarEstoque(itensPedido) {
  return lerCatalogo().then(function (cat) {
    var prods = cat.prods;
    if (!prods.length) {
      functions.logger.warn('decrementarEstoque: catálogo vazio/não encontrado');
      return;
    }

    // Decrementa nos objetos (compartilhados com chunkArrays quando particionado)
    // e registra em quais partes houve mudança.
    var partesModificadas = {};
    itensPedido.forEach(function (itemPedido) {
      var prod = null, chunkIdx = -1;
      if (cat.chunkArrays) {
        for (var c = 0; c < cat.chunkArrays.length && !prod; c++) {
          var achado = cat.chunkArrays[c].find(function (p) { return String(p.id) === String(itemPedido.id); });
          if (achado) { prod = achado; chunkIdx = c; }
        }
      } else {
        prod = prods.find(function (p) { return String(p.id) === String(itemPedido.id); });
      }
      if (prod && typeof prod.estoque !== 'undefined') {
        prod.estoque = Math.max(0, (parseInt(prod.estoque) || 0) - (Number(itemPedido.qty) || 1));
        if (chunkIdx >= 0) partesModificadas[chunkIdx] = true;
      }
    });

    var agora = Date.now();

    if (!cat.chunkArrays) {
      // Catálogo em documento único (formato original)
      return db.collection('lapink').doc('lapinkProdutos')
        .set({ data: prods, updatedAt: agora }, { merge: true })
        .then(function () {
          functions.logger.info('decrementarEstoque: estoque atualizado (' + itensPedido.length + ' item(s))');
        });
    }

    // Catálogo particionado: regrava só as partes alteradas + índice (updatedAt
    // novo faz os clientes re-baixarem o catálogo na próxima sincronização)
    var escritas = Object.keys(partesModificadas).map(function (idx) {
      return db.collection('lapink').doc('lapinkProdutos_' + idx)
        .set({ data: cat.chunkArrays[idx], updatedAt: agora });
    });
    return Promise.all(escritas).then(function () {
      return db.collection('lapink').doc('lapinkProdutos')
        .set({ chunked: true, chunks: cat.chunkArrays.length, updatedAt: agora });
    }).then(function () {
      functions.logger.info('decrementarEstoque: estoque atualizado em ' + escritas.length + ' parte(s)');
    });
  });
}

// Verifica um Bearer token de admin/superadmin (mesmo critério usado em
// sincronizarClaimsAdmin, definida mais abaixo — SUPERADMINS_FIXOS já está
// atribuída quando isto roda, o módulo inteiro carrega antes de qualquer
// requisição chegar). Usada pra travar functions que só o painel deve poder
// chamar — sem isso, bastava saber a URL pra disparar a function por fora.
function _exigirAdmin(req) {
  var authHeader = req.headers.authorization || '';
  var idToken = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  if (!idToken) {
    return Promise.reject({ _status: 401, message: 'Token de autenticação ausente.' });
  }
  return admin.auth().verifyIdToken(idToken).then(function (decoded) {
    var email = String(decoded.email || '').toLowerCase();
    if (SUPERADMINS_FIXOS.indexOf(email) !== -1) return Object.assign({}, decoded, { role: 'superadmin', pages: null });
    return db.collection('lapink').doc('lapinkUsers').get().then(function (snap) {
      var lista = (snap.exists && snap.data() && snap.data().data) || [];
      var match = (Array.isArray(lista) ? lista : []).find(function (u) {
        return u && String(u.email || '').toLowerCase() === email;
      });
      if (match && (match.role === 'admin' || match.role === 'superadmin')) {
        return Object.assign({}, decoded, { role: match.role, pages: Array.isArray(match.pages) ? match.pages : null });
      }
      var eForbidden = new Error('Acesso restrito a administradores.');
      eForbidden._status = 403;
      throw eForbidden;
    });
  }).catch(function (err) {
    if (err && err._status) throw err;
    var eAuth = new Error('Token inválido ou expirado.');
    eAuth._status = 401;
    throw eAuth;
  });
}

function _exigirPermissao(req, pagina) {
  return _exigirAdmin(req).then(function(decoded) {
    if (decoded.role === 'superadmin' || !Array.isArray(decoded.pages) || decoded.pages.indexOf(pagina) !== -1) return decoded;
    var erro = new Error('Sua conta não possui permissão para a aba ' + pagina + '.');
    erro._status = 403;
    throw erro;
  });
}

function _exigirSuperAdmin(req) {
  return _exigirAdmin(req).then(function (decoded) {
    var email = String(decoded.email || '').toLowerCase();
    if (SUPERADMINS_FIXOS.indexOf(email) !== -1 || decoded.role === 'superadmin') return decoded;
    var erro = new Error('Acesso restrito ao Super Admin.');
    erro._status = 403;
    throw erro;
  });
}

function _normalizarEmailAdmin(valor) {
  var email = String(valor || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    var erro = new Error('E-mail inválido.'); erro._status = 400; throw erro;
  }
  return email;
}

function _salvarRegistroAdmin(email, dados) {
  var ref = db.collection('lapink').doc('lapinkUsers');
  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var lista = (snap.exists && snap.data() && snap.data().data) || [];
      if (!Array.isArray(lista)) lista = [];
      var indice = lista.findIndex(function (u) { return u && String(u.email || '').toLowerCase() === email; });
      var atual = indice >= 0 ? lista[indice] : { email: email, createdAt: new Date().toISOString() };
      var novo = Object.assign({}, atual, dados, { email: email });
      delete novo.password;
      if (indice >= 0) lista[indice] = novo; else lista.push(novo);
      tx.set(ref, { data: lista, updatedAt: Date.now() }, { merge: true });
      return novo;
    });
  });
}

// Fonte central de verdade para usuários e permissões do painel. O navegador
// nunca grava roles diretamente: Admin SDK atualiza Auth, custom claims e o
// registro usado por _exigirAdmin em uma única operação protegida.
exports.gerenciarUsuarioAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido. Use POST.' }); return; }
    var body = req.body || {};
    var acao = String(body.acao || '').trim();
    var operador;
    var email;
    var resposta = { ok: true };
    _exigirSuperAdmin(req).then(function (decoded) {
      operador = decoded;
      if (acao === 'listar') {
        return db.collection('lapink').doc('lapinkUsers').get().then(function (snap) {
          var lista = (snap.exists && snap.data() && snap.data().data) || [];
          resposta.usuarios = (Array.isArray(lista) ? lista : []).map(function (u) {
            return { email: u.email, name: u.name || u.email, role: u.role || 'client', pages: Array.isArray(u.pages) ? u.pages : null, createdAt: u.createdAt || null };
          });
          return { _listagem: true };
        });
      }
      email = _normalizarEmailAdmin(body.email);
      if (SUPERADMINS_FIXOS.indexOf(email) !== -1) {
        var protegido = new Error('O Super Admin fixo não pode ser alterado ou excluído.');
        protegido._status = 400; throw protegido;
      }
      return admin.auth().getUserByEmail(email).catch(function (err) {
        if (err && err.code === 'auth/user-not-found' && acao === 'criar') return null;
        throw err;
      });
    }).then(function (usuario) {
      if (usuario && usuario._listagem) return;
      if (acao === 'criar') {
        var senha = String(body.senha || '');
        var nome = String(body.nome || '').trim();
        var role = body.role === 'admin' ? 'admin' : 'client';
        if (!nome || senha.length < 6) { var e = new Error('Informe nome e senha com pelo menos 6 caracteres.'); e._status = 400; throw e; }
        if (usuario) { var existe = new Error('Este e-mail já está cadastrado.'); existe._status = 409; throw existe; }
        return admin.auth().createUser({ email: email, password: senha, displayName: nome, emailVerified: false })
          .then(function (novo) {
            var claims = role === 'admin' ? { role: 'admin', pages: null } : null;
            return admin.auth().setCustomUserClaims(novo.uid, claims).then(function () {
              return Promise.all([
                db.collection('usuarios').doc(novo.uid).set({ email: email, name: nome, role: role, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
                db.collection('adminPermissions').doc(novo.uid).set({ active: role === 'admin', pages: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
              ]);
            }).then(function () { return _salvarRegistroAdmin(email, { name: nome, role: role, pages: null }); });
          });
      }
      if (!usuario) { var nf = new Error('Usuário não encontrado no Firebase Authentication.'); nf._status = 404; throw nf; }
      if (acao === 'atualizar') {
        var novoNome = String(body.nome || usuario.displayName || email).trim();
        var novaRole = body.role === 'admin' ? 'admin' : 'client';
        var paginas = novaRole === 'admin' && Array.isArray(body.pages) ? body.pages.map(String) : null;
        var claimsAtualizadas = novaRole === 'admin' ? { role: 'admin', pages: paginas } : null;
        return admin.auth().updateUser(usuario.uid, { displayName: novoNome })
          .then(function () { return admin.auth().setCustomUserClaims(usuario.uid, claimsAtualizadas); })
          .then(function () { return admin.auth().revokeRefreshTokens(usuario.uid); })
          .then(function () { return Promise.all([
            db.collection('usuarios').doc(usuario.uid).set({ email: email, name: novoNome, role: novaRole, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
            db.collection('adminPermissions').doc(usuario.uid).set({ active: novaRole === 'admin', pages: paginas, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
          ]); })
          .then(function () { return _salvarRegistroAdmin(email, { name: novoNome, role: novaRole, pages: paginas }); });
      }
      if (acao === 'senha') {
        var novaSenha = String(body.senha || '');
        if (novaSenha.length < 6) { var curta = new Error('A senha deve ter pelo menos 6 caracteres.'); curta._status = 400; throw curta; }
        return admin.auth().updateUser(usuario.uid, { password: novaSenha });
      }
      if (acao === 'excluir') {
        return db.collection('enderecos').where('email', '==', email).get().then(function (enderecos) {
          var exclusoes = [];
          enderecos.forEach(function (doc) { exclusoes.push(doc.ref.delete()); });
          exclusoes.push(db.collection('enderecos').doc(usuario.uid).delete().catch(function () {}));
          exclusoes.push(db.collection('usuarios').doc(usuario.uid).delete().catch(function () {}));
          exclusoes.push(db.collection('adminPermissions').doc(usuario.uid).delete().catch(function () {}));
          exclusoes.push(admin.auth().revokeRefreshTokens(usuario.uid).then(function () { return admin.auth().deleteUser(usuario.uid); }));
          return Promise.all(exclusoes);
        }).then(function () {
          var ref = db.collection('lapink').doc('lapinkUsers');
          return db.runTransaction(function (tx) { return tx.get(ref).then(function (snap) {
            var lista = (snap.exists && snap.data() && snap.data().data) || [];
            lista = (Array.isArray(lista) ? lista : []).filter(function (u) { return String((u && u.email) || '').toLowerCase() !== email; });
            tx.set(ref, { data: lista, updatedAt: Date.now() }, { merge: true });
          }); });
        });
      }
      var invalida = new Error('Ação administrativa inválida.'); invalida._status = 400; throw invalida;
    }).then(function () {
      functions.logger.info('gerenciarUsuarioAdmin', {
        acao: acao,
        alvoHash: email ? crypto.createHash('sha256').update(email).digest('hex').slice(0, 16) : null,
        operadorUid: operador && operador.uid
      });
      res.status(200).json(resposta);
    }).catch(function (err) {
      var status = (err && err._status) || (err && err.code === 'auth/email-already-exists' ? 409 : 500);
      if (status >= 500) functions.logger.error('gerenciarUsuarioAdmin erro', err);
      res.status(status).json({ error: status >= 500 ? 'Erro ao gerenciar usuário.' : err.message });
    });
  });
});

// Retira pedidos da operação diária sem apagar o histórico de pagamento.
// A exclusão física de uma venda prejudicaria conciliação, auditoria e suporte;
// por isso o painel usa arquivamento reversível no documento do Firestore.
exports.arquivarPedido = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    _exigirPermissao(req, 'pedidos').then(function (usuario) {
      var pedidoId = String((req.body && req.body.pedidoId) || '').trim();
      if (!/^LPK-[A-Z0-9-]{4,40}$/.test(pedidoId)) {
        var eId = new Error('Identificador de pedido inválido.');
        eId._status = 400;
        throw eId;
      }
      return db.collection('pedidos').doc(pedidoId).get().then(function (snap) {
        if (!snap.exists) {
          var eNotFound = new Error('Pedido não encontrado.');
          eNotFound._status = 404;
          throw eNotFound;
        }
        return snap.ref.set({
          arquivado: true,
          arquivadoAt: admin.firestore.FieldValue.serverTimestamp(),
          arquivadoPor: String(usuario.email || usuario.uid || '').toLowerCase(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    }).then(function () {
      res.status(200).json({ ok: true });
    }).catch(function (err) {
      var status = (err && err._status) || 500;
      if (status >= 500) functions.logger.error('arquivarPedido erro', err);
      res.status(status).json({ error: status === 500 ? 'Erro ao arquivar pedido.' : err.message });
    });
  });
});

// Atualização operacional de pedido pelo painel. Centraliza a autorização no
// servidor e aceita somente status/rastreio, impedindo alteração de valores,
// cliente, pagamento ou itens mesmo para uma conta administrativa.
exports.atualizarPedidoAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    _exigirPermissao(req, 'pedidos').then(function () {
      var body = req.body || {};
      var pedidoId = String(body.pedidoId || '').trim();
      var status = body.status == null ? null : String(body.status).trim().toLowerCase();
      var rastreio = body.rastreio == null ? null : String(body.rastreio).trim().toUpperCase();
      var statusPermitidos = [
        'aguardando', 'pagamento_analise', 'pedido_analise', 'pago',
        'nota_fiscal', 'separacao', 'transporte', 'negado', 'cancelado'
      ];
      if (!/^LPK-[A-Z0-9-]{4,40}$/.test(pedidoId)) {
        var eId = new Error('Identificador de pedido inválido.'); eId._status = 400; throw eId;
      }
      if (status !== null && statusPermitidos.indexOf(status) === -1) {
        var eStatus = new Error('Status de pedido inválido.'); eStatus._status = 400; throw eStatus;
      }
      if (rastreio !== null && (!/^[A-Z0-9-]{5,40}$/.test(rastreio))) {
        var eRastreio = new Error('Código de rastreio inválido.'); eRastreio._status = 400; throw eRastreio;
      }
      if (status === null && rastreio === null) {
        var eVazio = new Error('Nenhuma alteração informada.'); eVazio._status = 400; throw eVazio;
      }
      var alteracoes = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (status !== null) alteracoes.status = status;
      if (rastreio !== null) alteracoes.rastreio = rastreio;
      return db.collection('pedidos').doc(pedidoId).get().then(function(snap) {
        if (!snap.exists) { var e404 = new Error('Pedido não encontrado.'); e404._status = 404; throw e404; }
        return snap.ref.update(alteracoes);
      });
    }).then(function () {
      res.status(200).json({ ok: true });
    }).catch(function (err) {
      var statusHttp = (err && err._status) || 500;
      if (statusHttp >= 500) functions.logger.error('atualizarPedidoAdmin erro', err);
      res.status(statusHttp).json({ error: statusHttp === 500 ? 'Erro ao atualizar pedido.' : err.message });
    });
  });
});

// Publica o carrossel como uma unidade autoritativa. Imagens tornam o array
// grande, então ele é particionado dentro da mesma transação e o índice
// principal só passa a apontar para as partes depois que todas foram gravadas.
exports.salvarCarrosselAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }
    var entrada = req.body && req.body.slides;
    var operador;
    _exigirPermissao(req, 'loja-v1').then(function (usuario) {
      operador = usuario;
      if (!Array.isArray(entrada) || entrada.length < 2 || entrada.length > 6) {
        var eLista = new Error('O carrossel deve possuir entre 2 e 6 slides.'); eLista._status = 400; throw eLista;
      }
      var cores = ['pink', 'rose', 'gold', 'mint', 'dark'];
      var acoes = ['colecao', 'colecoes', 'limpar', 'promocoes', 'promocao', 'brincos', 'aneis', 'colares', 'bolsas', ''];
      var slides = entrada.map(function (s) {
        s = s || {};
        var imagem = String(s.imagem || '');
        if (imagem && !/^data:image\/(jpeg|png|webp);base64,/i.test(imagem) && !/^https:\/\//i.test(imagem)) {
          var eImagem = new Error('Formato de imagem do carrossel inválido.'); eImagem._status = 400; throw eImagem;
        }
        if (imagem.length > 700 * 1024) { var eTam = new Error('Uma imagem do carrossel excede 700 KB.'); eTam._status = 400; throw eTam; }
        return {
          eyebrow: _sanitizarTexto(s.eyebrow, 100), titulo: _sanitizarTexto(s.titulo, 180),
          subtitulo: _sanitizarTexto(s.subtitulo, 260), btn1Txt: _sanitizarTexto(s.btn1Txt, 50),
          btn1Acao: acoes.indexOf(String(s.btn1Acao || '')) >= 0 ? String(s.btn1Acao || '') : '',
          btn2Txt: _sanitizarTexto(s.btn2Txt, 50),
          btn2Acao: acoes.indexOf(String(s.btn2Acao || '')) >= 0 ? String(s.btn2Acao || '') : '',
          imagem: imagem, icone: /^ti-[a-z0-9-]+$/.test(String(s.icone || '')) ? String(s.icone) : 'ti-diamond',
          cor: cores.indexOf(String(s.cor || '')) >= 0 ? String(s.cor) : 'pink'
        };
      });
      if (JSON.stringify(slides).length > 5 * 1024 * 1024) { var eTotal = new Error('O carrossel completo está muito grande.'); eTotal._status = 400; throw eTotal; }

      var partes = [], atual = [], tamanho = 2;
      slides.forEach(function (slide) {
        var len = JSON.stringify(slide).length + 1;
        if (atual.length && tamanho + len > 850 * 1024) { partes.push(atual); atual = []; tamanho = 2; }
        atual.push(slide); tamanho += len;
      });
      if (atual.length) partes.push(atual);
      var agora = Date.now();
      var principal = db.collection('lapink').doc('lapinkCarrossel');
      return db.runTransaction(function (tx) {
        partes.forEach(function (parte, i) {
          tx.set(db.collection('lapink').doc('lapinkCarrossel_' + i), { data: parte, updatedAt: agora });
        });
        tx.set(principal, { chunked: true, chunks: partes.length, updatedAt: agora });
      }).then(function () { return { slides: slides, updatedAt: agora }; });
    }).then(function (resultado) {
      functions.logger.info('salvarCarrosselAdmin', { slides: resultado.slides.length, operadorUid: operador && operador.uid });
      res.status(200).json({ ok: true, updatedAt: resultado.updatedAt });
    }).catch(function (err) {
      var status = err && err._status ? err._status : 500;
      if (status >= 500) functions.logger.error('salvarCarrosselAdmin erro', err);
      res.status(status).json({ error: status >= 500 ? 'Erro ao publicar carrossel.' : err.message });
    });
  });
});

// CRUD de promoções centralizado no servidor. Cada alteração é aplicada pelo
// ID dentro de uma transação, impedindo que duas telas sobrescrevam a lista
// inteira ou que uma exclusão seja desfeita por um cache antigo.
exports.gerenciarDescontoAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }
    var body = req.body || {};
    var acao = String(body.acao || '').trim().toLowerCase();
    var id = String(body.id || (body.desconto && body.desconto.id) || '').trim();
    var resposta;
    var operador;

    _exigirPermissao(req, 'descontos').then(function (usuario) {
      operador = usuario;
      if (['salvar', 'alternar', 'excluir'].indexOf(acao) === -1) {
        var eAcao = new Error('Ação de desconto inválida.'); eAcao._status = 400; throw eAcao;
      }
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
        var eId = new Error('Identificador de desconto inválido.'); eId._status = 400; throw eId;
      }

      var ref = db.collection('lapink').doc('lapinkDescontos');
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var remoto = snap.exists ? (snap.data() || {}) : {};
          var lista = Array.isArray(remoto.data) ? remoto.data.slice() : [];
          var indice = lista.findIndex(function (d) { return d && String(d.id) === id; });
          var agora = Date.now();

          if (acao === 'excluir') {
            if (indice < 0) { var e404 = new Error('Desconto não encontrado.'); e404._status = 404; throw e404; }
            lista.splice(indice, 1);
          } else if (acao === 'alternar') {
            if (indice < 0) { var eToggle = new Error('Desconto não encontrado.'); eToggle._status = 404; throw eToggle; }
            lista[indice] = Object.assign({}, lista[indice], { ativo: !lista[indice].ativo, updatedAt: agora });
          } else {
            var entrada = body.desconto || {};
            var nome = _sanitizarTexto(entrada.nome, 80);
            var percentual = Number(entrada.percentual);
            var inicio = String(entrada.inicio || '');
            var fim = String(entrada.fim || '');
            var produtoIds = Array.isArray(entrada.produtoIds)
              ? Array.from(new Set(entrada.produtoIds.map(String).filter(function (v) { return /^[A-Za-z0-9_-]{1,100}$/.test(v); }))).slice(0, 5000)
              : [];
            if (!nome) { var eNome = new Error('Informe o nome da promoção.'); eNome._status = 400; throw eNome; }
            if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) { var ePct = new Error('Percentual inválido.'); ePct._status = 400; throw ePct; }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) { var eData = new Error('Período inválido.'); eData._status = 400; throw eData; }
            if (!produtoIds.length) { var eProdutos = new Error('Selecione ao menos um produto.'); eProdutos._status = 400; throw eProdutos; }
            var anterior = indice >= 0 ? lista[indice] : {};
            var desconto = { id: id, nome: nome, percentual: percentual, inicio: inicio, fim: fim,
              ativo: entrada.ativo === true, produtoIds: produtoIds,
              createdAt: Number(anterior.createdAt) || agora, updatedAt: agora };
            if (indice >= 0) lista[indice] = desconto; else lista.push(desconto);
          }

          resposta = { ok: true, descontos: lista, updatedAt: agora };
          tx.set(ref, { data: lista, updatedAt: agora });
        });
      });
    }).then(function () {
      functions.logger.info('gerenciarDescontoAdmin', { acao: acao, descontoId: id, operadorUid: operador && operador.uid });
      res.status(200).json(resposta);
    }).catch(function (err) {
      var status = err && err._status ? err._status : 500;
      if (status >= 500) functions.logger.error('gerenciarDescontoAdmin erro', err);
      res.status(status).json({ error: status >= 500 ? 'Erro ao gerenciar desconto.' : err.message });
    });
  });
});

// Liga/desliga o benefício de recém-inscrito sem dar à página de descontos
// permissão para sobrescrever toda a configuração visual da loja.
exports.configurarDescontoBoasVindas = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }
    var ativo = !!(req.body && req.body.ativo);
    _exigirPermissao(req, 'descontos').then(function () {
      var ref = db.collection('lapink').doc('lapinkLojaConfig');
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var atual = snap.exists ? (snap.data() || {}) : {};
          var dados = atual.data && typeof atual.data === 'object' ? atual.data : {};
          var anterior = dados.descontoBoasVindas && typeof dados.descontoBoasVindas === 'object' ? dados.descontoBoasVindas : {};
          dados.descontoBoasVindas = Object.assign({}, anterior, {
            ativo: ativo,
            percentual: Math.max(0, Math.min(90, Number(anterior.percentual) || 10))
          });
          tx.set(ref, { data: dados, updatedAt: Date.now() }, { merge: true });
        });
      });
    }).then(function () { res.json({ ok: true, ativo: ativo }); })
      .catch(function (err) {
        var status = err && err._status ? err._status : 500;
        res.status(status).json({ error: status >= 500 ? 'Erro ao alterar desconto de recém-inscrito.' : err.message });
      });
  });
});

// Cupons ficam em documento privado: somente administradores listam e alteram;
// clientes descobrem apenas se o código digitado é válido durante a cotação.
exports.gerenciarCupomAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }
    var body = req.body || {}, acao = String(body.acao || '').toLowerCase();
    var id = String(body.id || (body.cupom && body.cupom.id) || '').trim();
    var resposta, operador;
    _exigirPermissao(req, 'descontos').then(function (usuario) {
      operador = usuario;
      if (['listar', 'salvar', 'alternar', 'excluir'].indexOf(acao) < 0) throw Object.assign(new Error('Ação de cupom inválida.'), { _status:400 });
      if (acao !== 'listar' && !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw Object.assign(new Error('Identificador de cupom inválido.'), { _status:400 });
      var ref = db.collection('lapink').doc('lapinkCupons');
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var remoto = snap.exists ? (snap.data() || {}) : {};
          var lista = Array.isArray(remoto.data) ? remoto.data.slice() : [];
          var indice = lista.findIndex(function (c) { return c && String(c.id) === id; });
          var agora = Date.now();
          if (acao === 'listar') { resposta = { ok:true, cupons:lista, updatedAt:Number(remoto.updatedAt)||0 }; return; }
          if (acao === 'excluir') {
            if (indice < 0) throw Object.assign(new Error('Cupom não encontrado.'), { _status:404 });
            lista.splice(indice, 1);
          } else if (acao === 'alternar') {
            if (indice < 0) throw Object.assign(new Error('Cupom não encontrado.'), { _status:404 });
            lista[indice] = Object.assign({}, lista[indice], { ativo:!lista[indice].ativo, updatedAt:agora });
          } else {
            var entrada = body.cupom || {};
            var codigo = String(entrada.codigo || '').trim().toUpperCase();
            var nome = _sanitizarTexto(entrada.nome, 80), pct = Number(entrada.percentual);
            var minimo = Number(entrada.valorMinimo) || 0, inicio = String(entrada.inicio || ''), fim = String(entrada.fim || '');
            if (!/^[A-Z0-9_-]{3,30}$/.test(codigo)) throw Object.assign(new Error('Use um código de 3 a 30 letras, números, _ ou -.'), { _status:400 });
            if (lista.some(function (c, i) { return i !== indice && String(c.codigo).toUpperCase() === codigo; })) throw Object.assign(new Error('Este código já existe.'), { _status:409 });
            if (!nome) throw Object.assign(new Error('Informe o nome do cupom.'), { _status:400 });
            if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw Object.assign(new Error('Percentual inválido.'), { _status:400 });
            if (!Number.isFinite(minimo) || minimo < 0) throw Object.assign(new Error('Valor mínimo inválido.'), { _status:400 });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) throw Object.assign(new Error('Período inválido.'), { _status:400 });
            var anterior = indice >= 0 ? lista[indice] : {};
            var cupom = { id:id, codigo:codigo, nome:nome, percentual:pct, valorMinimo:minimo, inicio:inicio, fim:fim,
              ativo:entrada.ativo === true, createdAt:Number(anterior.createdAt)||agora, updatedAt:agora };
            if (indice >= 0) lista[indice] = cupom; else lista.push(cupom);
          }
          resposta = { ok:true, cupons:lista, updatedAt:agora };
          tx.set(ref, { data:lista, updatedAt:agora });
        });
      });
    }).then(function () {
      functions.logger.info('gerenciarCupomAdmin', { acao:acao, cupomId:id || null, operadorUid:operador && operador.uid });
      res.json(resposta);
    }).catch(function (err) {
      var status = err && err._status ? err._status : 500;
      if (status >= 500) functions.logger.error('gerenciarCupomAdmin erro', err);
      res.status(status).json({ error:status >= 500 ? 'Erro ao gerenciar cupom.' : err.message });
    });
  });
});

// Cotação de preços para pedidos finalizados pelo WhatsApp. Nenhum preço do
// navegador é aceito: catálogo, promoções e boas-vindas são relidos aqui.
exports.validarCarrinhoDescontos = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }
    var itens = req.body && req.body.itens;
    if (!Array.isArray(itens) || !itens.length || itens.length > 50) { res.status(400).json({ error: 'Carrinho inválido.' }); return; }
    Promise.all([
      lerCatalogo(), lerDescontos(), db.collection('lapink').doc('lapinkLojaConfig').get(), usuarioOpcional(req), lerCupons()
    ]).then(function (arr) {
      var mapa = {};
      arr[0].prods.forEach(function (p) { mapa[String(p.id)] = p; });
      var cfg = (arr[2].exists && arr[2].data() && arr[2].data().data) || {};
      var welcomeCfg = cfg.descontoBoasVindas || {};
      var welcome = welcomeCfg.ativo && arr[3] && Number(req.body.descontoPct) > 0
        ? Math.min(90, Number(req.body.descontoPct), Number(welcomeCfg.percentual) || 0) : 0;
      var subtotalCatalogo = itens.reduce(function (s, it) {
        var p = mapa[String(it.id)], q = Number(it.qty);
        return s + (p && Number.isInteger(q) && q > 0 ? (Number(p.precoAtacado) || Number(p.precoVarejo) || 0) * q : 0);
      }, 0);
      var cupom = cupomValido(req.body.cupom, arr[4], subtotalCatalogo, Date.now());
      if (String(req.body.cupom || '').trim() && !cupom) throw Object.assign(new Error('Cupom inválido, inativo, fora do período ou abaixo do valor mínimo.'), { _status:400 });
      var cupomPct = cupom ? cupom.percentual : 0;
      var subtotal = 0, descontos = 0, usouWelcome = false;
      var calculados = itens.map(function (it) {
        var p = mapa[String(it.id)];
        var qty = Number(it.qty);
        if (!p || !Number.isInteger(qty) || qty < 1 || qty > 100) throw Object.assign(new Error('Produto ou quantidade inválida.'), { _status: 400 });
        var estoque = typeof p.estoque === 'undefined' ? null : (parseInt(p.estoque) || 0);
        if (estoque !== null && (estoque <= 0 || qty > estoque)) throw Object.assign(new Error('Estoque insuficiente para ' + p.nome + '.'), { _status: 409 });
        var original = (Number(p.precoAtacado) || Number(p.precoVarejo) || 0);
        var promo = descontoProdutoValido(p.id, arr[1], Date.now());
        var usarPromo = !!(promo && promo.percentual >= Math.max(welcome, cupomPct));
        var pct = usarPromo ? promo.percentual : Math.max(welcome, cupomPct);
        var usarCupom = !usarPromo && cupomPct >= welcome && cupomPct > 0;
        if (!usarPromo && !usarCupom && pct > 0) usouWelcome = true;
        var final = Math.max(0, Math.round(original * (1 - pct / 100) * 100) / 100);
        subtotal += original * qty; descontos += (original - final) * qty;
        return { id:p.id, nome:p.nome, qty:qty, preco:final, precoOriginal:original, descontoPct:pct,
          descontoValor:Math.round((original-final)*100)/100, precoUnitarioFinal:final,
          subtotalFinal:Math.round(final*qty*100)/100, promocaoId:usarPromo?promo.id:null,
          promocaoNome:usarPromo?promo.nome:(usarCupom?cupom.nome:(pct?'Boas-vindas':null)), tipoDesconto:pct?(usarPromo?'produto':(usarCupom?'cupom':'boas_vindas')):null };
      });
      res.json({ itens:calculados, subtotal:Math.round(subtotal*100)/100, desconto:Math.round(descontos*100)/100,
        totalProdutos:Math.round((subtotal-descontos)*100)/100, usouDescontoBoasVindas:usouWelcome,
        cupom:cupom ? { codigo:cupom.codigo, nome:cupom.nome, percentual:cupom.percentual } : null });
    }).catch(function (err) {
      var status = err && err._status ? err._status : 500;
      res.status(status).json({ error:status >= 500 ? 'Erro ao validar preços.' : err.message });
    });
  });
});

exports.registrarPagamentoManualAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido. Use POST.' }); return; }
    var pedidoId = String((req.body && req.body.pedidoId) || '').trim();
    var usuarioAdmin;
    _exigirPermissao(req, 'financeiro').then(function (decoded) {
      usuarioAdmin = decoded;
      if (!/^LPK-[A-Z0-9-]{4,40}$/.test(pedidoId)) { var e = new Error('Identificador de pedido inválido.'); e._status = 400; throw e; }
      return db.collection('pedidos').doc(pedidoId).get();
    }).then(function (snap) {
      if (!snap.exists) { var e404 = new Error('Pedido não encontrado.'); e404._status = 404; throw e404; }
      var pedido = snap.data() || {};
      if (pedido.mp_payment_id && pedido.mp_status && pedido.mp_status !== 'manual') {
        var eMp = new Error('Pedidos do Mercado Pago só podem ser confirmados pelo webhook do pagamento.'); eMp._status = 409; throw eMp;
      }
      return processarPagamentoAtomico({
        external_reference: pedidoId,
        transaction_amount: Number(pedido.total),
        currency_id: 'BRL',
        status: 'approved'
      }, 'manual-' + Date.now()).then(function () {
        return snap.ref.set({
          pagamentoManual: true,
          mp_status: 'manual',
          pagamentoManualPor: String(usuarioAdmin.email || usuarioAdmin.uid || '').toLowerCase(),
          pagamentoManualAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    }).then(function () { res.status(200).json({ ok: true }); })
      .catch(function (err) {
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('registrarPagamentoManualAdmin erro', err);
        res.status(status).json({ error: status >= 500 ? 'Erro ao registrar pagamento manual.' : err.message });
      });
  });
});

// ---------------------------------------------------------------------------
// Notificações push (Web Push) — usado para avisar o(s) admin(s) quando uma
// venda é confirmada, sem precisar de aplicativo: é o mesmo mecanismo por
// trás das notificações nativas de qualquer site (Gmail, Twitter, etc.),
// funciona com o navegador em segundo plano em Android/Chrome.
//
// Inscrições ficam em pushSubscriptions/{hash-do-endpoint} — só a Function
// grava/lê (Admin SDK); o cliente nunca acessa essa coleção direto (ver
// firestore.rules). Uma "inscrição morta" (permissão revogada, navegador
// desinstalado, dados do site limpos) é removida sozinha na primeira vez
// que o envio falhar com 404/410 — sem isso, o envio ficaria tentando pra
// sempre contra um destino que nunca mais vai responder.
// ---------------------------------------------------------------------------
function _webpushConfigurado() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function _enviarPushTodasInscricoes(payload, apenasEmail) {
  if (!_webpushConfigurado()) {
    functions.logger.warn('push: VAPID não configurado (functions/.env) — notificação não enviada.');
    return Promise.resolve({ enviados: 0, total: 0 });
  }
  webpush.setVapidDetails('mailto:contato@lapink.com.br', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  var query = db.collection('pushSubscriptions');
  if (apenasEmail) query = query.where('email', '==', apenasEmail);

  return query.get().then(function (qs) {
    var docs = [];
    qs.forEach(function (d) { docs.push(d); });
    if (!docs.length) return { enviados: 0, total: 0 };

    var corpo = JSON.stringify(payload);
    var enviados = 0;
    return Promise.all(docs.map(function (doc) {
      var sub = doc.data();
      return webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, corpo)
        .then(function () { enviados++; })
        .catch(function (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            return doc.ref.delete().catch(function () {});
          }
          functions.logger.warn('push falhou p/ ' + (sub.email || doc.id) + ': ' + (err && err.message));
        });
    })).then(function () { return { enviados: enviados, total: docs.length }; });
  });
}

// Chamado pelo mpWebhook assim que um pedido vira 'pago' pela primeira vez.
function _notificarVendaAdmins(pedido, numeroPedido) {
  var total = parseFloat(pedido.total) || 0;
  var totalFmt = 'R$ ' + total.toFixed(2).replace('.', ',');
  var numero = numeroPedido || pedido.numero || '';
  return _enviarPushTodasInscricoes({
    title: '🎉 Nova venda — ' + totalFmt,
    body: numero ? 'Pedido #' + numero : 'Toque para ver os detalhes',
    url: '/admin/pedidos.html',
    tag: 'venda-' + (numero || Date.now())
  });
}

// ---------------------------------------------------------------------------
// 3. cobrarAbandonados — envia WhatsApp para carrinhos abandonados (Cloud API)
//    Requer: plano Blaze + WhatsApp Business Cloud API + admin autenticado
//    (Bearer <ID token>) — antes qualquer um que soubesse a URL conseguia
//    disparar mensagens reais de WhatsApp pros clientes, sem nenhum controle.
//    Config: process.env.WHATSAPP_TOKEN (token) e lapink/apiConfig.data.wbaPhoneId
//    Acione pelo painel (ou Cloud Scheduler usando uma conta de serviço admin).
//    Janela: > 30 min abertos.
// ---------------------------------------------------------------------------
exports.registrarCarrinhoAbandonado = functions.https.onRequest(function(req, res) {
  cors(req, res, function() {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido. Use POST.' }); return; }
    var body = req.body || {};
    var id = String(body.id || '').trim();
    var celular = String(body.celular || '').replace(/\D/g, '');
    var itens = Array.isArray(body.itens) ? body.itens.slice(0, 50) : [];
    var token = String(body.token || '');
    if (!/^AB-[A-Z0-9]{6,30}$/.test(id) || celular.length < 10 || celular.length > 11 || !itens.length) {
      res.status(400).json({ error: 'Carrinho abandonado inválido.' }); return;
    }
    var ref = db.collection('abandonados').doc(id);
    ref.get().then(function(snap) {
      var segredo = token;
      if (snap.exists) {
        var d = snap.data() || {};
        if (!segredo || hashAcessoPedido(segredo) !== d.acessoHash) { var e = new Error('Acesso ao carrinho negado.'); e._status = 403; throw e; }
      } else {
        segredo = crypto.randomBytes(32).toString('hex');
      }
      var itensLimpos = itens.map(function(item) {
        return { id: _sanitizarTexto(item.id, 30), nome: _sanitizarTexto(item.nome, 120), qty: Math.max(1, Math.min(100, Number(item.qty) || 1)), preco: Math.max(0, Number(item.preco) || 0) };
      });
      return ref.set({
        id: id, nome: _sanitizarTexto(body.nome, 120), celular: celular,
        email: _sanitizarTexto(body.email, 160).toLowerCase(), itens: itensLimpos,
        total: Math.max(0, Number(body.total) || 0), status: 'aberto',
        acessoHash: hashAcessoPedido(segredo), createdAt: snap.exists ? (snap.data().createdAt || Date.now()) : Date.now(),
        updatedAt: Date.now(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }, { merge: false }).then(function() { res.status(200).json({ ok: true, token: segredo }); });
    }).catch(function(err) {
      var status = err._status || 500;
      if (status >= 500) functions.logger.error('registrarCarrinhoAbandonado erro', err);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'Erro ao registrar carrinho.' : err.message });
    });
  });
});

exports.converterCarrinhoAbandonado = functions.https.onRequest(function(req, res) {
  cors(req, res, function() {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido. Use POST.' }); return; }
    var id = String((req.body && req.body.id) || '').trim();
    var token = String((req.body && req.body.token) || '');
    if (!/^AB-[A-Z0-9]{6,30}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
    var ref = db.collection('abandonados').doc(id);
    db.runTransaction(function(tx) { return tx.get(ref).then(function(snap) {
      if (!snap.exists) { var e404 = new Error('Carrinho não encontrado.'); e404._status = 404; throw e404; }
      var d = snap.data() || {};
      if (hashAcessoPedido(token) !== d.acessoHash) { var e403 = new Error('Acesso ao carrinho negado.'); e403._status = 403; throw e403; }
      tx.update(ref, { status: 'convertido', convertedAt: Date.now(), updatedAt: Date.now() });
    }); }).then(function() { res.status(200).json({ ok: true }); }).catch(function(err) {
      var status = err._status || 500;
      if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'Erro ao converter carrinho.' : err.message });
    });
  });
});

exports.cobrarAbandonados = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    _exigirPermissao(req, 'pedidos').then(function () {
      return db.collection('lapink').doc('apiConfig').get()
      .then(function (snap) {
        var cfg = (snap.exists && snap.data() && snap.data().data) || {};
        var token = process.env.WHATSAPP_TOKEN || cfg.wbaToken;
        var phoneId = cfg.wbaPhoneId;
        if (!token || !phoneId) {
          throw new Error('WhatsApp não configurado (token + Phone ID).');
        }
        var corte = Date.now() - 30 * 60 * 1000; // 30 min
        return db.collection('abandonados').where('status', '==', 'aberto').limit(50).get()
          .then(function (qs) {
            var pendentes = [];
            qs.forEach(function (doc) {
              var a = doc.data();
              if ((a.createdAt || 0) <= corte) pendentes.push(Object.assign({ _id: doc.id }, a));
            });

            var enviados = 0;
            return pendentes.reduce(function (chain, a) {
              return chain.then(function () {
                var num = String(a.celular || '').replace(/\D/g, '');
                if (num.length <= 11) num = '55' + num;
                var primeiroNome = String(a.nome || '').split(' ')[0] || 'Olá';
                var texto = 'Oi ' + primeiroNome + '! 💖 Vi que você deixou itens no carrinho da LaPink. ' +
                  'Posso te ajudar a finalizar a compra? https://www.lapinkacessorios.com.br/public/V1.html';
                return fetch('https://graph.facebook.com/v18.0/' + phoneId + '/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: num,
                    type: 'text',
                    text: { body: texto }
                  })
                }).then(function (r) {
                  if (r.ok) {
                    enviados++;
                    return db.collection('abandonados').doc(a._id)
                      .set({ status: 'contatado', updatedAt: Date.now() }, { merge: true });
                  }
                  return r.text().then(function (t) { functions.logger.warn('WhatsApp falhou p/ ' + num + ': ' + t); });
                }).catch(function (e) { functions.logger.warn('WhatsApp erro: ' + e.message); });
              });
            }, Promise.resolve()).then(function () { return { total: pendentes.length, enviados: enviados }; });
          });
      });
    })
      .then(function (r) { res.status(200).json(r); })
      .catch(function (err) {
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('cobrarAbandonados erro', err);
        res.status(status).json({ error: (err && err.message) || 'Erro interno.' });
      });
  });
});

// ---------------------------------------------------------------------------
// 4. cotarFrete — cotação de frete por CEP (Correios + transportadoras)
//    Provedores ativados independentemente em lapink/lapinkEntregaConfig.data:
//      mandabemAtivo (bool) → Manda Bem (plataforma_id + plataforma_chave)
//      meAtivo       (bool) → Melhor Envio (token)
//    Com os dois ativos ao mesmo tempo, cotarFrete consulta ambos em paralelo
//    e devolve todas as opções juntas, ordenadas do menor pro maior preço —
//    o cliente escolhe a mais barata entre os provedores configurados. Se um
//    provedor falhar (token errado, fora do ar), isso não derruba o outro.
//    Compat: instalações antigas com só o campo freteProvider ('mandabem' /
//    'melhorenvio') continuam funcionando com um único provedor ativo.
//    Segredos em lapink/apiConfig.data (mandabemToken, meToken). Requer Blaze.
//    O cliente envia cepDestino, pesoG e valor.
// ---------------------------------------------------------------------------

// Adaptador Melhor Envio → [{id,empresa,servico,preco,prazo}]
function _freteMelhorEnvio(p) {
  var token = process.env.MELHOR_ENVIO_TOKEN || p.token;
  if (!token) throw { _status: 503, message: 'Frete não configurado (token Melhor Envio ausente).' };
  var base = p.sandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br';
  var payload = {
    from: { postal_code: p.cepOrigem },
    to: { postal_code: p.cepDestino },
    package: { weight: p.pesoKg, width: Number(p.dims.width) || 18, height: Number(p.dims.height) || 8.5, length: Number(p.dims.length) || 12 },
    options: { insurance_value: p.valor, receipt: false, own_hand: false }
  };
  return fetch(base + '/api/v2/me/shipment/calculate', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'User-Agent': p.userAgent || 'LaPink (contato@lapink.com.br)' },
    body: JSON.stringify(payload)
  }).then(function (r) {
    return r.json().then(function (arr) {
      if (!r.ok) { functions.logger.error('MelhorEnvio erro', arr); throw { _status: 502, message: 'Erro na cotação de frete.' }; }
      var opcoes = (Array.isArray(arr) ? arr : []).filter(function (o) { return o && !o.error && (o.price || o.custom_price); });
      // Filtro "somente Correios" (padrão ligado): PAC / SEDEX / Mini Envios
      if (p.somenteCorreios !== false) {
        opcoes = opcoes.filter(function (o) { return o.company && /correios/i.test(o.company.name || ''); });
      }
      return opcoes.map(function (o) {
        var prazo = o.delivery_time || (o.delivery_range && o.delivery_range.max) || null;
        return { id: String(o.id), empresa: (o.company && o.company.name) || '', servico: o.name || '', preco: Number(o.custom_price || o.price) || 0, prazo: prazo };
      }).sort(function (a, b) { return a.preco - b.preco; });
    });
  });
}

// Adaptador Manda Bem → [{id,empresa,servico,preco,prazo}]  (POST form-urlencoded, 1 chamada por serviço)
function _freteMandaBem(p) {
  var id = process.env.MANDABEM_ID || p.id;
  var chave = process.env.MANDABEM_TOKEN || p.chave;
  if (!id || !chave) throw { _status: 503, message: 'Frete não configurado (API ID/Token do Manda Bem ausente).' };
  var servicos = ['PAC', 'SEDEX', 'PACMINI'];
  var nomes = { PAC: 'PAC (Correios)', SEDEX: 'SEDEX (Correios)', PACMINI: 'PAC Mini (Correios)' };
  var baseParams = {
    plataforma_id: String(id),
    plataforma_chave: String(chave),
    cep_origem: p.cepOrigem,
    cep_destino: p.cepDestino,
    peso: String(p.pesoKg),
    altura: String(Number(p.dims.height) || 8.5),
    largura: String(Number(p.dims.width) || 18),
    comprimento: String(Number(p.dims.length) || 12),
    valor_seguro: (Number(p.valor) || 0).toFixed(2)
  };
  return Promise.all(servicos.map(function (sv) {
    var form = new URLSearchParams(Object.assign({}, baseParams, { servico: sv }));
    return fetch('https://mandabem.com.br/ws/valor_envio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: form.toString()
    }).then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (j) { return { sv: sv, j: j }; })
      .catch(function () { return { sv: sv, j: null }; });
  })).then(function (results) {
    var opcoes = [];
    results.forEach(function (rr) {
      var resu = rr.j && rr.j.resultado;
      if (!resu || String(resu.sucesso) !== 'true') return;
      var s = resu[rr.sv];
      if (!s || s.valor == null) return;
      var preco = parseFloat(String(s.valor).replace(',', '.')) || 0;
      if (preco <= 0) return;
      opcoes.push({ id: 'mb_' + rr.sv, empresa: 'Correios', servico: nomes[rr.sv] || rr.sv, preco: preco, prazo: (s.prazo != null ? Number(s.prazo) : null) });
    });
    return opcoes;
  });
}

// ---------------------------------------------------------------------------
// 3b. verificarCarrinhosAbandonados — avisa o(s) admin(s) por push assim que
//    um carrinho fica parado tempo suficiente pra contar como abandonado.
//    Diferente de cobrarAbandonados (que manda WhatsApp pro CLIENTE e só
//    roda quando alguém clica no painel): esta aqui roda sozinha, em
//    intervalo fixo, e notifica o ADMIN — não o cliente, nada é enviado
//    pra fora da loja.
//
//    "Abandonado" aqui não é um evento único (como um pagamento aprovado):
//    é uma peça de estado (abandonados/{id}, status:'aberto') que só vira
//    "abandono de verdade" pela PASSAGEM DO TEMPO sem o cliente voltar. Por
//    isso precisa de um agendamento (Cloud Scheduler) em vez de um gatilho
//    único — não existe um "webhook de abandono".
//
//    Limiar: 15 min sem interação (updatedAt, que é tocado a cada blur nos
//    campos de nome/celular do checkout — reflete a ÚLTIMA atividade, não
//    quando o carrinho começou). Roda a cada 10 min. Cada carrinho é
//    notificado UMA vez (campo notificadoAdmin) — sem isso, o mesmo
//    carrinho pareceria "abandonado de novo" a cada execução seguinte.
//
//    _EPOCH_ABANDONO evita uma enxurrada de notificações de carrinhos
//    antigos no primeiro deploy: só processa quem ficou parado DEPOIS do
//    momento em que este recurso entrou no ar (carrinhos de antes já
//    estavam ali, sem ninguém observando — não faz sentido avisar agora).
//
//    Requer plano Blaze (Cloud Scheduler) — mesmo plano que já é exigido
//    pelas demais Functions que fazem chamada de saída (Mercado Pago,
//    WhatsApp, fretes). Custo da própria função: irrelevante (6
//    execuções/hora, bem dentro da faixa gratuita do Cloud Functions).
// ---------------------------------------------------------------------------
var _EPOCH_ABANDONO = 1786671408438; // Date.now() no momento em que este recurso foi criado

exports.verificarCarrinhosAbandonados = functions.pubsub.schedule('every 10 minutes').onRun(function () {
  var LIMIAR_MS = 15 * 60 * 1000; // 15 min sem interação
  var corte = Date.now() - LIMIAR_MS;

  return db.collection('abandonados').where('status', '==', 'aberto').limit(50).get()
    .then(function (qs) {
      var novos = [];
      qs.forEach(function (doc) {
        var a = doc.data();
        var ultimaAtividade = a.updatedAt || a.createdAt || 0;
        if (ultimaAtividade >= _EPOCH_ABANDONO && ultimaAtividade <= corte && !a.notificadoAdmin) {
          novos.push(Object.assign({ _id: doc.id }, a));
        }
      });
      if (!novos.length) return { notificados: 0 };

      return novos.reduce(function (chain, a) {
        return chain.then(function () {
          var nome = String(a.nome || 'Alguém').split(' ')[0];
          var qtdItens = Array.isArray(a.itens) ? a.itens.length : 0;
          var totalFmt = 'R$ ' + (parseFloat(a.total) || 0).toFixed(2).replace('.', ',');
          return _enviarPushTodasInscricoes({
            title: '🛒 Carrinho abandonado',
            body: nome + ' deixou ' + qtdItens + ' item(ns) no carrinho (' + totalFmt + ') sem finalizar.',
            url: '/admin/pedidos.html',
            tag: 'abandono-' + a._id
          }).then(function () {
            return db.collection('abandonados').doc(a._id)
              .set({ notificadoAdmin: true, notificadoAdminAt: Date.now() }, { merge: true });
          });
        });
      }, Promise.resolve()).then(function () { return { notificados: novos.length }; });
    })
    .catch(function (err) {
      functions.logger.error('verificarCarrinhosAbandonados erro', err);
    });
});

// Retenção LGPD: elimina dados transitórios após o prazo definido no próprio
// documento. A rotina torna a política efetiva mesmo sem configurar TTL no
// console e processa em lotes para não exceder os limites do Firestore.
exports.limparDadosExpiradosLGPD = functions.pubsub.schedule('every day 03:15').timeZone('America/Bahia').onRun(function () {
  var agora = new Date();

  function limparColecao(nome) {
    return db.collection(nome).where('expiresAt', '<=', agora).limit(400).get()
      .then(function (qs) {
        if (qs.empty) return 0;
        var batch = db.batch();
        qs.docs.forEach(function (doc) { batch.delete(doc.ref); });
        return batch.commit().then(function () { return qs.size; });
      });
  }

  return Promise.all([
    limparColecao('abandonados'),
    limparColecao('analyticsDedupe')
  ]).then(function (quantidades) {
    functions.logger.info('Limpeza LGPD concluída', {
      abandonados: quantidades[0],
      analyticsDedupe: quantidades[1]
    });
    return { removidos: quantidades[0] + quantidades[1] };
  }).catch(function (err) {
    functions.logger.error('limparDadosExpiradosLGPD erro', err);
    throw err;
  });
});

exports.cotarFrete = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var body = req.body || {};
    var cepDestino = String(body.cepDestino || '').replace(/\D/g, '');
    var pesoKg = Math.max(0.3, (Number(body.pesoG) || 0) / 1000); // mínimo 0,3 kg
    var valor = Number(body.valor) || 0;
    var dims = body.dimensoes || {};

    if (cepDestino.length !== 8) {
      res.status(400).json({ error: 'CEP de destino inválido.' });
      return;
    }

    Promise.all([
      db.collection('lapink').doc('apiConfig').get(),          // segredos (tokens)
      db.collection('lapink').doc('lapinkEntregaConfig').get() // config (provedor, CEP origem)
    ])
      .then(function (snaps) {
        var secret = (snaps[0].exists && snaps[0].data() && snaps[0].data().data) || {};
        var entrega = (snaps[1].exists && snaps[1].data() && snaps[1].data().data) || {};
        // Origem padrão da loja: Av. Centenário — Centro, Criciúma/SC
        var cepOrigem = String(entrega.cepOrigem || '88801000').replace(/\D/g, '');
        if (cepOrigem.length !== 8) cepOrigem = '88801000';

        // Provedores ativos: flags independentes (mandabemAtivo/meAtivo). Sem
        // nenhuma das duas gravada ainda (instalação antiga), cai pro campo
        // único freteProvider e, na falta dele, detecta pelo que tiver segredo.
        var temFlags = entrega.mandabemAtivo != null || entrega.meAtivo != null;
        var mandabemAtivo, meAtivo;
        if (temFlags) {
          mandabemAtivo = !!entrega.mandabemAtivo;
          meAtivo = !!entrega.meAtivo;
        } else {
          mandabemAtivo = entrega.freteProvider === 'mandabem';
          meAtivo = entrega.freteProvider === 'melhorenvio';
          if (!mandabemAtivo && !meAtivo && !entrega.freteProvider) {
            if (process.env.MANDABEM_TOKEN || secret.mandabemToken) mandabemAtivo = true;
            else if (process.env.MELHOR_ENVIO_TOKEN || secret.meToken) meAtivo = true;
          }
        }

        var comum = { cepOrigem: cepOrigem, cepDestino: cepDestino, pesoKg: pesoKg, valor: valor, dims: dims };
        var chamadas = [];

        if (mandabemAtivo) {
          chamadas.push(
            Promise.resolve().then(function () {
              return _freteMandaBem(Object.assign({ id: entrega.mandabemId, chave: secret.mandabemToken }, comum));
            }).then(function (opcoes) {
              return opcoes.map(function (o) { return Object.assign({ provedor: 'mandabem' }, o); });
            }).catch(function (err) {
              functions.logger.warn('cotarFrete: Manda Bem indisponível — ' + ((err && err.message) || err));
              return [];
            })
          );
        }
        if (meAtivo) {
          chamadas.push(
            Promise.resolve().then(function () {
              return _freteMelhorEnvio(Object.assign({ token: secret.meToken, sandbox: entrega.meSandbox, userAgent: entrega.meUserAgent, somenteCorreios: entrega.meSomenteCorreios }, comum));
            }).then(function (opcoes) {
              return opcoes.map(function (o) { return Object.assign({ provedor: 'melhorenvio' }, o); });
            }).catch(function (err) {
              functions.logger.warn('cotarFrete: Melhor Envio indisponível — ' + ((err && err.message) || err));
              return [];
            })
          );
        }

        if (!chamadas.length) {
          var eSemProvedor = new Error('Nenhum provedor de frete ativo. Configure o Manda Bem ou o Melhor Envio no painel.');
          eSemProvedor._status = 503;
          throw eSemProvedor;
        }

          return Promise.all(chamadas).then(function (listas) {
            var todas = [].concat.apply([], listas).sort(function (a, b) { return (a.preco || 0) - (b.preco || 0); });
          if (!todas.length) {
            var eFalha = new Error('Não foi possível cotar o frete agora. Verifique as credenciais dos provedores no painel.');
            eFalha._status = 502;
            throw eFalha;
          }
            var segredoCotacao = process.env.FRETE_QUOTE_SECRET || process.env.MP_ACCESS_TOKEN || secret.mpAccessToken;
            if (!segredoCotacao) throw new Error('Segredo para assinatura da cotação não configurado.');
            return todas.map(function (o) {
              return Object.assign({}, o, { cotacaoToken: assinarCotacaoFrete(o, cepDestino, segredoCotacao) });
            });
        });
      })
      .then(function (opcoes) {
        res.status(200).json({ opcoes: opcoes });
      })
      .catch(function (err) {
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('cotarFrete erro', err);
        res.status(status).json({ error: (err && err.message) || 'Erro interno na cotação.' });
      });
  });
});

// ---------------------------------------------------------------------------
// 5. sincronizarClaimsAdmin — grava o role (admin/superadmin) como CUSTOM
//    CLAIM no token do Firebase Auth, para o Firestore poder confiar nele
//    nas rules (request.auth.token.role). Sem isso, o "role" só existia em
//    documentos que o próprio navegador escreve — não dava pra usar como
//    fonte de verdade em regra de segurança (qualquer um podia mentir).
//
//    Só o dono do token pode sincronizar A PRÓPRIA claim: o e-mail vem do ID
//    token verificado pelo Admin SDK (não dá pra forjar), nunca do que o
//    cliente manda no corpo da requisição. O role atribuído é o que já está
//    gravado em lapink/lapinkUsers (lido via Admin SDK, ignora as rules) ou
//    um dos dois super admins fixos do projeto — nunca inventado pelo cliente.
// ---------------------------------------------------------------------------
var SUPERADMINS_FIXOS = ['alexandrej529@hotmail.com', 'crischavesk123@hotmail.com'];

exports.sincronizarClaimsAdmin = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var authHeader = req.headers.authorization || '';
    var idToken = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
    if (!idToken) {
      res.status(401).json({ error: 'Token de autenticação ausente.' });
      return;
    }

    admin.auth().verifyIdToken(idToken)
      .then(function (decoded) {
        var uid = decoded.uid;
        var email = String(decoded.email || '').toLowerCase();
        if (!email) throw { _status: 400, message: 'Token sem e-mail.' };

        if (SUPERADMINS_FIXOS.indexOf(email) !== -1) {
          return { uid: uid, role: 'superadmin', pages: null };
        }

        return db.collection('lapink').doc('lapinkUsers').get().then(function (snap) {
          var lista = (snap.exists && snap.data() && snap.data().data) || [];
          var match = (Array.isArray(lista) ? lista : []).find(function (u) {
            return u && String(u.email || '').toLowerCase() === email;
          });
          if (match && (match.role === 'admin' || match.role === 'superadmin')) {
            return { uid: uid, role: match.role, pages: Array.isArray(match.pages) ? match.pages : null };
          }
          return { uid: uid, role: null, pages: null };
        });
      })
      .then(function (resultado) {
        var claims = resultado.role ? { role: resultado.role, pages: resultado.pages } : null;
        var permissao = resultado.role === 'admin'
          ? db.collection('adminPermissions').doc(resultado.uid).set({ active: true, pages: resultado.pages, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
          : db.collection('adminPermissions').doc(resultado.uid).delete().catch(function () {});
        return permissao.then(function() { return admin.auth().setCustomUserClaims(resultado.uid, claims); }).then(function () {
          res.status(200).json({ role: resultado.role || null });
        });
      })
      .catch(function (err) {
        var status = (err && err._status) || (err && err.code === 'auth/id-token-expired' ? 401 : 500);
        if (status >= 500) functions.logger.error('sincronizarClaimsAdmin erro', err);
        res.status(status).json({ error: (err && err.message) || 'Erro ao sincronizar permissões.' });
      });
  });
});

// ---------------------------------------------------------------------------
// 6. enviarLinkRedefinicaoSenha — gera o link REAL de redefinição de senha
//    (Admin SDK, não pode ser forjado) e manda por e-mail usando o MESMO
//    EmailJS já configurado para o e-mail de boas-vindas, mas chamado do
//    servidor (com a Private Key) em vez do padrão de envio do próprio
//    Firebase Auth — que sai de um domínio genérico e costuma ser filtrado
//    por provedores como Hotmail/Outlook. O front-end usa esta function
//    como caminho principal e cai no sendPasswordResetEmail do Firebase
//    (comportamento antigo) se esta não estiver configurada ou falhar.
// ---------------------------------------------------------------------------

// Limite simples de 1 pedido por e-mail a cada 2 minutos — evita que a
// function seja usada para inundar a caixa de entrada de alguém.
function _resetRateLimitOk(emailKey) {
  var ref = db.collection('resetLimites').doc(emailKey);
  return ref.get().then(function (snap) {
    var ultimo = snap.exists ? snap.data().at : 0;
    if (Date.now() - ultimo < 2 * 60 * 1000) return false;
    return ref.set({ at: Date.now() }).then(function () { return true; });
  });
}

// Busca a config (pública) do EmailJS de boas-vindas/reset + a Private Key
// (secreta, em apiConfig — só o servidor lê).
function _getEmailjsServerConfig() {
  return Promise.all([
    db.collection('lapink').doc('lapinkEmailConfig').get(),
    db.collection('lapink').doc('apiConfig').get(),
  ]).then(function (snaps) {
    var pub = (snaps[0].exists && snaps[0].data() && snaps[0].data().data) || {};
    var sec = (snaps[1].exists && snaps[1].data() && snaps[1].data().data) || {};
    return {
      pk: pub.emailjsPk,
      sid: pub.emailjsSid,
      resetTid: pub.emailjsResetTid,
      fromName: pub.fromName || 'LaPink',
      privateKey: sec.emailjsPrivateKey,
    };
  });
}

exports.enviarLinkRedefinicaoSenha = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) {
      res.status(400).json({ error: 'E-mail inválido.' });
      return;
    }
    var emailKey = email.replace(/[^a-z0-9]/g, '_');

    _resetRateLimitOk(emailKey)
      .then(function (ok) {
        if (!ok) { res.status(429).json({ error: 'Aguarde alguns minutos antes de pedir de novo.' }); return null; }
        return _getEmailjsServerConfig();
      })
      .then(function (cfg) {
        if (!cfg) return; // rate limit já respondeu
        if (!cfg.pk || !cfg.sid || !cfg.resetTid || !cfg.privateKey) {
          throw { _status: 503, message: 'E-mail de redefinição não configurado no painel.' };
        }

        // Link real de redefinição — só o Admin SDK gera isso, não dá pra forjar.
        return admin.auth().generatePasswordResetLink(email).then(function (link) {
          return fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id: cfg.sid,
              template_id: cfg.resetTid,
              user_id: cfg.pk,
              accessToken: cfg.privateKey,
              template_params: {
                to_email: email,
                reset_link: link,
                from_name: cfg.fromName,
              },
            }),
          });
        });
      })
      .then(function (emailRes) {
        if (!emailRes) return; // já respondido (rate limit) ou sem cfg
        if (!emailRes.ok) {
          return emailRes.text().then(function (t) {
            throw new Error('EmailJS respondeu ' + emailRes.status + ': ' + t);
          });
        }
        res.status(200).json({ ok: true });
      })
      .catch(function (err) {
        // 'auth/user-not-found' não deve revelar se o e-mail existe ou não —
        // responde como sucesso (mesmo comportamento visual do Firebase padrão).
        if (err && err.code === 'auth/user-not-found') {
          res.status(200).json({ ok: true });
          return;
        }
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('enviarLinkRedefinicaoSenha erro', err);
        if (!res.headersSent) res.status(status).json({ error: (err && err.message) || 'Erro ao enviar e-mail.' });
      });
  });
});

// ---------------------------------------------------------------------------
// N. verificarLimiteIP — proteção contra força bruta / criação em massa de
//    contas: limita quantas vezes o MESMO IP pode tentar 'login' ou
//    'registro' num intervalo curto. Ao passar do limite, aquele IP fica
//    bloqueado por 1 hora para essa ação (o cliente chama esta function
//    ANTES de tentar o login/cadastro de verdade no Firebase Auth).
//
//    Isso é uma camada a mais de proteção — feita no navegador (login.js/
//    register.js), então não substitui o rate limit nativo do próprio
//    Firebase Auth (que já existe do lado do Google e não dá pra desligar).
//    Falha aberta: se o Firestore não responder, libera a tentativa em vez
//    de travar um cliente legítimo por causa de erro de infraestrutura.
// ---------------------------------------------------------------------------
// Conta FALHAS, não tentativas. A versão anterior era chamada antes de cada
// login e incrementava sempre — então até login BEM-SUCEDIDO gastava uma das
// 5 vagas, e 5 entradas normais em 15 min já rendiam 1 hora de bloqueio.
//
// O limite também é por IP, e uma rede corporativa inteira sai por um único
// IP público: 5 tentativas para um escritório todo é apertado demais. Com a
// contagem só de falhas, o número pode ser bem mais folgado sem abrir a
// guarda contra força bruta — e quem erra a senha de uma conta específica
// ainda esbarra no limite por e-mail do próprio Firebase Auth.
var RATE_LIMIT_JANELA_MS   = 15 * 60 * 1000; // 15 min
var RATE_LIMIT_MAX_FALHAS  = 15;             // falhas por IP na janela
var RATE_LIMIT_BLOQUEIO_MS = 15 * 60 * 1000; // 15 min de bloqueio

// Versão da política. Documento gravado por uma política antiga é descartado
// na primeira leitura — senão um bloqueio de 1 hora criado pela regra velha
// continuaria valendo depois deste ajuste, prendendo quem já está preso.
var RATE_LIMIT_REGRA_V = 2;

exports.verificarLimiteIP = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var acao = String((req.body && req.body.acao) || '').trim();
    if (acao !== 'login' && acao !== 'registro') {
      res.status(400).json({ error: "Ação inválida (use 'login' ou 'registro')." });
      return;
    }

    // modo:
    //   'checar'   (padrão) → só consulta, NÃO gasta nada
    //   'consumir'          → gasta uma unidade do limite
    //   'limpar'            → zera o contador daquele IP
    //
    // O que "consumir" significa depende da ação, e são coisas diferentes:
    //   login    → consome em FALHA de autenticação (força bruta);
    //   registro → consome em cadastro CONCLUÍDO (criação em massa de contas).
    //
    // Cliente antigo em cache manda só {acao} e cai em 'checar' — sem contar.
    // É temporário, até o cache do navegador atualizar, e falha para o lado
    // seguro (libera) em vez de bloquear alguém legítimo.
    var modo = String((req.body && req.body.modo) || 'checar').trim();
    if (modo === 'falha')   modo = 'consumir'; // nomes da 1ª versão
    if (modo === 'sucesso') modo = 'limpar';
    if (['checar', 'consumir', 'limpar'].indexOf(modo) === -1) modo = 'checar';

    var ip = _ipReal(req);
    var docId = acao + '_' + ip.replace(/[^a-zA-Z0-9.:]/g, '_');
    var ref = db.collection('rateLimites').doc(docId);
    var agora = Date.now();

    // 'limpar' zera o contador, então PRECISA de prova de que a autenticação
    // aconteceu: um token válido do Firebase Auth. Sem essa exigência o
    // endpoint seria um botão público de "reiniciar meu próprio limite", e
    // bastaria chamá-lo após cada senha errada para tentar infinitamente.
    // Sem token válido, a chamada é rebaixada para simples consulta.
    var preparar = Promise.resolve(modo);
    if (modo === 'limpar') {
      var authHeader = req.headers.authorization || '';
      var idToken = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
      preparar = !idToken
        ? Promise.resolve('checar')
        : admin.auth().verifyIdToken(idToken)
            .then(function () { return 'limpar'; })
            .catch(function () { return 'checar'; });
    }

    preparar.then(function (modoFinal) {
    modo = modoFinal;
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var d = (snap.exists ? snap.data() : {}) || {};

        // Bucket gravado por uma política antiga não vale mais: descarta.
        // É isso que solta quem ficou preso 1 hora pela regra anterior.
        if (d.v !== RATE_LIMIT_REGRA_V) d = {};

        // Autenticou de verdade (token do Firebase Auth já conferido antes da
        // transação): limpa o histórico do IP, mesmo que houvesse bloqueio —
        // quem provou a identidade não deve arrastar tentativas anteriores.
        if (modo === 'limpar') {
          tx.set(ref, {
            v: RATE_LIMIT_REGRA_V, falhas: 0, janelaInicio: 0, bloqueadoAte: 0,
            ip: ip, acao: acao, updatedAt: agora
          });
          return { bloqueado: false };
        }

        var bloqueadoAte = d.bloqueadoAte || 0;
        if (bloqueadoAte > agora) {
          return { bloqueado: true, restanteMs: bloqueadoAte - agora };
        }

        // Consulta pura: não grava nada, não gasta tentativa.
        if (modo === 'checar') {
          return { bloqueado: false };
        }

        // modo === 'consumir'
        var dentroDaJanela = (agora - (d.janelaInicio || 0)) < RATE_LIMIT_JANELA_MS;
        var falhas       = dentroDaJanela ? (d.falhas || 0) + 1 : 1;
        var janelaInicio = dentroDaJanela ? d.janelaInicio : agora;
        var novoBloqueio = (falhas > RATE_LIMIT_MAX_FALHAS) ? (agora + RATE_LIMIT_BLOQUEIO_MS) : 0;

        tx.set(ref, {
          v: RATE_LIMIT_REGRA_V,
          falhas: falhas,
          janelaInicio: janelaInicio,
          bloqueadoAte: novoBloqueio,
          ip: ip,
          acao: acao,
          updatedAt: agora
        });

        return novoBloqueio
          ? { bloqueado: true, restanteMs: RATE_LIMIT_BLOQUEIO_MS }
          : { bloqueado: false };
      });
    });
    })
      .then(function (resultado) {
        if (resultado.bloqueado) {
          res.status(429).json({ bloqueado: true, retryAfterMin: Math.max(1, Math.ceil(resultado.restanteMs / 60000)) });
        } else {
          res.status(200).json({ bloqueado: false });
        }
      })
      .catch(function (err) {
        functions.logger.error('verificarLimiteIP erro', err);
        res.status(200).json({ bloqueado: false }); // falha aberta
      });
  });
});

// ---------------------------------------------------------------------------
// O. Analytics leves — visitas ao site e visualizações de produto.
//
// Sem cookies, sem fingerprinting: cada evento é deduplicado no servidor por
// IP + dia (para visita) ou IP + dia + produto (para visualização), usando a
// coleção 'analyticsDedupe'. Isso aproxima "quantas pessoas entraram no
// site" de visitantes únicos por dia, em vez de contar cada page view — e
// evita que um script simples inflando chamadas exploda o contador.
//
// Limitação honesta: uma rede com IP compartilhado (ex.: escritório atrás de
// um único IP público — o mesmo cenário que afetou o limitador de login)
// conta como 1 pessoa por dia, mesmo com várias pessoas diferentes atrás
// dele. Para uma métrica aproximada de painel interno, essa margem de erro
// é aceitável; para uma métrica de precisão, seria necessário Google
// Analytics de verdade (campo já existe em Configurações → Integrações).
//
// Os documentos usam FieldValue.increment (atômico) dentro de um objeto
// aninhado + set(..., {merge:true}) — evita ler-then-escrever (race
// condition) mesmo com várias requisições simultâneas.
//
// Regra do Firestore: 'analytics/*' só é LIDO pelo painel admin (isAdmin());
// a ESCRITA é sempre negada ao cliente — só a Function grava, via Admin SDK.
// 'analyticsDedupe/*' é negado por completo ao cliente (não tem por quê ser
// lido nem escrito fora daqui).
// ---------------------------------------------------------------------------

var ANALYTICS_TTL_DIAS = 35; // usado só se um TTL policy for configurado no console

function _analyticsDedupe(chave) {
  // O IP nunca fica legível no ID. A transação impede duas chamadas
  // simultâneas de contarem o mesmo visitante duas vezes.
  var docId = crypto.createHash('sha256').update(String(chave)).digest('hex');
  var ref = db.collection('analyticsDedupe').doc(docId);
  return db.runTransaction(function(tx) {
    return tx.get(ref).then(function(snap) {
      if (snap.exists) return false;
      var expiresAt = new Date(Date.now() + ANALYTICS_TTL_DIAS * 24 * 60 * 60 * 1000);
      tx.create(ref, { ts: Date.now(), expiresAt: expiresAt });
      return true;
    });
  });
}

exports.registrarVisita = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    var ip = _ipReal(req);
    var hoje = new Date().toISOString().slice(0, 10);
    var dedupeKey = 'visita_' + hoje + '_' + ip.replace(/[^a-zA-Z0-9.:]/g, '_');

    _analyticsDedupe(dedupeKey)
      .then(function (novo) {
        if (!novo) return { contado: false };
        var incremento = {};
        incremento[hoje] = admin.firestore.FieldValue.increment(1);
        return db.collection('analytics').doc('visitas').set({
          total: admin.firestore.FieldValue.increment(1),
          porDia: incremento
        }, { merge: true }).then(function () { return { contado: true }; });
      })
      .then(function (r) { res.status(200).json({ ok: true, contado: r.contado }); })
      .catch(function (err) {
        functions.logger.error('registrarVisita erro', err);
        res.status(200).json({ ok: false }); // nunca deve travar a navegação do visitante
      });
  });
});

exports.registrarVisualizacaoProduto = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    // Produto sempre tem id numérico (Date.now() na criação) — mesma
    // validação usada em outros pontos do sistema para nunca deixar texto
    // livre entrar num nome de campo do Firestore.
    var produtoId = String((req.body && req.body.produtoId) || '').trim();
    if (!/^[0-9]{1,20}$/.test(produtoId)) {
      res.status(400).json({ error: 'produtoId inválido.' });
      return;
    }

    var ip = _ipReal(req);
    var hoje = new Date().toISOString().slice(0, 10);
    var dedupeKey = 'view_' + produtoId + '_' + hoje + '_' + ip.replace(/[^a-zA-Z0-9.:]/g, '_');

    _analyticsDedupe(dedupeKey)
      .then(function (novo) {
        if (!novo) return { contado: false };
        var incremento = {};
        incremento[produtoId] = admin.firestore.FieldValue.increment(1);
        return db.collection('analytics').doc('produtosViews').set({
          total: admin.firestore.FieldValue.increment(1),
          produtos: incremento
        }, { merge: true }).then(function () { return { contado: true }; });
      })
      .then(function (r) { res.status(200).json({ ok: true, contado: r.contado }); })
      .catch(function (err) {
        functions.logger.error('registrarVisualizacaoProduto erro', err);
        res.status(200).json({ ok: false });
      });
  });
});

// ---------------------------------------------------------------------------
// P. Push (Web Push) — inscrição/remoção do navegador do admin e teste.
//    O envio de verdade (_notificarVendaAdmins) é disparado pelo mpWebhook.
//    Todas exigem admin autenticado — a coleção pushSubscriptions guarda só
//    endpoint+chaves públicas de inscrição (não é PII sensível, mas mesmo
//    assim não faz sentido nenhuma escrita vinda de fora de um admin logado).
// ---------------------------------------------------------------------------

exports.salvarInscricaoPush = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    _exigirAdmin(req).then(function (decoded) {
      var sub = req.body && req.body.subscription;
      var endpoint = sub && String(sub.endpoint || '');
      var keys = sub && sub.keys;
      if (!endpoint || !/^https:\/\//.test(endpoint) || !keys || !keys.p256dh || !keys.auth) {
        var eBad = new Error('Inscrição de notificação inválida.');
        eBad._status = 400;
        throw eBad;
      }
      var docId = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
      return db.collection('pushSubscriptions').doc(docId).set({
        email: String(decoded.email || '').toLowerCase(),
        endpoint: endpoint,
        keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
        userAgent: _sanitizarTexto(req.body && req.body.userAgent, 200),
        updatedAt: Date.now()
      }, { merge: true });
    })
      .then(function () { res.status(200).json({ ok: true }); })
      .catch(function (err) {
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('salvarInscricaoPush erro', err);
        res.status(status).json({ error: (err && err.message) || 'Erro interno.' });
      });
  });
});

exports.removerInscricaoPush = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    _exigirAdmin(req).then(function () {
      var endpoint = String((req.body && req.body.endpoint) || '');
      if (!endpoint) return;
      var docId = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
      return db.collection('pushSubscriptions').doc(docId).delete();
    })
      .then(function () { res.status(200).json({ ok: true }); })
      .catch(function (err) {
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('removerInscricaoPush erro', err);
        res.status(status).json({ error: (err && err.message) || 'Erro interno.' });
      });
  });
});

// Manda uma notificação de teste só para os dispositivos do PRÓPRIO admin
// que chamou (nunca para os outros) — para confirmar que a inscrição
// funciona sem precisar esperar uma venda de verdade.
exports.enviarNotificacaoTeste = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido. Use POST.' });
      return;
    }
    _exigirAdmin(req).then(function (decoded) {
      var email = String(decoded.email || '').toLowerCase();
      return _enviarPushTodasInscricoes({
        title: '🔔 Notificação de teste',
        body: 'Se você está vendo isso, as notificações de venda estão funcionando!',
        url: '/admin/admin.html',
        tag: 'teste-' + Date.now()
      }, email);
    })
      .then(function (r) { res.status(200).json(r); })
      .catch(function (err) {
        var status = (err && err._status) || 500;
        if (status >= 500) functions.logger.error('enviarNotificacaoTeste erro', err);
        res.status(status).json({ error: (err && err.message) || 'Erro interno.' });
      });
  });
});
