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
  var referrerPage = 'index.html';
  try {
    var _stored = sessionStorage.getItem('referrerPage');
    if (_stored && _isSafeRedirect(_stored)) referrerPage = _stored;
  } catch(e) {}

  var hashedInput;
  try {
    hashedInput = await hashPassword(loginPassword);
  } catch (err) {
    setLoginMessage('Erro ao processar senha. Tente novamente.', false);
    return;
  }

  var clients = getClients();
  var client  = null;

  // SHA-256
  client = clients.find(function(c) { return c.email === email && c.password === hashedInput; });

  // Fallback: texto puro (contas muito antigas) — migra para SHA-256
  if (!client) {
    var plainClient = clients.find(function(c) { return c.email === email && c.password === loginPassword; });
    if (plainClient) {
      plainClient.password = hashedInput;
      saveClients(clients);
      client = plainClient;
    }
  }

  // Usuário criado pelo painel admin (lapinkUsers) — apenas SHA-256
  if (!client) {
    try {
      var users = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
      var found = users.find(function(u) { return u.email === email && u.password === hashedInput; });
      if (found) client = { email: found.email, name: found.name, role: found.role || 'client' };
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

  // Login bem-sucedido: limpa contagem de tentativas
  try { localStorage.removeItem('_loginAttempts'); } catch(e) {}

  setLoggedClient(client);
  setLoginMessage('Login realizado! Redirecionando...', true);
  setTimeout(function() {
    try { sessionStorage.removeItem('referrerPage'); } catch(e) {}
    location.href = referrerPage;
  }, 1200);
}
