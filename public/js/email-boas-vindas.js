/* LaPink — E-mail de boas-vindas (newsletter "Receba novidades e ofertas" +
   cadastro de conta). Configurável e desativável pelo admin em
   Configurações → E-mail de boas-vindas (lapinkEmailConfig, público —
   guarda só a Public Key do EmailJS, não uma credencial secreta). */
(function () {
  // Lê a config local (sincronizada via cloud-sync); se ainda não chegou
  // neste navegador (ex.: visitante novo), busca direto no Firestore.
  function _configLocal() {
    try { return JSON.parse(localStorage.getItem('lapinkEmailConfig') || '{}') || {}; }
    catch (e) { return {}; }
  }

  function _configRemota() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return Promise.resolve(null);
      return firebase.firestore().collection('lapink').doc('lapinkEmailConfig').get().then(function (snap) {
        if (!snap.exists) return null;
        var d = snap.data();
        return (d && d.data) || null;
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function _descontoPct() {
    try {
      var loja = JSON.parse(localStorage.getItem('lapinkLojaConfig') || '{}') || {};
      var d = loja.descontoBoasVindas || {};
      return (d.ativo && Number(d.percentual) > 0) ? Number(d.percentual) : 0;
    } catch (e) { return 0; }
  }

  function _carregarSdk() {
    if (window.emailjs) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  // Dispara o e-mail de boas-vindas. Nunca lança erro nem trava o fluxo que
  // chamou (newsletter/cadastro) — falha silenciosa com aviso no console.
  window.enviarEmailBoasVindas = function (email, nome) {
    if (!email) return Promise.resolve(false);

    return Promise.resolve(_configLocal()).then(function (cfg) {
      if (cfg && cfg.emailjsPk && cfg.emailjsSid && cfg.emailjsWelcomeTid) return cfg;
      return _configRemota().then(function (remota) { return remota || cfg || {}; });
    }).then(function (cfg) {
      // Chave-mestra: admin pode desligar o envio sem apagar a configuração
      if (!cfg || cfg.ativo === false) return false;
      if (!cfg.emailjsPk || !cfg.emailjsSid || !cfg.emailjsWelcomeTid) return false;

      return _carregarSdk().then(function (ok) {
        if (!ok || !window.emailjs) return false;
        var pct = _descontoPct();
        try {
          window.emailjs.init({ publicKey: cfg.emailjsPk });
          return window.emailjs.send(cfg.emailjsSid, cfg.emailjsWelcomeTid, {
            to_email: email,
            to_name: nome || email,
            discount_pct: pct || '',
            from_name: cfg.fromName || 'LaPink',
            from_email: cfg.emailjsFrom || '',
            reply_to: cfg.emailjsFrom || ''
          }).then(function () { return true; }).catch(function (e) {
            console.warn('[email-boas-vindas] falha ao enviar:', e && e.message);
            return false;
          });
        } catch (e) {
          console.warn('[email-boas-vindas] erro:', e && e.message);
          return false;
        }
      });
    }).catch(function () { return false; });
  };
})();
