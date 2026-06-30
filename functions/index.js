'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });

// Valida a assinatura x-signature do webhook do Mercado Pago.
// Retorna true se válida OU se nenhum segredo estiver configurado (modo permissivo
// até o dono cadastrar MP_WEBHOOK_SECRET — evita travar antes da configuração).
function validarAssinaturaMP(req, dataId) {
  var secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    functions.logger.warn('mpWebhook: MP_WEBHOOK_SECRET não configurado — assinatura não verificada.');
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
    const { cliente, endereco, itens, subtotal, frete, total, modalidadeFrete } = body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      res.status(400).json({ error: 'Campo "itens" é obrigatório e deve ser um array não vazio.' });
      return;
    }

    const orderId = gerarOrderId();
    // Valores recalculados no servidor (não confiar no payload do cliente)
    var _itensCalc = [], _subtotalCalc = 0, _freteCalc = 0, _totalCalc = 0;

    Promise.all([getMpToken(), db.collection('lapink').doc('lapinkProdutos').get()])
      .then(function (arr) {
        var token = arr[0];
        var prodSnap = arr[1];
        var prods = (prodSnap.exists && prodSnap.data() && prodSnap.data().data) || [];
        var mapa = {};
        (Array.isArray(prods) ? prods : []).forEach(function (p) { if (p && typeof p.id !== 'undefined') mapa[String(p.id)] = p; });

        function precoDe(p) { var a = Number(p.precoAtacado) || 0, v = Number(p.precoVarejo) || 0; return a > 0 ? a : v; }

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
          _subtotalCalc += preco * qty;
          _itensCalc.push({ id: p.id, nome: p.nome, qty: qty, preco: preco });
          mpItems.push({ id: String(p.id), title: String(p.nome || 'Produto'), quantity: qty, unit_price: preco, currency_id: 'BRL' });
        });

        // Frete: aceita só número não-negativo do cliente (tabela depende da config)
        _freteCalc = Math.max(0, Number(frete) || 0);
        _totalCalc = _subtotalCalc + _freteCalc;
        if (_freteCalc > 0) {
          mpItems.push({ id: 'FRETE', title: 'Frete', quantity: 1, unit_price: _freteCalc, currency_id: 'BRL' });
        }

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
            success: 'https://lapink-82a39.web.app/public/sucesso.html?pedido=' + orderId,
            failure: 'https://lapink-82a39.web.app/public/pagamento.html?erro=pagamento',
            pending: 'https://lapink-82a39.web.app/public/sucesso.html?pedido=' + orderId + '&pendente=1',
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

  // Valida a assinatura do Mercado Pago (se MP_WEBHOOK_SECRET estiver configurado)
  var dataIdAssinatura = (req.query && req.query['data.id']) || bodyDataId || paymentId;
  if (!validarAssinaturaMP(req, dataIdAssinatura)) {
    functions.logger.warn('mpWebhook: assinatura inválida — notificação descartada.', { paymentId });
    return;
  }

  functions.logger.info('mpWebhook: processando payment_id=' + paymentId);

  getMpToken()
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
  return db
    .collection('lapink')
    .doc('lapinkProdutos')
    .get()
    .then(function (snap) {
      if (!snap.exists) {
        functions.logger.warn('decrementarEstoque: documento lapinkProdutos não encontrado');
        return;
      }

      var docData = snap.data() || {};
      var prods = docData.data;

      if (!Array.isArray(prods)) {
        functions.logger.warn('decrementarEstoque: campo data não é array');
        return;
      }

      itensPedido.forEach(function (itemPedido) {
        var prod = prods.find(function (p) {
          return String(p.id) === String(itemPedido.id);
        });
        if (prod && typeof prod.estoque === 'number') {
          prod.estoque = Math.max(0, prod.estoque - (Number(itemPedido.qty) || 1));
        }
      });

      return db
        .collection('lapink')
        .doc('lapinkProdutos')
        .set({ data: prods, updatedAt: Date.now() }, { merge: true })
        .then(function () {
          functions.logger.info('decrementarEstoque: estoque atualizado para ' + itensPedido.length + ' item(s)');
        });
    });
}

// ---------------------------------------------------------------------------
// 3. cobrarAbandonados — envia WhatsApp para carrinhos abandonados (Cloud API)
//    Requer: plano Blaze + WhatsApp Business Cloud API.
//    Config: process.env.WHATSAPP_TOKEN (token) e lapink/apiConfig.data.wbaPhoneId
//    Acione manualmente (HTTP) ou via Cloud Scheduler. Janela: > 30 min abertos.
// ---------------------------------------------------------------------------
exports.cobrarAbandonados = functions.https.onRequest(function (req, res) {
  cors(req, res, function () {
    db.collection('lapink').doc('apiConfig').get()
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
                  'Posso te ajudar a finalizar a compra? https://lapink-82a39.web.app/public/V1.html';
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
      })
      .then(function (r) { res.status(200).json(r); })
      .catch(function (err) {
        functions.logger.error('cobrarAbandonados erro', err);
        res.status(500).json({ error: err.message });
      });
  });
});
