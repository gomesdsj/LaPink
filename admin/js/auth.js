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
//   • alexandrej529@hotmail.com — senha 267267 (alterável pelo próprio)
//   • crischavesk123@hotmail.com — senha FIXA Cris@1824 (sempre reforçada)
(function _seedSuperAdmins() {
  var FIXED = [
    // Senha: 267267  — SHA-256
    { email: 'alexandrej529@hotmail.com', name: 'Alexandre', role: 'superadmin',
      passwordHash: '5768210eb5f7cc1aa57ed358079b7c5187ac5b8d56e93efa226e58810667d76a',
      travarSenha: false },
    // Senha: Cris@1824  — SHA-256 (super admin fixo; senha sempre esta)
    { email: 'crischavesk123@hotmail.com', name: 'Cristiane', role: 'superadmin',
      passwordHash: 'a507a72cb3b73a3006224fb4314e004ad2c90072312d92e83ac73bd56ec61520',
      travarSenha: true }
  ];
  var users = _getUsers();
  var changed = false;
  FIXED.forEach(function(sa) {
    var idx = users.findIndex(function(u) { return u.email.toLowerCase() === sa.email.toLowerCase(); });
    if (idx === -1) {
      users.push({ email: sa.email, password: sa.passwordHash, role: 'superadmin', name: sa.name, address: '', createdAt: new Date().toISOString() });
      changed = true;
    } else {
      if (users[idx].role !== 'superadmin') { users[idx].role = 'superadmin'; changed = true; }
      if (sa.travarSenha) {
        // Senha fixa: sempre reforça (qualquer alteração é revertida na próxima carga)
        if (users[idx].password !== sa.passwordHash) { users[idx].password = sa.passwordHash; changed = true; }
      } else if (!users[idx].password) {
        // Alterável: só define a padrão se estiver vazia
        users[idx].password = sa.passwordHash; changed = true;
      }
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

function addUser(data) {
  var users = _getUsers();
  if (users.some(function(u) { return u.email.toLowerCase() === data.email.toLowerCase(); })) {
    return Promise.resolve({ ok: false, error: 'E-mail já cadastrado.' });
  }
  return _hashPassword(data.password).then(function(hash) {
    users.push({
      email:     data.email.trim().toLowerCase(),
      password:  hash,
      role:      data.role || 'client',
      name:      data.name || data.email,
      address:   data.address || '',
      createdAt: new Date().toISOString()
    });
    _saveUsers(users);
    return { ok: true };
  });
}

function promoteToAdmin(email) {
  var users = _getUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email.toLowerCase() === email.toLowerCase()) {
      if (users[i].role === 'superadmin') return { ok: false, error: 'Não é possível alterar o Super Admin.' };
      users[i].role = 'admin';
      _saveUsers(users);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuário não encontrado.' };
}

function revokeAdmin(email) {
  var users = _getUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email.toLowerCase() === email.toLowerCase()) {
      if (users[i].role === 'superadmin') return { ok: false, error: 'Não é possível alterar o Super Admin.' };
      users[i].role = 'client';
      _saveUsers(users);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuário não encontrado.' };
}

function addUserFromClient(client) {
  var users = _getUsers();
  var email = (client.email || '').trim().toLowerCase();
  var idx = users.findIndex(function(u) { return u.email.toLowerCase() === email; });
  if (idx !== -1) {
    if (users[idx].role === 'superadmin') return { ok: false, error: 'Não é possível alterar o Super Admin.' };
    users[idx].role = 'admin';
    if (client.name || client.nome) users[idx].name = client.name || client.nome;
  } else {
    users.push({
      email: email,
      password: client.password || '',
      role: 'admin',
      name: client.name || client.nome || email,
      address: client.endereco || client.address || '',
      createdAt: new Date().toISOString()
    });
  }
  _saveUsers(users);
  return { ok: true };
}

function deleteUser(email) {
  var users = _getUsers();
  var target = users.find(function(u) { return u.email.toLowerCase() === email.toLowerCase(); });
  if (!target) return { ok: false, error: 'Usuário não encontrado.' };
  if (target.role === 'superadmin') return { ok: false, error: 'Não é possível excluir o Super Admin.' };
  _saveUsers(users.filter(function(u) { return u.email.toLowerCase() !== email.toLowerCase(); }));
  return { ok: true };
}

function updateUser(email, data) {
  var users = _getUsers();
  var idx = users.findIndex(function(u) { return u.email.toLowerCase() === email.toLowerCase(); });
  if (idx === -1) return { ok: false, error: 'Usuário não encontrado.' };
  if (users[idx].role === 'superadmin') return { ok: false, error: 'Não é possível alterar o Super Admin.' };
  if (data.name  !== undefined) users[idx].name  = data.name;
  if (data.role  !== undefined) users[idx].role  = data.role;
  if (data.pages !== undefined) users[idx].pages = data.pages; // null = acesso total, array = restrito
  _saveUsers(users);
  return { ok: true };
}

function updatePassword(email, newPassword) {
  return _hashPassword(newPassword).then(function(hash) {
    var users = _getUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email.toLowerCase() === email.toLowerCase()) {
        users[i].password = hash;
        _saveUsers(users);
        return { ok: true };
      }
    }
    return { ok: false, error: 'Usuário não encontrado.' };
  });
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

// ── Init automático em páginas admin ─────────────────────
document.addEventListener('DOMContentLoaded', function() {
  renderSessionTopbar();
  applyAdminPermissions();
});
