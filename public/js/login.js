// ── Seed dos super admins fixos (espelha admin/js/auth.js) ──────────
// Garante que os super admins existam no lapinkUsers deste navegador para
// que o login funcione mesmo sem ter aberto o painel antes (navegador novo).
(function _seedSuperAdminsLogin() {
  try {
    var FIXED = [
      { email: 'alexandrej529@hotmail.com', name: 'Alexandre', role: 'superadmin',
        passwordHash: '5768210eb5f7cc1aa57ed358079b7c5187ac5b8d56e93efa226e58810667d76a', travarSenha: false },
      { email: 'crischavesk123@hotmail.com', name: 'Cristiane', role: 'superadmin',
        passwordHash: 'a507a72cb3b73a3006224fb4314e004ad2c90072312d92e83ac73bd56ec61520', travarSenha: true }
    ];
    var users = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
    if (!Array.isArray(users)) users = [];
    var changed = false;
    FIXED.forEach(function (sa) {
      var idx = users.findIndex(function (u) { return u.email && u.email.toLowerCase() === sa.email.toLowerCase(); });
      if (idx === -1) {
        users.push({ email: sa.email, password: sa.passwordHash, role: 'superadmin', name: sa.name, address: '', createdAt: new Date().toISOString() });
        changed = true;
      } else {
        if (users[idx].role !== 'superadmin') { users[idx].role = 'superadmin'; changed = true; }
        if (sa.travarSenha) { if (users[idx].password !== sa.passwordHash) { users[idx].password = sa.passwordHash; changed = true; } }
        else if (!users[idx].password) { users[idx].password = sa.passwordHash; changed = true; }
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
  loginMessage.style.color = success ? '#1e7e34' : '#c82333';
}

if (loginForm) {
  loginForm.addEventListener('submit', function(event) {
    event.preventDefault();
    _doLogin();
  });
}

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
function _setAdminSession(client) {
  try {
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
    localStorage.setItem('lapinkSession', JSON.stringify(session));
  } catch (e) {}
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

function _finishLogin(client, referrerPage) {
  try { localStorage.removeItem('_loginAttempts'); } catch (e) {}
  setLoggedClient(client);

  // Admin/Super Admin → grava sessão do painel e abre o painel.
  if (client && (client.role === 'admin' || client.role === 'superadmin')) {
    _setAdminSession(client);
    setLoginMessage('Login de administrador! Abrindo painel...', true);
    var _dest = _adminRedirect(client);
    setTimeout(function () {
      try { sessionStorage.removeItem('referrerPage'); } catch (e) {}
      location.href = _dest;
    }, 1000);
    return;
  }

  setLoginMessage('Login realizado! Redirecionando...', true);
  setTimeout(function () {
    try { sessionStorage.removeItem('referrerPage'); } catch (e) {}
    location.href = referrerPage;
  }, 1200);
}

async function _doLogin() {
  var email         = document.getElementById('login-email').value.trim().toLowerCase();
  var loginPassword = document.getElementById('login-password').value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setLoginMessage('Digite um e-mail válido.', false);
    return;
  }

  // Rate limiting: máximo 5 tentativas por 15 minutos
  try {
    var _now = Date.now();
    var _att = JSON.parse(localStorage.getItem('_loginAttempts') || '[]');
    _att = _att.filter(function(t) { return _now - t < 15 * 60 * 1000; });
    if (_att.length >= 5) {
      setLoginMessage('Muitas tentativas. Aguarde alguns minutos e tente novamente.', false);
      return;
    }
  } catch(e) {}

  // Destino pós-login — apenas caminhos relativos são aceitos
  var referrerPage = 'V1.html';
  try {
    var _stored = sessionStorage.getItem('referrerPage');
    if (_stored && _isSafeRedirect(_stored)) referrerPage = _stored;
  } catch(e) {}

  // ── 1) Firebase Authentication (se ativo). Se falhar, segue para o sistema atual. ──
  var authClient = await _firebaseAuthLogin(email, loginPassword);
  if (authClient) { authClient = await _applyAdminRole(email, authClient); _finishLogin(authClient, referrerPage); return; }

  var clients = getClients();
  var client  = null;

  // ── 2) Clientes locais — verifica qualquer esquema de hash (PBKDF2 salgado,
  //       SHA-256 salgado ou SHA-256 legado). NÃO há mais fallback de senha em
  //       texto puro. Hashes legados são migrados para salgado de forma transparente.
  var cand = clients.find(function(c) { return c.email === email; });
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
      var found = users.find(function(u) { return u.email === email; });
      if (found && await verifyPassword(loginPassword, found.password)) {
        client = { email: found.email, name: found.name, role: found.role || 'client', pages: found.pages };
      }
    } catch(e) {}
  }

  if (!client) {
    // Registra tentativa falha
    try {
      var _a = JSON.parse(localStorage.getItem('_loginAttempts') || '[]');
      _a.push(Date.now());
      localStorage.setItem('_loginAttempts', JSON.stringify(_a));
    } catch(e) {}
    setLoginMessage('E-mail ou senha incorretos.', false);
    return;
  }

  // Garante que um cliente promovido a admin entre como administrador.
  client = await _applyAdminRole(email, client);

  // Login legado bem-sucedido → migra a conta para o Firebase Auth (transparente)
  await _ensureAuthAccount(email, loginPassword, client);
  _finishLogin(client, referrerPage);
}
