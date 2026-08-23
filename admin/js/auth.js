/* LaPink — Sistema de autenticação e controle de permissões */

var _USERS_KEY   = 'lapinkUsers';
var _SESSION_KEY = 'lapinkSession';

// ── Helper SHA-256 (com fallback puro JS para HTTP não-localhost) ─────
function _sha256js(str) {
  var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function R(x,n){return(x>>>n)|(x<<(32-n));}
  var utf=unescape(encodeURIComponent(String(str))),msg=[],i;
  for(i=0;i<utf.length;i++)msg.push(utf.charCodeAt(i));
  var msgLen=msg.length*8;
  msg.push(0x80);
  while(msg.length%64!==56)msg.push(0);
  msg.push(0,0,0,0,(msgLen>>>24)&255,(msgLen>>>16)&255,(msgLen>>>8)&255,msgLen&255);
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  for(var chunk=0;chunk<msg.length;chunk+=64){
    var W=[];
    for(i=0;i<16;i++)W[i]=(msg[chunk+i*4]<<24)|(msg[chunk+i*4+1]<<16)|(msg[chunk+i*4+2]<<8)|msg[chunk+i*4+3];
    for(i=16;i<64;i++){var g0=R(W[i-15],7)^R(W[i-15],18)^(W[i-15]>>>3),g1=R(W[i-2],17)^R(W[i-2],19)^(W[i-2]>>>10);W[i]=(W[i-16]+g0+W[i-7]+g1)>>>0;}
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(i=0;i<64;i++){var S1=R(e,6)^R(e,11)^R(e,25),ch=(e&f)^(~e&g),T1=(h+S1+ch+K[i]+W[i])>>>0,S0=R(a,2)^R(a,13)^R(a,22),maj=(a&b)^(a&c)^(b&c),T2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+T1)>>>0;d=c;c=b;b=a;a=(T1+T2)>>>0;}
    H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
  }
  return H.map(function(v){return v.toString(16).padStart(8,'0');}).join('');
}

function _hashPassword(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      .then(function(buf) {
        return Array.from(new Uint8Array(buf))
          .map(function(b) { return b.toString(16).padStart(2, '0'); })
          .join('');
      });
  }
  return Promise.resolve(_sha256js(str));
}

// ── Seed dos Super Admins fixos ───────────────────────────
// Super admins permanentes: role 'superadmin' garantido a cada carga e
// impossíveis de excluir (proteção em deleteUser). Recriados se sumirem.
// SEM SENHA aqui — a autenticação real dos dois é 100% via Firebase Auth
// (login.js → _resolverRoleReal + Cloud Function sincronizarClaimsAdmin,
// que já reconhece esses 2 e-mails independente deste registro local).
// Este seed serve só para exibição (ex.: lista em gerenciar-usuarios.html)
// e como dica local de role antes da claim confirmar.
//   • alexandrej529@hotmail.com
//   • crischavesk123@hotmail.com
(function _seedSuperAdmins() {
  var FIXED = [
    { email: 'alexandrej529@hotmail.com', name: 'Alexandre' },
    { email: 'crischavesk123@hotmail.com', name: 'Cristiane' }
  ];
  var users = _getUsers();
  var changed = false;
  FIXED.forEach(function(sa) {
    var idx = users.findIndex(function(u) { return u.email.toLowerCase() === sa.email.toLowerCase(); });
    if (idx === -1) {
      users.push({ email: sa.email, role: 'superadmin', name: sa.name, address: '', createdAt: new Date().toISOString() });
      changed = true;
    } else if (users[idx].role !== 'superadmin') {
      users[idx].role = 'superadmin'; changed = true;
    }
  });
  if (changed) _saveUsers(users);
})();

// ── Helpers internos ──────────────────────────────────────
function _getUsers() {
  try { return JSON.parse(localStorage.getItem(_USERS_KEY) || '[]'); } catch(e) { return []; }
}

function _saveUsers(arr) {
  localStorage.setItem(_USERS_KEY, JSON.stringify(arr));
  _pushUsersCloud(arr);
}

// Publica lapinkUsers no Firestore (lapink/lapinkUsers) fazendo UNIÃO por e-mail
// com o que já existe remotamente — evita que o seed do super admin, ao rodar
// num navegador novo, apague admins criados em outro dispositivo.
function _pushUsersCloud(localArr) {
  try {
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    var ref = firebase.firestore().collection('lapink').doc('lapinkUsers');
    ref.get().then(function (snap) {
      var remote = (snap.exists && snap.data() && snap.data().data) || [];
      var byEmail = {};
      (Array.isArray(remote) ? remote : []).forEach(function (u) { if (u && u.email) byEmail[u.email.toLowerCase()] = u; });
      (localArr || []).forEach(function (u) { if (u && u.email) byEmail[u.email.toLowerCase()] = u; });
      var merged = Object.keys(byEmail).map(function (k) { return byEmail[k]; });
      ref.set({ data: merged, updatedAt: Date.now() }, { merge: true }).catch(function () {});
    }).catch(function () {
      ref.set({ data: localArr || [], updatedAt: Date.now() }, { merge: true }).catch(function () {});
    });
  } catch (e) {}
}

// ── Páginas do painel admin (usadas para controle de acesso por usuário) ─
var ADMIN_PAGES = [
  { id: 'dashboard',     href: 'admin.html',            label: 'Dashboard',     icon: 'ti-layout-dashboard' },
  { id: 'produtos',      href: 'cadastro-produto.html', label: 'Produtos',      icon: 'ti-package' },
  { id: 'descontos',     href: 'descontos.html',        label: 'Descontos',     icon: 'ti-discount-2' },
  { id: 'pedidos',       href: 'pedidos.html',          label: 'Pedidos',       icon: 'ti-shopping-cart' },
  { id: 'clientes',      href: 'clientes.html',         label: 'Clientes',      icon: 'ti-users' },
  { id: 'loja-v1',       href: 'loja-v1.html',          label: 'Editor Loja V1',icon: 'ti-layout' },
  { id: 'relatorios',    href: 'relatorios.html',       label: 'Relatórios',    icon: 'ti-chart-bar' },
  { id: 'financeiro',    href: 'financeiro.html',       label: 'Financeiro',    icon: 'ti-coin' },
  { id: 'configuracoes', href: 'configuracoes.html',    label: 'Configurações', icon: 'ti-settings' },
];

function _getCurrentPageId() {
  var filename = window.location.pathname.replace(/\\/g, '/').split('/').pop() || '';
  for (var i = 0; i < ADMIN_PAGES.length; i++) {
    if (ADMIN_PAGES[i].href === filename) return ADMIN_PAGES[i].id;
  }
  return null;
}

function _loginUrl() {
  // Login único do projeto: public/login.html (atende cliente e admin).
  var path = window.location.pathname.replace(/\\/g, '/');
  return path.includes('/public/') ? 'login.html' : '../public/login.html';
}

// ── API pública ───────────────────────────────────────────

function getSession() {
  try {
    var s = JSON.parse(localStorage.getItem(_SESSION_KEY) || 'null');
    if (!s) return null;
    // Sessões sem expiresAt (legadas) expiram em 8h a partir do momento lido
    if (s.expiresAt && Date.now() > s.expiresAt) {
      localStorage.removeItem(_SESSION_KEY);
      return null;
    }
    return s;
  } catch(e) { return null; }
}

/**
 * Verifica se o usuário tem permissão para acessar a página.
 * Redireciona para login.html se não estiver autenticado ou sem permissão.
 * @param {string[]} allowedRoles — ex: ['superadmin', 'admin']
 */
function checkAuth(allowedRoles) {
  var session = getSession();
  if (!session) {
    window.location.replace(_loginUrl());
    return false;
  }
  if (allowedRoles && allowedRoles.indexOf(session.role) === -1) {
    window.location.replace(_loginUrl());
    return false;
  }
  // Verifica acesso à página específica para admins com abas restritas
  if (session.role === 'admin' && Array.isArray(session.pages)) {
    var pid = _getCurrentPageId();
    if (pid && session.pages.indexOf(pid) === -1) {
      window.location.replace(_loginUrl());
      return false;
    }
  }
  return true;
}

/**
 * Autentica um usuário (async — SHA-256).
 * Rate limiting: 5 tentativas por 15 min por email.
 * @param {string} email
 * @param {string} password — senha em texto puro
 * @param {string[]|null} requiredRoles
 * @returns {Promise<{ ok: boolean, session?: object, error?: string }>}
 */
function login(email, password, requiredRoles) {
  // Rate limiting por e-mail
  var _attKey = '_adm_att_' + btoa(email.trim().toLowerCase()).replace(/=/g, '');
  try {
    var _now = Date.now();
    var _att = JSON.parse(localStorage.getItem(_attKey) || '[]');
    _att = _att.filter(function(t) { return _now - t < 15 * 60 * 1000; });
    if (_att.length >= 5) {
      return Promise.resolve({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
    }
  } catch(e) {}

  return _hashPassword(password).then(function(hash) {
    var users = _getUsers();
    var user  = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].email.toLowerCase() !== email.trim().toLowerCase()) continue;
      if (users[i].password === hash) { user = users[i]; break; }
    }
    if (!user) {
      try {
        var _a = JSON.parse(localStorage.getItem(_attKey) || '[]');
        _a.push(Date.now());
        localStorage.setItem(_attKey, JSON.stringify(_a));
      } catch(e) {}
      return { ok: false, error: 'E-mail ou senha incorretos.' };
    }
    if (requiredRoles && requiredRoles.indexOf(user.role) === -1) {
      return { ok: false, error: 'Acesso não permitido para este tipo de conta.' };
    }
    // Login OK — limpa contagem de tentativas
    try { localStorage.removeItem(_attKey); } catch(e) {}
    var session = {
      email     : user.email,
      role      : user.role,
      name      : user.name,
      pages     : (user.role === 'admin' && Array.isArray(user.pages)) ? user.pages : null,
      expiresAt : Date.now() + 8 * 60 * 60 * 1000  // 8 horas
    };
    localStorage.setItem(_SESSION_KEY, JSON.stringify(session));
    return { ok: true, session: session };
  });
}

/** Remove a sessão e redireciona para o login. */
function logout() {
  localStorage.removeItem(_SESSION_KEY);
  window.location.replace(_loginUrl());
}

/** Preenche a topbar com nome e badge de role da sessão atual. */
function renderSessionTopbar() {
  var session = getSession();
  if (!session) return;
  var el = document.getElementById('admin-greeting');
  var badge = document.querySelector('.admin-badge');
  if (el)    el.textContent = 'Olá, ' + session.name;
  if (badge) {
    var labels = { superadmin: 'Super Admin', admin: 'Admin', client: 'Cliente' };
    badge.textContent = labels[session.role] || session.role;
  }
}

/** Exibe o link "Usuários" e label de seção somente se role === superadmin. */
function renderSuperAdminLink() {
  var link = document.getElementById('link-gerenciar-usuarios');
  var sec  = document.getElementById('sec-sistema');
  var session = getSession();
  var show = (session && session.role === 'superadmin') ? 'flex' : 'none';
  if (link) link.style.display = show;
  if (sec)  sec.style.display  = show === 'flex' ? 'block' : 'none';
}

/** Aplica restrições de abas na sidebar para admins com acesso limitado. */
function applyAdminPermissions() {
  renderSuperAdminLink();
  var session = getSession();
  if (!session || session.role !== 'admin' || !Array.isArray(session.pages)) return;
  ADMIN_PAGES.forEach(function(p) {
    var link = document.querySelector('.sidebar-link[href="' + p.href + '"]');
    if (link && session.pages.indexOf(p.id) === -1) link.style.display = 'none';
  });
}

// ── Funções de gerenciamento de usuários (para gerenciar-usuarios.html) ──

function getAllUsers() { return _getUsers(); }

function _operacaoUsuarioAdmin(payload) {
  return garantirAdminFirebase().then(function(user) {
    return user.getIdToken().then(function(token) {
      return fetch('https://us-central1-lapink-82a39.cloudfunctions.net/gerenciarUsuarioAdmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload || {})
      });
    });
  }).then(function(resp) {
    return resp.json().catch(function() { return {}; }).then(function(data) {
      if (!resp.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
      return data;
    });
  });
}

function carregarUsuariosAdmin() {
  return _operacaoUsuarioAdmin({ acao: 'listar' }).then(function(data) {
    var fixos = _getUsers().filter(function(u) { return u.role === 'superadmin'; });
    var lista = Array.isArray(data.usuarios) ? data.usuarios : [];
    fixos.forEach(function(fixo) {
      if (!lista.some(function(u) { return u.email.toLowerCase() === fixo.email.toLowerCase(); })) lista.unshift(fixo);
    });
    localStorage.setItem(_USERS_KEY, JSON.stringify(lista));
    return lista;
  });
}

function addUser(data) {
  return _operacaoUsuarioAdmin({ acao: 'criar', nome: data.name, email: data.email, senha: data.password, role: data.role })
    .then(function() { return carregarUsuariosAdmin(); }).then(function() { return { ok: true }; })
    .catch(function(e) { return { ok: false, error: e.message }; });
}

function promoteToAdmin(email) {
  var u = _getUsers().find(function(x) { return x.email.toLowerCase() === email.toLowerCase(); }) || {};
  return updateUser(email, { name: u.name || email, role: 'admin', pages: null });
}

function revokeAdmin(email) {
  var u = _getUsers().find(function(x) { return x.email.toLowerCase() === email.toLowerCase(); }) || {};
  return updateUser(email, { name: u.name || email, role: 'client', pages: null });
}

function addUserFromClient(client) {
  var email = (client.email || '').trim().toLowerCase();
  return updateUser(email, { name: client.name || client.nome || email, role: 'admin', pages: null });
}

function deleteUser(email) {
  return _operacaoUsuarioAdmin({ acao: 'excluir', email: email })
    .then(function() { return carregarUsuariosAdmin(); }).then(function() { return { ok: true }; })
    .catch(function(e) { return { ok: false, error: e.message }; });
}

function updateUser(email, data) {
  return _operacaoUsuarioAdmin({ acao: 'atualizar', email: email, nome: data.name, role: data.role, pages: data.pages })
    .then(function() { return carregarUsuariosAdmin(); }).then(function() { return { ok: true }; })
    .catch(function(e) { return { ok: false, error: e.message }; });
}

function updatePassword(email, newPassword) {
  return _operacaoUsuarioAdmin({ acao: 'senha', email: email, senha: newPassword })
    .then(function() { return { ok: true }; }).catch(function(e) { return { ok: false, error: e.message }; });
}

function updateAddress(email, address) {
  var users = _getUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email.toLowerCase() === email.toLowerCase()) {
      users[i].address = address;
      _saveUsers(users);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuário não encontrado.' };
}

// Espera o Firebase Auth restaurar a sessão persistida (IndexedDB) antes de
// fazer consultas que dependem de request.auth nas regras do Firestore —
// evita que a 1ª consulta da página (ex.: listar pedidos) chegue ANTES da
// sessão de login ser restaurada e seja recusada por engano. Resolve assim
// que o estado é conhecido (autenticado ou não), sem travar se nunca resolver.
function aguardarFirebaseAuth() {
  return new Promise(function (resolve) {
    if (typeof firebase === 'undefined' || !firebase.auth) { resolve(null); return; }
    var resolvido = false;
    var unsub = firebase.auth().onAuthStateChanged(function (user) {
      if (resolvido) return;
      resolvido = true;
      try { unsub(); } catch (e) {}
      resolve(user);
    });
    setTimeout(function () {
      if (resolvido) return;
      resolvido = true;
      try { unsub(); } catch (e) {}
      resolve(firebase.auth().currentUser || null);
    }, 3000);
  });
}

// Confere a sessão local contra o Firebase Auth de verdade — fecha a brecha
// de alguém "entrar" no painel só escrevendo lapinkSession no localStorage
// (checkAuth por si só não prova nada, é só uma flag local sem assinatura).
// Roda em paralelo, sem atrasar o carregamento da página, e desloga se a
// claim real (definida só pela Cloud Function, via Admin SDK) não confirmar
// o papel que a sessão local está afirmando ter.
function verificarSessaoReal() {
  var session = getSession();
  if (!session || (session.role !== 'admin' && session.role !== 'superadmin')) return;
  if (typeof firebase === 'undefined' || !firebase.auth) return; // SDK não carregado nesta página

  aguardarFirebaseAuth().then(function (user) {
    if (!user) { logout(); return; } // sessão local diz admin, sem NENHUMA sessão Firebase Auth real

    function checarClaim(tokenResult) {
      var claimRole = tokenResult && tokenResult.claims && tokenResult.claims.role;
      return claimRole === 'admin' || claimRole === 'superadmin';
    }

    user.getIdTokenResult().then(function (res) {
      if (checarClaim(res)) return; // ok, confirmado
      // Pode ser um token emitido antes da claim existir — força 1 refresh
      // antes de decidir expulsar.
      return user.getIdToken(true).then(function () { return user.getIdTokenResult(); })
        .then(function (res2) { if (!checarClaim(res2)) logout(); });
    }).catch(function () { /* erro de rede — não desloga por excesso de cautela */ });
  });
}

// Garante, uma vez por carregamento, que o token usado pelo Firestore contém
// a role atual. A sessão local controla apenas a interface; quem autoriza uma
// gravação é a custom claim assinada pelo Firebase.
var _adminFirebasePromise = null;
function garantirAdminFirebase() {
  if (_adminFirebasePromise) return _adminFirebasePromise;
  var usuarioFirebase = null;
  _adminFirebasePromise = aguardarFirebaseAuth().then(function (user) {
    if (!user) throw new Error('Sessão Firebase ausente. Saia e entre novamente.');
    usuarioFirebase = user;
    return user.getIdToken().then(function (token) {
      return fetch('https://us-central1-lapink-82a39.cloudfunctions.net/sincronizarClaimsAdmin', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok || (data.role !== 'admin' && data.role !== 'superadmin')) {
          throw new Error(data.error || 'Sua conta não possui permissão administrativa.');
        }
        return usuarioFirebase.getIdToken(true).then(function () { return usuarioFirebase; });
      });
    });
  }).catch(function (e) {
    _adminFirebasePromise = null;
    throw e;
  });
  return _adminFirebasePromise;
}

// ── Init automático em páginas admin ─────────────────────
document.addEventListener('DOMContentLoaded', function() {
  renderSessionTopbar();
  applyAdminPermissions();
  verificarSessaoReal();
  var session = getSession();
  if (session && (session.role === 'admin' || session.role === 'superadmin')) {
    garantirAdminFirebase().catch(function (e) {
      console.warn('[auth] não foi possível atualizar a permissão:', e && e.message);
    });
  }
});
