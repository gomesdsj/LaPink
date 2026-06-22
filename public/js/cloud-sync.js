// Cloud Sync — sincroniza lapinkClients / lapinkProdutos / lapinkPedidos / lapinkConfig
// com o Firestore sem precisar alterar o código existente.
//
// Estratégia: write-through cache
//   • Na carga da página: Firestore → localStorage (só se remoto for mais recente)
//   • Em todo localStorage.setItem para chaves lapink: grava _ts + Firestore
//
// NOTA: lapinkUsers NÃO está em SYNC_KEYS — o seed _seedSuperAdmins() roda a cada
// carga de página admin e sobrescreveria o Firestore, apagando admins extras.

(function () {
  var SYNC_KEYS = ['lapinkClients', 'lapinkProdutos', 'lapinkPedidos', 'lapinkConfig', 'lapinkLojaConfig', 'lapinkCarrossel', 'lapinkStoreConfig', 'lapinkNotifConfig', 'lapinkApiConfig', 'lapinkPaymentConfig', 'lapinkEntregaConfig', 'lapinkPedidoCounter'];
  var MAX_RETRIES = 20; // 20 × 300ms = 6s máximo de espera pelo Firebase

  // ── Firestore helpers ─────────────────────────────────────────
  function db() {
    return typeof firebase !== 'undefined' && firebase.apps.length
      ? firebase.firestore()
      : null;
  }

  // Grava array/objeto inteiro como documento único em /lapink/{key}
  function writeToFirestore(key, value) {
    var firestore = db();
    if (!firestore) return;
    try {
      var data = typeof value === 'string' ? JSON.parse(value) : value;
      firestore.collection('lapink').doc(key).set({ data: data, updatedAt: Date.now() })
        .catch(function (e) { console.warn('[sync] write error:', e); });
    } catch (e) { console.warn('[sync] parse error:', e); }
  }

  // ── Intercepta localStorage.setItem ──────────────────────────
  var _orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    _orig.call(this, key, value);
    if (this === localStorage && SYNC_KEYS.indexOf(key) !== -1) {
      // Grava timestamp local para que o Firestore não sobrescreva na próxima carga
      _orig.call(localStorage, key + '_ts', String(Date.now()));
      writeToFirestore(key, value);
    }
  };

  // ── Carga inicial: Firestore → localStorage ───────────────────
  function syncFromCloud(onKeySync) {
    var firestore = db();
    if (!firestore) return;

    SYNC_KEYS.forEach(function (key) {
      firestore.collection('lapink').doc(key).get().then(function (snap) {
        if (!snap.exists) return;
        var remote = snap.data();
        if (!remote || !remote.data) return;

        var localRaw = localStorage.getItem(key);
        var localUpdated = 0;
        try { localUpdated = JSON.parse(localStorage.getItem(key + '_ts') || '0'); } catch(e) {}

        if (!localRaw || remote.updatedAt > localUpdated) {
          _orig.call(localStorage, key, JSON.stringify(remote.data));
          _orig.call(localStorage, key + '_ts', String(remote.updatedAt));
          console.log('[sync] ' + key + ' ← Firestore (' + (Array.isArray(remote.data) ? remote.data.length + ' itens' : 'ok') + ')');
          if (typeof onKeySync === 'function') onKeySync(key, remote.data);
        }
      }).catch(function (e) { console.warn('[sync] read error ' + key, e); });
    });
  }

  // Inicia sincronização quando Firebase estiver pronto (máx MAX_RETRIES tentativas)
  function waitAndSync(retries) {
    retries = retries || 0;
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
      syncFromCloud();
    } else if (retries < MAX_RETRIES) {
      setTimeout(function () { waitAndSync(retries + 1); }, 300);
    } else {
      console.warn('[sync] Firebase não carregou após ' + (MAX_RETRIES * 300 / 1000) + 's. Sync cancelado.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { waitAndSync(0); });
  } else {
    waitAndSync(0);
  }

  // Expõe para uso manual e para callbacks pós-sync em páginas específicas
  window.LaPinkSync = { push: writeToFirestore, pull: syncFromCloud };
})();
