// ── Seed dos super admins fixos (espelha admin/js/auth.js) ──────────
// Garante que os DOIS super admins fixos apareçam como 'superadmin' neste
// navegador (útil para a lista em gerenciar-usuarios.html e como fallback
// de exibição) — SEM NENHUMA SENHA. A autenticação real dos dois é 100%
// via Firebase Auth (ver _resolverRoleReal); nenhum hash fica no código.
(function _seedSuperAdminsLogin() {
  try {
    var FIXED = [
      { email: 'alexandrej529@hotmail.com', name: 'Alexandre' },
      { email: 'crischavesk123@hotmail.com', name: 'Cristiane' }
    ];
    var users = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
    if (!Array.isArray(users)) users = [];
    var changed = false;
    FIXED.forEach(function (sa) {
      var idx = users.findIndex(function (u) { return u.email && u.email.toLowerCase() === sa.email.toLowerCase(); });
      if (idx === -1) {
        users.push({ email: sa.email, role: 'superadmin', name: sa.name, address: '', createdAt: new Date().toISOString() });
        changed = true;
      } else if (users[idx].role !== 'superadmin') {
        users[idx].role = 'superadmin'; changed = true;
      }
    });
    if (changed) localStorage.setItem('lapinkUsers', JSON.stringify(users));
  } catch (e) {}
})();

var loginForm    = document.getElementById('loginForm');
var loginMessage = document.getElementById('loginMessage');

function setLoginMessage(text, success) {
  if (!loginMessage) return;
  loginMessage.textContent = text;
  loginMessage.className = 'form-message show ' + (success ? 'success' : 'error');
}

if (loginForm) {
  loginForm.addEventListener('submit', function(event) {
    event.preventDefault();
    _doLogin();
  });
}

// ── Pré-aquecimento das Cloud Functions usadas no login ────────────────
// Medido nos logs de produção: uma instância "fria" de verificarLimiteIP
// ou sincronizarClaimsAdmin leva de 4 a 5 SEGUNDOS só para inicializar —
// e o login chama as duas, uma depois da outra, sem poder seguir sem
// resposta. É a maior fatia do "login demorado".
//
// Dispara as duas assim que a página carrega (ainda dando tempo de digitar
// e-mail/senha) para a instância já estar de pé quando o forms for enviado
// de verdade. Sem token/dados reais — o resultado é descartado, o único
// efeito colateral é o container ficar quente.
(function _preAquecerLogin() {
  try {
    fetch('https://us-central1-lapink-82a39.cloudfunctions.net/verificarLimiteIP', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'login', modo: 'checar' })
    }).catch(function () {});
  } catch (e) {}
  try {
    fetch('https://us-central1-lapink-82a39.cloudfunctions.net/sincronizarClaimsAdmin', {
      method: 'POST'
      // Sem Authorization de propósito — a function rejeita rápido (401),
      // mas o container já subiu, que é tudo que este aquecimento quer.
    }).catch(function () {});
  } catch (e) {}
})();

function _isSafeRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  // Aceita apenas caminhos relativos simples — sem protocolo, sem //
  return /^[a-zA-Z0-9._\-/]+\.html(\?[^<>"']*)?$/.test(url);
}

// Lê um documento da coleção lapink no Firestore (ex.: lapinkClients, lapinkUsers).
// Retorna o array .data ou null. Usado como fallback no login.
async function _fetchLapinkDoc(docId) {
  try {
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return null;
    var snap = await firebase.firestore().collection('lapink').doc(docId).get();
    if (snap.exists) {
      var d = snap.data();
      if (d && d.data) return d.data;
    }
  } catch (e) {}
  return null;
}

// ── Firebase Authentication (com fallback automático) ──────────
// Tenta autenticar no Firebase Auth. Retorna o client {email,name,role}
// ou null (provedor desativado / conta inexistente / senha incorreta) → cai no fallback.
async function _firebaseAuthLogin(email, password) {
  try {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    var cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    var uid = cred.user && cred.user.uid;
    var perfil = null;
    try {
      var s = await firebase.firestore().collection('usuarios').doc(uid).get();
      if (s.exists) perfil = s.data();
    } catch (e) {}
    return {
      email: email,
      name: (perfil && perfil.name) || (cred.user && cred.user.displayName) || email,
      role: (perfil && perfil.role) || 'client'
    };
  } catch (e) { return null; }
}

// Cria/garante a conta no Firebase Auth após um login legado bem-sucedido
// (migração transparente). Silencioso — ignora erros (provedor off, já existe, senha curta).
async function _ensureAuthAccount(email, password, client) {
  try {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    var cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    var uid = cred.user && cred.user.uid;
    try {
      await firebase.firestore().collection('usuarios').doc(uid).set({
        email: email, name: client.name || email, role: client.role || 'client', migratedAt: Date.now()
      }, { merge: true });
    } catch (e) {}
  } catch (e) {}
}

// Páginas do painel (espelha ADMIN_PAGES de admin/js/auth.js) — usado para
// levar um admin com acesso restrito direto à sua primeira página permitida.
var _ADMIN_PAGES = [
  { id: 'dashboard',     href: 'admin.html' },
  { id: 'produtos',      href: 'cadastro-produto.html' },
  { id: 'pedidos',       href: 'pedidos.html' },
  { id: 'clientes',      href: 'clientes.html' },
  { id: 'loja-v1',       href: 'loja-v1.html' },
  { id: 'relatorios',    href: 'relatorios.html' },
  { id: 'financeiro',    href: 'financeiro.html' },
  { id: 'configuracoes', href: 'configuracoes.html' }
];

// Grava a sessão do painel (mesma chave/forma que admin/js/auth.js espera).
// Devolve true/false: antes esta função engolia qualquer erro em silêncio, e
// quando o localStorage estava cheio a sessão simplesmente não era gravada —
// o login anunciava "abrindo painel", redirecionava, o checkAuth não achava
// sessão nenhuma e mandava de volta para o login. Era o loop de "entra e volta".
function _setAdminSession(client) {
  var pages = Array.isArray(client.pages) ? client.pages : null;
  // Garante 'pages' a partir do lapinkUsers local, se o objeto não trouxe.
  if (client.role === 'admin' && !pages) {
    try {
      var us = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
      var u = us.find(function (x) { return x.email && x.email.toLowerCase() === client.email.toLowerCase(); });
      if (u && Array.isArray(u.pages)) pages = u.pages;
    } catch (e) {}
  }
  var session = {
    email: client.email,
    role: client.role,
    name: client.name || client.email,
    pages: (client.role === 'admin') ? pages : null,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  };
  return _gravarSessaoAdmin(session);
}

// Grava a sessão e CONFERE relendo. Se não couber (localStorage cheio),
// libera o catálogo em cache e tenta de novo: lapinkProdutos é só cache —
// a fonte da verdade é o Firestore, e o cloud-sync rebaixa tudo na próxima
// carga. Melhor perder o cache do que trancar o admin fora do painel.
function _gravarSessaoAdmin(session) {
  var json = JSON.stringify(session);

  function tentar() {
    try {
      localStorage.setItem('lapinkSession', json);
      return !!JSON.parse(localStorage.getItem('lapinkSession') || 'null');
    } catch (e) { return false; }
  }

  if (tentar()) return true;

  console.warn('[login] localStorage cheio — liberando o cache do catálogo para gravar a sessão.');
  var descartaveis = ['lapinkProdutos', 'lapinkProdutos_ts', 'lapinkCarrossel', 'lapinkCarrossel_ts', 'lapinkPedidos', 'lapinkPedidos_ts'];
  for (var i = 0; i < descartaveis.length; i++) {
    try { localStorage.removeItem(descartaveis[i]); } catch (e) {}
    // Partes de documentos grandes (lapinkProdutos_0, _1, …)
    try {
      for (var n = 0; n < 40; n++) localStorage.removeItem(descartaveis[i] + '_' + n);
    } catch (e) {}
    if (tentar()) return true;
  }
  return false;
}

// Destino do painel conforme o role (superadmin/admin total → dashboard;
// admin restrito → primeira página permitida).
function _adminRedirect(client) {
  if (client.role === 'admin' && Array.isArray(client.pages) && client.pages.length > 0) {
    for (var i = 0; i < _ADMIN_PAGES.length; i++) {
      if (client.pages.indexOf(_ADMIN_PAGES[i].id) !== -1) return '../admin/' + _ADMIN_PAGES[i].href;
    }
  }
  return '../admin/admin.html';
}

// Eleva o papel para admin/superadmin cruzando o e-mail com lapinkUsers
// (local e, se faltar, no Firestore). Resolve o caso de um CLIENTE que foi
// promovido a admin: o login pode tê-lo encontrado antes como cliente, então
// aqui garantimos que o papel atribuído no painel prevaleça.
async function _applyAdminRole(email, client) {
  try {
    if (!client) return client;
    var lower = (email || client.email || '').toLowerCase();
    if (!lower) return client;
    var match = null;
    try {
      var us = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
      if (Array.isArray(us)) match = us.find(function (u) { return u.email && u.email.toLowerCase() === lower; }) || null;
    } catch (e) {}
    if (!match) {
      var remote = await _fetchLapinkDoc('lapinkUsers');
      if (Array.isArray(remote)) match = remote.find(function (u) { return u.email && u.email.toLowerCase() === lower; }) || null;
    }
    if (match && (match.role === 'admin' || match.role === 'superadmin')) {
      client.role = match.role;
      client.pages = match.pages;
      if (match.name) client.name = match.name;
    }
  } catch (e) {}
  return client;
}

// Sincroniza o custom claim (role/pages) no token do Firebase Auth e usa a
// claim resultante como FONTE DA VERDADE do papel do usuário — não depende
// mais de ler lapinkUsers (que fica bloqueado pelas regras em navegador novo).
// Roda para QUALQUER login com sessão Firebase Auth (não só quem já "parece"
// admin): a Function decide o role de verdade (2 super admins fixos + o que
// estiver em lapinkUsers, via Admin SDK) — o cliente nunca define o próprio
// papel. Silencioso: se não houver sessão Firebase Auth ainda (login 100%
// legado), mantém o role já resolvido por _applyAdminRole sem travar nada.
async function _resolverRoleReal(client) {
  try {
    if (!client) return client;
    if (typeof firebase === 'undefined' || !firebase.auth) return client;
    var user = firebase.auth().currentUser;
    if (!user) return client;

    var idToken = await user.getIdToken();
    await fetch('https://us-central1-lapink-82a39.cloudfunctions.net/sincronizarClaimsAdmin', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken }
    });

    var fresh = await user.getIdTokenResult(true); // força refresh — pega a claim nova já nesta sessão
    var claimRole = fresh && fresh.claims && fresh.claims.role;
    if (claimRole === 'admin' || claimRole === 'superadmin') {
      client.role = claimRole;
      client.pages = fresh.claims.pages || null;
    }
  } catch (e) { /* nunca trava o login — mantém o role já resolvido antes */ }
  return client;
}

async function _finishLogin(client, referrerPage) {
  try { localStorage.removeItem('_loginAttempts'); } catch (e) {}
  // Autenticou: limpa o contador de falhas deste IP, para que tentativas
  // anteriores não continuem empurrando quem já entrou rumo a um bloqueio.
  try { registrarSucessoLimiteIP('login'); } catch (e) {}
  setLoggedClient(client);

  // Admin/Super Admin → grava sessão do painel e abre o painel.
  if (client && (client.role === 'admin' || client.role === 'superadmin')) {
    // Só redireciona se a sessão REALMENTE ficou gravada — senão o painel
    // devolveria para cá e o usuário ficaria preso no vai-e-volta sem
    // nenhuma explicação na tela.
    if (!_setAdminSession(client)) {
      setLoginMessage('Não foi possível abrir o painel: o armazenamento deste navegador está cheio. ' +
                      'Limpe os dados do site (ou use uma aba anônima) e entre de novo.', false);
      return;
    }
    setLoginMessage('Login de administrador! Abrindo painel...', true);
    var _dest = _adminRedirect(client);
    // Só o suficiente para a mensagem de sucesso aparecer na tela antes da
    // troca de página — não precisa ser 1s inteiro. A demora que o usuário
    // sente vem de antes daqui (chamadas de rede já concluídas neste ponto).
    setTimeout(function () {
      try { sessionStorage.removeItem('referrerPage'); } catch (e) {}
      location.href = _dest;
    }, 300);
    return;
  }

  setLoginMessage('Login realizado! Redirecionando...', true);
  setTimeout(function () {
    try { sessionStorage.removeItem('referrerPage'); } catch (e) {}
    location.href = referrerPage;
  }, 300);
}

async function _doLogin() {
  var email         = document.getElementById('login-email').value.trim().toLowerCase();
  var loginPassword = document.getElementById('login-password').value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setLoginMessage('Digite um e-mail válido.', false);
    return;
  }

  // Rate limit por IP (servidor) — protege contra força bruta mesmo que o
  // navegador seja trocado ou o localStorage seja limpo.
  var _limite = await verificarLimiteIP('login');
  if (_limite.bloqueado) {
    setLoginMessage('Muitas tentativas deste endereço. Tente novamente em ' + _limite.retryAfterMin + ' min.', false);
    return;
  }

  // Destino pós-login — apenas caminhos relativos são aceitos
  var referrerPage = 'V1.html';
  try {
    var _stored = sessionStorage.getItem('referrerPage');
    if (_stored && _isSafeRedirect(_stored)) referrerPage = _stored;
  } catch(e) {}

  // ── 1) Firebase Authentication (se ativo). Se falhar, segue para o sistema atual. ──
  var authClient = await _firebaseAuthLogin(email, loginPassword);
  if (authClient) {
    authClient = await _applyAdminRole(email, authClient);  // heurística local (lapinkUsers, best-effort)
    authClient = await _resolverRoleReal(authClient);       // fonte da verdade: custom claim (Admin SDK)
    _finishLogin(authClient, referrerPage);
    return;
  }

  var clients = getClients();
  var client  = null;

  // ── 2) Clientes locais — verifica qualquer esquema de hash (PBKDF2 salgado,
  //       SHA-256 salgado ou SHA-256 legado). NÃO há mais fallback de senha em
  //       texto puro. Hashes legados são migrados para salgado de forma transparente.
  //       Comparação de e-mail SEM diferenciar maiúsculas (contas antigas podem
  //       ter sido salvas com letras maiúsculas).
  var cand = clients.find(function(c) { return (c.email || '').toLowerCase() === email; });
  if (cand && await verifyPassword(loginPassword, cand.password)) {
    if (passwordPrecisaUpgrade(cand.password)) {
      try { cand.password = await hashPasswordSalted(loginPassword); saveClients(clients); } catch (e) {}
    }
    client = cand;
  }

  // ── 3) Usuário criado pelo painel admin (lapinkUsers) ──
  if (!client) {
    try {
      var users = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
      var found = users.find(function(u) { return (u.email || '').toLowerCase() === email; });
      if (found && await verifyPassword(loginPassword, found.password)) {
        client = { email: found.email, name: found.name, role: found.role || 'client', pages: found.pages };
      }
    } catch(e) {}
  }

  if (!client) {
    // Só AQUI a tentativa conta contra o limite do IP: quando a autenticação
    // realmente falhou. Entrar com a senha certa não consome mais nada.
    try { await registrarFalhaLimiteIP('login'); } catch (e) {}
    setLoginMessage('E-mail ou senha incorretos.', false);
    return;
  }

  // Garante que um cliente promovido a admin entre como administrador.
  client = await _applyAdminRole(email, client);

  // Login legado bem-sucedido → migra a conta para o Firebase Auth (transparente)
  await _ensureAuthAccount(email, loginPassword, client);
  client = await _resolverRoleReal(client); // fonte da verdade: custom claim (Admin SDK)
  _finishLogin(client, referrerPage);
}
