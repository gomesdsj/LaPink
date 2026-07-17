// Cloud Sync — sincroniza lapinkClients / lapinkProdutos / lapinkPedidos / lapinkConfig
// com o Firestore sem precisar alterar o código existente.
//
// Estratégia: write-through cache
//   • Na carga da página: Firestore → localStorage (só se remoto for mais recente)
//   • Em todo localStorage.setItem para chaves lapink: grava _ts + Firestore
//
// NOTA: lapinkUsers NÃO está em SYNC_KEYS — o seed _seedSuperAdmins() roda a cada
// carga de página admin e sobrescreveria o Firestore, apagando admins extras.
//
// SEGURANÇA: lapinkClients (PII + hashes de senha) e lapinkApiConfig (chaves
// EmailJS/MP) foram REMOVIDOS do sync — não devem trafegar para um Firestore de
// leitura pública. As regras do Firestore negam esses documentos. Contas de
// cliente passam a ser locais ao dispositivo até a migração para Firebase Auth.

(function () {
  var SYNC_KEYS = ['lapinkProdutos', 'lapinkPedidos', 'lapinkConfig', 'lapinkLojaConfig', 'lapinkCarrossel', 'lapinkStoreConfig', 'lapinkNotifConfig', 'lapinkPaymentConfig', 'lapinkEntregaConfig', 'lapinkPedidoCounter', 'lapinkCategorias', 'lapinkBeneficios', 'lapinkEmailConfig'];
  var MAX_RETRIES = 20; // 20 × 300ms = 6s máximo de espera pelo Firebase

  // ── Firestore helpers ─────────────────────────────────────────
  function db() {
    return typeof firebase !== 'undefined' && firebase.apps.length
      ? firebase.firestore()
      : null;
  }

  // Firestore limita cada documento a ~1 MiB. Catálogos com fotos (base64)
  // passam disso fácil — então arrays grandes são divididos em partes
  // (lapinkProdutos_0, _1, …) e o doc principal vira um índice {chunked, chunks}.
  var CHUNK_LIMIT = 850 * 1024; // margem de segurança sob o limite de 1 MiB

  function _erroEscrita(key) {
    return function (e) {
      console.error('[sync] ERRO ao enviar ' + key + ' para a nuvem — os dados ficaram SÓ neste dispositivo:', e && e.message);
      try {
        if (typeof showToast === 'function') showToast('Falha ao sincronizar com a nuvem (' + key + '). Tente novamente.', 'erro');
      } catch (_) {}
    };
  }

  // Grava em /lapink/{key}; se o array for grande, divide em partes < 1 MiB
  function writeToFirestore(key, value) {
    var firestore = db();
    if (!firestore) return;
    try {
      var data = typeof value === 'string' ? JSON.parse(value) : value;
      var tamanho = JSON.stringify(data).length;
      var agora = Date.now();

      if (!Array.isArray(data) || tamanho <= CHUNK_LIMIT) {
        firestore.collection('lapink').doc(key).set({ data: data, updatedAt: agora })
          .catch(_erroEscrita(key));
        return;
      }

      // Divide o array em partes respeitando o limite por documento
      var partes = [];
      var atual = [], atualLen = 2;
      data.forEach(function (item) {
        var s = JSON.stringify(item).length + 1;
        if (atual.length && atualLen + s > CHUNK_LIMIT) { partes.push(atual); atual = []; atualLen = 2; }
        atual.push(item); atualLen += s;
      });
      if (atual.length) partes.push(atual);

      // Grava as partes primeiro; o doc principal (índice) por último —
      // leitores só usam o índice novo depois que as partes existem
      Promise.all(partes.map(function (arr, i) {
        return firestore.collection('lapink').doc(key + '_' + i).set({ data: arr, updatedAt: agora });
      })).then(function () {
        return firestore.collection('lapink').doc(key).set({ chunked: true, chunks: partes.length, updatedAt: agora });
      }).then(function () {
        console.log('[sync] ' + key + ' → Firestore em ' + partes.length + ' partes (' + Math.round(tamanho / 1024) + ' KB)');
      }).catch(_erroEscrita(key));
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

  // Pull completo no máximo a cada 60s por aba — trocar de página dentro do
  // painel usa o localStorage direto (instantâneo) em vez de reler 11 docs
  // do Firestore a cada navegação. Gravações continuam subindo na hora.
  var SYNC_MIN_INTERVAL_MS = 60 * 1000;

  // ── Carga inicial: Firestore → localStorage ───────────────────
  function syncFromCloud(onKeySync, force) {
    var firestore = db();
    if (!firestore) return;

    if (!force) {
      try {
        var last = Number(sessionStorage.getItem('lapinkSyncAt') || 0);
        if (Date.now() - last < SYNC_MIN_INTERVAL_MS) return;
        sessionStorage.setItem('lapinkSyncAt', String(Date.now()));
      } catch (e) {}
    }

    SYNC_KEYS.forEach(function (key) {
      firestore.collection('lapink').doc(key).get().then(function (snap) {
        if (!snap.exists) return;
        var remote = snap.data();
        if (!remote) return;

        var localRaw = localStorage.getItem(key);
        var localUpdated = 0;
        try { localUpdated = JSON.parse(localStorage.getItem(key + '_ts') || '0'); } catch(e) {}

        // Auto-recuperação: se o local é MAIS NOVO que a nuvem, reenvia —
        // resgata dados que ficaram presos no dispositivo por falha de envio
        // (ex.: catálogo com fotos que estourava o limite de 1 MiB por doc)
        if (localRaw && localUpdated > (remote.updatedAt || 0)) {
          console.log('[sync] ' + key + ' local mais novo que a nuvem — reenviando');
          writeToFirestore(key, localRaw);
          return;
        }

        function aplicar(dataRemota) {
          if (!localRaw || remote.updatedAt > localUpdated) {
            _orig.call(localStorage, key, JSON.stringify(dataRemota));
            _orig.call(localStorage, key + '_ts', String(remote.updatedAt));
            console.log('[sync] ' + key + ' ← Firestore (' + (Array.isArray(dataRemota) ? dataRemota.length + ' itens' : 'ok') + ')');
            if (typeof onKeySync === 'function') onKeySync(key, dataRemota);
          }
        }

        if (remote.chunked && remote.chunks > 0) {
          // Doc dividido em partes: busca todas e remonta o array na ordem
          var reads = [];
          for (var i = 0; i < remote.chunks; i++) {
            reads.push(firestore.collection('lapink').doc(key + '_' + i).get());
          }
          Promise.all(reads).then(function (snaps) {
            var arr = [];
            var completo = true;
            snaps.forEach(function (s) {
              var d = s.exists ? s.data() : null;
              if (d && Array.isArray(d.data)) arr = arr.concat(d.data);
              else completo = false;
            });
            if (completo && arr.length) aplicar(arr);
            else console.warn('[sync] ' + key + ': partes incompletas na nuvem, ignorando');
          }).catch(function (e) { console.warn('[sync] read chunks error ' + key, e); });
        } else if (remote.data) {
          aplicar(remote.data);
        }
      }).catch(function (e) { console.warn('[sync] read error ' + key, e); });
    });
  }

  // Notifica a página quando uma chave chega do Firestore, para re-renderizar
  // sem precisar de reload. Ex.: V1.html e produto.html escutam 'lapinkProdutosAtualizados'.
  function _notificarSync(key, data) {
    try {
      document.dispatchEvent(new CustomEvent(key + 'Atualizados', { detail: data }));
      window.dispatchEvent(new CustomEvent('lapinkSync', { detail: { key: key, data: data } }));
    } catch (e) { /* navegadores antigos: ignora */ }
  }

  // Inicia sincronização quando Firebase estiver pronto (máx MAX_RETRIES tentativas)
  function waitAndSync(retries) {
    retries = retries || 0;
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
      syncFromCloud(_notificarSync);
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
  // (pull manual ignora o intervalo mínimo — sempre busca na hora)
  window.LaPinkSync = {
    push: writeToFirestore,
    pull: function (cb) { return syncFromCloud(cb, true); }
  };
})();
