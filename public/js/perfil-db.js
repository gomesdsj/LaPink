/* LaPink — persistência de perfil (endereços) por cliente no banco (Firestore).
   Grava/lê em usuarios/{uid} quando o cliente está autenticado no Firebase Auth
   (provedor E-mail/Senha ativo no Console). Cada cliente acessa só o SEU doc
   (regra usuarios/{uid}). Sem autenticação → no-op: fica só no localStorage. */
(function () {
  function _db() {
    return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase.firestore() : null;
  }
  function _auth() {
    try { return (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null; } catch (e) { return null; }
  }

  // Resolve o uid do cliente autenticado (aguarda o estado do Auth carregar).
  function _uidReady() {
    return new Promise(function (resolve) {
      var a = _auth();
      if (!a) { resolve(null); return; }
      if (a.currentUser) { resolve(a.currentUser.uid); return; }
      var done = false;
      var unsub = null;
      try {
        unsub = a.onAuthStateChanged(function (u) {
          if (done) return; done = true;
          try { unsub && unsub(); } catch (e) {}
          resolve(u ? u.uid : null);
        });
      } catch (e) { resolve(null); return; }
      setTimeout(function () {
        if (done) return; done = true;
        try { unsub && unsub(); } catch (e) {}
        resolve(a.currentUser ? a.currentUser.uid : null);
      }, 2500);
    });
  }

  // E-mail/nome do cliente logado (sessão local — não depende do Firebase Auth).
  function _clienteLogado() {
    try {
      var c = typeof getLoggedClient === 'function' ? getLoggedClient() : null;
      return (c && c.email) ? c : null;
    } catch (e) { return null; }
  }

  // Salva a lista de endereços + o padrão no banco.
  // 1) enderecos/{emailKey} — sempre que houver cliente logado (o painel admin
  //    lê este doc para mostrar os endereços no perfil do cliente);
  // 2) usuarios/{uid} — adicionalmente, quando autenticado no Firebase Auth.
  window.salvarEnderecosDB = function (enderecos, padrao) {
    var db = _db();
    if (!db) return Promise.resolve(false);
    var payload = { enderecos: enderecos || [], endereco: padrao || null, updatedAt: Date.now() };

    return _uidReady().then(function (uid) {
      if (!uid) return false;
      var cli = _clienteLogado();
      var privado = Object.assign({
        ownerUid: uid,
        email: (cli && cli.email) || '',
        nome: (cli && cli.name) || ''
      }, payload);
      return Promise.all([
        db.collection('enderecos').doc(uid).set(privado, { merge: true }),
        db.collection('usuarios').doc(uid).set(payload, { merge: true })
      ]).then(function () { return true; }).catch(function () { return false; });
    });
  };

  // Lê os endereços do cliente no banco. Retorna {enderecos, endereco} ou null.
  window.carregarEnderecosDB = function () {
    var db = _db();
    if (!db) return Promise.resolve(null);
    return _uidReady().then(function (uid) {
      if (!uid) return null;
      return db.collection('enderecos').doc(uid).get().then(function (s) {
        if (!s.exists) return null;
        var d = s.data() || {};
        if (!Array.isArray(d.enderecos) && !d.endereco) return null;
        return { enderecos: Array.isArray(d.enderecos) ? d.enderecos : [], endereco: d.endereco || null };
      }).catch(function () { return null; });
    });
  };
})();
