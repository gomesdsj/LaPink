'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });

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
    var manifest = 'id:' + dataId + ';request-id:' + reqId + ';ts:' + ts + ';';
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
function baseUrlDe(req) {
  const origem = (req.headers && req.headers.origin) || '';
  return ORIGENS_PERMITIDAS.indexOf(origem) >= 0 ? origem : 'https://www.lapinkacessorios.com.br';
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

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      res.status(400).json({ error: 'Campo "itens" é obrigatório e deve ser um array não vazio.' });
      return;
    }

    const orderId = gerarOrderId();
    // Valores recalculados no servidor (não confiar no payload do cliente)
    var _itensCalc = [], _subtotalCalc = 0, _freteCalc = 0, _totalCalc = 0;
    var _descontoInfo = { pct: 0, valor: 0 };

    Promise.all([
      getMpToken(),
      lerCatalogo(), // suporta catálogo particionado (fotos > 1 MiB)
      db.collection('lapink').doc('lapinkLojaConfig').get() // desconto boas-vindas
    ])
      .then(function (arr) {
        var token = arr[0];
        var prods = arr[1].prods;
        var lojaCfg = (arr[2].exists && arr[2].data() && arr[2].data().data) || {};
        var mapa = {};
        (Array.isArray(prods) ? prods : []).forEach(function (p) { if (p && typeof p.id !== 'undefined') mapa[String(p.id)] = p; });

        function precoDe(p) { var a = Number(p.precoAtacado) || 0, v = Number(p.precoVarejo) || 0; return a > 0 ? a : v; }

        // Desconto de boas-vindas: valida contra a config da loja (nunca
        // confia no % vindo do cliente — usa o MENOR entre pedido e config)
        var descCfg = lojaCfg.descontoBoasVindas || {};
        var descontoPct = 0;
        if (descCfg.ativo && Number(descCfg.percentual) > 0 && Number(body.descontoPct) > 0) {
          descontoPct = Math.min(Number(body.descontoPct), Number(descCfg.percentual), 90);
        }
        var fatorDesc = 1 - descontoPct / 100;

        // Recalcula preços e valida estoque a partir do catálogo no servidor
        const mpItems = [];
        itens.forEach(function (item) {
          var p = mapa[String(item.id)];
          if (!p) throw new Error('Produto inválido no carrinho: ' + (item.nome || item.id));
          var estoque = (typeof p.estoque !== 'undefined') ? (parseInt(p.estoque) || 0) : null;
          var qty = Math.max(1, Number(item.qty) || 1);
          if (estoque !== null) {
            if (estoque <= 0) throw new Error('Produto esgotado: ' + (p.nome || item.id));
            if (qty > estoque) qty = estoque; // limita ao estoque disponível
          }
          var preco = precoDe(p);
          // Preço cobrado no MP já com o desconto aplicado (proporcional por item)
          var precoCobrado = Math.round(preco * fatorDesc * 100) / 100;
          _subtotalCalc += preco * qty;
          _itensCalc.push({ id: p.id, nome: p.nome, qty: qty, preco: preco });
          mpItems.push({ id: String(p.id), title: String(p.nome || 'Produto'), quantity: qty, unit_price: precoCobrado, currency_id: 'BRL' });
        });

        _subtotalCalc = Math.round(_subtotalCalc * 100) / 100;
        var _descontoCalc = Math.round(mpItems.reduce(function (s, it) {
          return s + it.unit_price * it.quantity;
        }, 0) * 100) / 100;
        _descontoCalc = Math.round((_subtotalCalc - _descontoCalc) * 100) / 100; // valor do desconto

        // Frete: aceita só número não-negativo do cliente (tabela depende da config)
        _freteCalc = Math.max(0, Number(frete) || 0);
        _totalCalc = Math.round((_subtotalCalc - _descontoCalc + _freteCalc) * 100) / 100;
        if (_freteCalc > 0) {
          mpItems.push({ id: 'FRETE', title: 'Frete', quantity: 1, unit_price: _freteCalc, currency_id: 'BRL' });
        }
        _descontoInfo = { pct: descontoPct, valor: _descontoCalc };

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
            success: baseUrlDe(req) + '/public/sucesso.html?pedido=' + orderId,
            failure: baseUrlDe(req) + '/public/pagamento.html?erro=pagamento',
            pending: baseUrlDe(req) + '/public/sucesso.html?pedido=' + orderId + '&pendente=1',
          },
          auto_return: 'approved',
          notification_url: 'https://us-central1-lapink-82a39.cloudfunctions.net/mpWebhook',
          external_reference: orderId,
          statement_descriptor: 'LAPINK',
        };

        return fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify(preference),
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
          status: 'aguardando_pagamento',
          mp_preference_id: mpData.id || null,
          mp_payment_id: null,
          mp_status: null,
          cliente: cliente || {},
          endereco: endereco || {},
          itens: _itensCalc,            // itens validados no servidor
          subtotal: _subtotalCalc,      // recalculado no servidor
          desconto: _descontoInfo.valor,       // desconto boas-vindas (R$)
          descontoPct: _descontoInfo.pct,      // desconto boas-vindas (%)
          frete: _freteCalc,
          total: _totalCalc,            // recalculado no servidor
          modalidadeFrete: modalidadeFrete || '',
          pagamento: 'mercadopago',
          rastreio: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        return db
          .collection('pedidos')
          .doc(orderId)
          .set(pedido)
          .then(function () {
            return mpData;
          });
      })
      .then(function (mpData) {
        functions.logger.info('Pedido criado com sucesso', { orderId, mp_id: mpData.id });
        res.status(200).json({
          preference_id: mpData.id,
          init_point: mpData.init_point,
          sandbox_init_point: mpData.sandbox_init_point,
          pedido_id: orderId,
        });
      })
      .catch(function (err) {
        functions.logger.error('createPreference erro', err);
        res.status(500).json({ error: err.message || 'Erro interno ao processar preferência.' });
      });
  });
});

// ---------------------------------------------------------------------------
// 2. mpWebhook — recebe notificações do Mercado Pago
// ---------------------------------------------------------------------------
exports.mpWebhook = functions.https.onRequest(function (req, res) {
  // Responde 200 imediatamente para o MP não retentar
  res.status(200).send('OK');

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
    return;
  }

  // Valida a assinatura do Mercado Pago (se a chave estiver configurada —
  // env var ou Firestore, ver getMpWebhookSecret)
  var dataIdAssinatura = (req.query && req.query['data.id']) || bodyDataId || paymentId;

  getMpWebhookSecret()
    .then(function (secret) {
      if (!validarAssinaturaMP(req, dataIdAssinatura, secret)) {
        functions.logger.warn('mpWebhook: assinatura inválida — notificação descartada.', { paymentId });
        return null;
      }

      functions.logger.info('mpWebhook: processando payment_id=' + paymentId);
      return getMpToken();
    })
    .then(function (token) {
      if (!token) return null; // assinatura inválida — encerra sem processar

      return fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
        },
      });
    })
    .then(function (mpRes) {
      if (!mpRes) return null; // assinatura inválida — encerra sem processar
      return mpRes.json().then(function (data) {
        if (!mpRes.ok) {
          throw new Error('Erro ao buscar pagamento MP: ' + JSON.stringify(data));
        }
        return data;
      });
    })
    .then(function (payment) {
      if (!payment) return null; // assinatura inválida — encerra sem processar
      var mpStatus = payment.status;
      var externalRef = payment.external_reference;
      var novoStatus = mapearStatus(mpStatus);

      if (!externalRef) {
        functions.logger.warn('mpWebhook: pagamento sem external_reference', { paymentId });
        return;
      }

      var orderRef = db.collection('pedidos').doc(externalRef);

      return orderRef.get().then(function (snap) {
        var statusAnterior = snap.exists ? snap.data().status : null;

        return orderRef
          .update({
            status: novoStatus,
            mp_payment_id: paymentId,
            mp_status: mpStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .then(function () {
            functions.logger.info('mpWebhook: pedido atualizado', {
              orderId: externalRef,
              novoStatus,
              mpStatus,
            });

            // Decrementa estoque apenas quando muda para 'pago' pela primeira vez
            // E somente se ainda NÃO foi baixado (campo estoqueBaixado evita baixa dupla).
            // Após baixar, marca estoqueBaixado:true no próprio pedido (idempotência).
            var jaBaixado = snap.exists && snap.data().estoqueBaixado === true;
            if (novoStatus === 'pago' && statusAnterior !== 'pago' && !jaBaixado && snap.exists) {
              return decrementarEstoque(snap.data().itens || []).then(function () {
                return orderRef.update({ estoqueBaixado: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
              });
            }
            return Promise.resolve();
          });
      });
    })
    .catch(function (err) {
      functions.logger.error('mpWebhook erro ao processar payment_id=' + paymentId, err);
    });
});

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
    if (SUPERADMINS_FIXOS.indexOf(email) !== -1) return decoded;
    return db.collection('lapink').doc('lapinkUsers').get().then(function (snap) {
      var lista = (snap.exists && snap.data() && snap.data().data) || [];
      var match = (Array.isArray(lista) ? lista : []).find(function (u) {
        return u && String(u.email || '').toLowerCase() === email;
      });
      if (match && (match.role === 'admin' || match.role === 'superadmin')) return decoded;
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

// ---------------------------------------------------------------------------
// 3. cobrarAbandonados — envia WhatsApp para carrinhos abandonados (Cloud API)
//    Requer: plano Blaze + WhatsApp Business Cloud API + admin autenticado
//    (Bearer <ID token>) — antes qualquer um que soubesse a URL conseguia
//    disparar mensagens reais de WhatsApp pros clientes, sem nenhum controle.
//    Config: process.env.WHATSAPP_TOKEN (token) e lapink/apiConfig.data.wbaPhoneId
//    Acione pelo painel (ou Cloud Scheduler usando uma conta de serviço admin).
//    Janela: > 30 min abertos.
// ---------------------------------------------------------------------------
exports.cobrarAbandonados = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    _exigirAdmin(req).then(function () {
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
          return todas;
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
        return admin.auth().setCustomUserClaims(resultado.uid, claims).then(function () {
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

    // req.ip já vem correto atrás do proxy confiável do Cloud Functions/Cloud
    // Run — é a única fonte confiável aqui. X-Forwarded-For é enviado pelo
    // próprio cliente (quem chama a function decide o valor) e NÃO deve ter
    // prioridade nem ser usado: bastaria mandar um valor diferente a cada
    // requisição pra reiniciar o bucket de rate limit e burlar o bloqueio.
    var ip = (req.ip || 'desconhecido').toString().trim();
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
