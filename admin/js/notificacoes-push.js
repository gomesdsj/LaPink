/* LaPink — Notificações push de venda (Web Push, sem aplicativo)
 *
 * Assim que um pedido é confirmado como pago (mpWebhook, no servidor), a
 * Cloud Function _notificarVendaAdmins manda um Web Push para todo
 * navegador inscrito — aparece como notificação nativa do sistema, mesmo
 * com o painel em segundo plano (Android/Chrome). Aqui é só a parte de
 * INSCREVER o navegador: pedir permissão, registrar no PushManager e
 * avisar o servidor pra guardar o destino.
 *
 * Chave pública VAPID — não é segredo (é feita pra ir no navegador, igual
 * à apiKey do Firebase). A privada correspondente mora só em
 * functions/.env. Se um dia trocar, troca as duas juntas.
 */
var LAPINK_VAPID_PUBLIC_KEY = 'BHu8yyPjGlm63kvuG5c_ikE-X6IHBE03fMBECn4LLA1nhNESKkCYsw0KPJrD1XS-kbz7083woHyYh0mwiwjf94k';

var LaPinkPush = (function () {
  var FUNC_BASE = 'https://us-central1-lapink-82a39.cloudfunctions.net';

  function suportado() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function _idToken() {
    return aguardarFirebaseAuth().then(function () {
      var user = firebase.auth().currentUser;
      if (!user) throw new Error('Sessão de admin não encontrada — saia e entre novamente.');
      return user.getIdToken();
    });
  }

  function _chamar(endpoint, body) {
    return _idToken().then(function (token) {
      return fetch(FUNC_BASE + '/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body || {})
      }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data && data.error || ('Erro HTTP ' + r.status));
          return data;
        });
      });
    });
  }

  function _registration() {
    return navigator.serviceWorker.ready;
  }

  // Estado atual: suporte do navegador, permissão do SO, e se já existe
  // inscrição ativa neste navegador especificamente.
  function status() {
    if (!suportado()) return Promise.resolve({ suportado: false, permissao: 'unsupported', inscrito: false });
    return _registration().then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        return { suportado: true, permissao: Notification.permission, inscrito: !!sub };
      });
    }).catch(function () {
      return { suportado: true, permissao: Notification.permission, inscrito: false };
    });
  }

  // Pede permissão (se preciso), inscreve no PushManager e avisa o servidor.
  function ativar() {
    if (!suportado()) return Promise.reject(new Error('Este navegador não suporta notificações push.'));

    return Notification.requestPermission().then(function (permissao) {
      if (permissao !== 'granted') {
        throw new Error(permissao === 'denied'
          ? 'Notificações bloqueadas nas configurações do navegador. Para ativar, permita notificações para este site.'
          : 'Permissão de notificação não concedida.');
      }
      return _registration();
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) return sub;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(LAPINK_VAPID_PUBLIC_KEY)
        });
      });
    }).then(function (sub) {
      return _chamar('salvarInscricaoPush', {
        subscription: sub.toJSON(),
        userAgent: navigator.userAgent
      }).then(function () { return sub; });
    });
  }

  function desativar() {
    return _registration().then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return _chamar('removerInscricaoPush', { endpoint: endpoint }).catch(function () {});
      });
    });
  }

  function testar() {
    return _chamar('enviarNotificacaoTeste', {});
  }

  return { suportado: suportado, status: status, ativar: ativar, desativar: desativar, testar: testar };
})();

/* ── Banner leve, injetado sozinho, convidando a ativar ──────────────────
   Só aparece se: suportado + permissão ainda não decidida/negada + ainda
   não inscrito + não dispensado nesta aba. "Dispensar" esconde só pro
   resto desta sessão do navegador — volta a aparecer depois, sem precisar
   editar nada, mas sem insistir a cada clique dentro da mesma visita. */
(function _bannerPush() {
  if (typeof aguardarFirebaseAuth !== 'function') return; // página sem auth.js carregado

  function jaDispensado() {
    try { return sessionStorage.getItem('lapinkPushBannerOculto') === '1'; } catch (e) { return false; }
  }
  function dispensar() {
    try { sessionStorage.setItem('lapinkPushBannerOculto', '1'); } catch (e) {}
    var el = document.getElementById('lapink-push-banner');
    if (el) el.remove();
  }

  function montarBanner() {
    if (document.getElementById('lapink-push-banner') || jaDispensado()) return;

    var el = document.createElement('div');
    el.id = 'lapink-push-banner';
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;max-width:420px;margin:0 auto;' +
      'background:#fff;border:1px solid var(--pink-200,#f3c6d5);border-radius:14px;' +
      'box-shadow:0 12px 32px rgba(0,0,0,.16);padding:16px 18px;z-index:5000;' +
      'font-family:inherit;display:flex;gap:12px;align-items:flex-start;';
    el.innerHTML =
      '<i class="ti ti-bell-ringing" style="font-size:22px;color:var(--pink-500,#d4537e);flex-shrink:0;margin-top:1px;"></i>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13.5px;font-weight:700;color:var(--gray-800,#2c2a28);margin-bottom:3px;">Avisar quando uma venda entrar?</div>' +
        '<div style="font-size:12px;color:var(--gray-500,#6b7280);line-height:1.5;margin-bottom:10px;">Ativa uma notificação neste navegador sempre que um pedido for pago — sem precisar instalar nada.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="button" id="lapink-push-ativar" style="background:var(--pink-500,#d4537e);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:700;cursor:pointer;">Ativar</button>' +
          '<button type="button" id="lapink-push-depois" style="background:none;border:none;color:var(--gray-400,#9ca3af);font-size:12.5px;cursor:pointer;padding:8px 4px;">Agora não</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('lapink-push-depois').addEventListener('click', dispensar);
    document.getElementById('lapink-push-ativar').addEventListener('click', function () {
      var btn = document.getElementById('lapink-push-ativar');
      btn.disabled = true;
      btn.textContent = 'Ativando…';
      LaPinkPush.ativar().then(function () {
        el.innerHTML = '<i class="ti ti-check" style="font-size:20px;color:#16a34a;"></i>' +
          '<div style="font-size:13px;font-weight:700;color:var(--gray-800,#2c2a28);">Notificações ativadas! Você vai ser avisado por aqui a cada venda.</div>';
        setTimeout(function () { el.remove(); }, 3500);
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Ativar';
        if (typeof showToast === 'function') showToast(err && err.message || 'Não foi possível ativar.', 'erro');
      });
    });
  }

  aguardarFirebaseAuth().then(function () {
    if (!getSession || !getSession()) return;
    return LaPinkPush.status();
  }).then(function (st) {
    if (!st || !st.suportado) return;
    if (st.inscrito || st.permissao === 'denied') return;
    montarBanner();
  }).catch(function () {});
})();

/* ── Painel de gerenciamento (Configurações → Integrações) ───────────────
   Só faz algo se a página tiver #push-status-linha/#push-acoes no HTML
   (hoje só admin/configuracoes.html) — nas demais páginas este bloco não
   encontra os elementos e não faz nada. */
(function _painelGerenciamentoPush() {
  var linha = document.getElementById('push-status-linha');
  var acoes = document.getElementById('push-acoes');
  if (!linha || !acoes) return;

  function render(st) {
    if (!st.suportado) {
      linha.innerHTML = '<i class="ti ti-alert-triangle" style="color:var(--amber-500,#d97706);"></i> Este navegador não suporta notificações push.';
      acoes.innerHTML = '';
      return;
    }
    if (st.permissao === 'denied') {
      linha.innerHTML = '<i class="ti ti-bell-off" style="color:var(--red-400,#e05555);"></i> Bloqueadas nas configurações do navegador — para ativar, permita notificações para este site manualmente.';
      acoes.innerHTML = '';
      return;
    }
    if (st.inscrito) {
      linha.innerHTML = '<i class="ti ti-circle-check" style="color:#16a34a;"></i> Ativadas neste navegador.';
      acoes.innerHTML =
        '<button class="btn-secondary" type="button" id="push-btn-testar"><i class="ti ti-send"></i> Enviar notificação de teste</button>' +
        '<button class="btn-secondary" type="button" id="push-btn-desativar" style="color:var(--red-400,#e05555);"><i class="ti ti-bell-off"></i> Desativar</button>';
      document.getElementById('push-btn-testar').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        LaPinkPush.testar().then(function (r) {
          showToast(r && r.enviados ? 'Notificação de teste enviada!' : 'Nenhum dispositivo inscrito recebeu — tente reativar.', r && r.enviados ? undefined : 'erro');
        }).catch(function (e) {
          showToast(e && e.message || 'Falha ao enviar teste.', 'erro');
        }).finally(function () { btn.disabled = false; });
      });
      document.getElementById('push-btn-desativar').addEventListener('click', function () {
        LaPinkPush.desativar().then(function () { atualizar(); showToast('Notificações desativadas neste navegador.'); });
      });
      return;
    }
    linha.innerHTML = '<i class="ti ti-bell" style="color:var(--gray-400,#9ca3af);"></i> Desativadas neste navegador.';
    acoes.innerHTML = '<button class="btn-save-form" type="button" id="push-btn-ativar"><i class="ti ti-bell-ringing"></i> Ativar notificações</button>';
    document.getElementById('push-btn-ativar').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      LaPinkPush.ativar().then(function () { atualizar(); showToast('Notificações ativadas!'); })
        .catch(function (e) { showToast(e && e.message || 'Não foi possível ativar.', 'erro'); })
        .finally(function () { btn.disabled = false; });
    });
  }

  function atualizar() { LaPinkPush.status().then(render); }

  if (typeof aguardarFirebaseAuth === 'function') {
    aguardarFirebaseAuth().then(atualizar);
  } else {
    atualizar();
  }
})();
