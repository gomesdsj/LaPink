// Cloud Sync — sincroniza lapinkClients / lapinkProdutos / lapinkPedidos / lapinkConfig
// com o Firestore sem precisar alterar o código existente.
//
// Estratégia: write-through cache
//   • Na carga da página: Firestore → localStorage
//   • Em todo localStorage.setItem para chaves lapink: também grava no Firestore

(function () {
  var SYNC_KEYS = ['lapinkClients', 'lapinkProdutos', 'lapinkPedidos', 'lapinkConfig', 'lapinkLojaConfig', 'lapinkUsers'];

  // ── Firestore helpers ─────────────────────────────────────────
  function db() {
    return typeof firebase !== 'undefined' && firebase.apps.length
      ? firebase.firestore()
      : null;
  }

  function collectionName(key) {
    return key.replace('lapink', '').toLowerCase(); // lapinkClients → clients
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
      writeToFirestore(key, value);
    }
  };

  // ── Carga inicial: Firestore → localStorage ───────────────────
  function syncFromCloud() {
    var firestore = db();
    if (!firestore) return;

    SYNC_KEYS.forEach(function (key) {
      firestore.collection('lapink').doc(key).get().then(function (snap) {
        if (!snap.exists) return;
        var remote = snap.data();
        if (!remote || !remote.data) return;

        // Mescla: prefere dados remotos mais recentes
        var localRaw = localStorage.getItem(key);
        var localUpdated = 0;
        try { localUpdated = JSON.parse(localStorage.getItem(key + '_ts') || '0'); } catch(e) {}

        if (!localRaw || remote.updatedAt > localUpdated) {
          _orig.call(localStorage, key, JSON.stringify(remote.data));
          _orig.call(localStorage, key + '_ts', String(remote.updatedAt));
          console.log('[sync] ' + key + ' ← Firestore (' + (Array.isArray(remote.data) ? remote.data.length + ' itens' : 'ok') + ')');
        }
      }).catch(function (e) { console.warn('[sync] read error ' + key, e); });
    });
  }

  // Inicia sincronização quando Firebase estiver pronto
  function waitAndSync() {
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
      syncFromCloud();
    } else {
      // Firebase ainda carregando — tenta de novo em 300ms
      setTimeout(waitAndSync, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndSync);
  } else {
    waitAndSync();
  }

  // Expõe para uso manual (ex: forçar sync após criar pedido)
  window.LaPinkSync = { push: writeToFirestore, pull: syncFromCloud };
})();
