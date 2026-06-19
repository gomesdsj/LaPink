/* LaPink — Sistema de autenticação e controle de permissões */

var _USERS_KEY   = 'lapinkUsers';
var _SESSION_KEY = 'lapinkSession';

// ── Helper SHA-256 ────────────────────────────────────────
function _hashPassword(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
    .then(function(buf) {
      return Array.from(new Uint8Array(buf))
        .map(function(b) { return b.toString(16).padStart(2, '0'); })
        .join('');
    });
}

// ── Seed dos Super Admins fixos ───────────────────────────
// Hash pré-computado de '123456': mude SOMENTE a senha hardcoded abaixo e atualize o hash.
// SHA-256('123456') = 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
(function _seedSuperAdmins() {
  var FIXED = [
    {
      email:    'alexandrej529@hotmail.com',
      password: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
      name:     'Alexandre',
      role:     'superadmin'
    }
  ];
  var users = _getUsers();
  var changed = false;
  FIXED.forEach(function(sa) {
    var idx = users.findIndex(function(u) { return u.email.toLowerCase() === sa.email.toLowerCase(); });
    if (idx === -1) {
      users.push({ email: sa.email, password: sa.password, role: sa.role, name: sa.name, address: '', createdAt: new Date().toISOString() });
      changed = true;
    } else {
      if (users[idx].role !== 'superadmin') { users[idx].role = 'superadmin'; changed = true; }
      // Força SHA-256 se ainda estiver em btoa legado
      if (users[idx].password !== sa.password) { users[idx].password = sa.password; changed = true; }
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
}

function _loginUrl() {
  var path = window.location.pathname.replace(/\\/g, '/');
  return path.includes('/public/') ? '../admin/login.html' : 'login.html';
}

// ── API pública ───────────────────────────────────────────

function getSession() {
  try { return JSON.parse(localStorage.getItem(_SESSION_KEY) || 'null'); } catch(e) { return null; }
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
  return true;
}

/**
 * Autentica um usuário (async — SHA-256, com migração automática de btoa legado).
 * @param {string} email
 * @param {string} password — senha em texto puro
 * @param {string[]|null} requiredRoles
 * @returns {Promise<{ ok: boolean, session?: object, error?: string }>}
 */
function login(email, password, requiredRoles) {
  return _hashPassword(password).then(function(hash) {
    var users = _getUsers();
    var user  = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].email.toLowerCase() !== email.trim().toLowerCase()) continue;
      if (users[i].password === hash) {
        user = users[i];
        break;
      }
      // Migração automática: senha ainda em btoa → converte para SHA-256
      try {
        if (users[i].password === btoa(password)) {
          users[i].password = hash;
          _saveUsers(users);
          user = users[i];
          break;
        }
      } catch(e) {}
    }
    if (!user) return { ok: false, error: 'E-mail ou senha incorretos.' };
    if (requiredRoles && requiredRoles.indexOf(user.role) === -1) {
      return { ok: false, error: 'Acesso não permitido para este tipo de conta.' };
    }
    var session = { email: user.email, role: user.role, name: user.name };
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

function deleteUser(email) {
  var users = _getUsers();
  var target = users.find(function(u) { return u.email.toLowerCase() === email.toLowerCase(); });
  if (!target) return { ok: false, error: 'Usuário não encontrado.' };
  if (target.role === 'superadmin') return { ok: false, error: 'Não é possível excluir o Super Admin.' };
  _saveUsers(users.filter(function(u) { return u.email.toLowerCase() !== email.toLowerCase(); }));
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
  renderSuperAdminLink();
});
