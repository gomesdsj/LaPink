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

async function _doLogin() {
  var email         = document.getElementById('login-email').value.trim().toLowerCase();
  var loginPassword = document.getElementById('login-password').value;

  var referrerPage = 'index.html';
  try { referrerPage = sessionStorage.getItem('referrerPage') || 'index.html'; } catch(e) {}

  var hashedInput;
  try {
    hashedInput = await hashPassword(loginPassword);
  } catch (err) {
    setLoginMessage('Erro ao processar senha. Tente novamente.', false);
    console.error('[LaPink] hashPassword falhou:', err);
    return;
  }

  var clients = getClients();
  var client  = null;

  // Tenta com hash SHA-256
  client = clients.find(function(c) { return c.email === email && c.password === hashedInput; });

  // Fallback: texto puro (contas antigas) — migra para hash
  if (!client) {
    var plainClient = clients.find(function(c) { return c.email === email && c.password === loginPassword; });
    if (plainClient) {
      plainClient.password = hashedInput;
      saveClients(clients);
      client = plainClient;
    }
  }

  // Fallback: usuário criado pelo painel admin (lapinkUsers) — SHA-256 ou btoa legado
  if (!client) {
    try {
      var users = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
      var found = users.find(function(u) {
        return u.email === email && (u.password === hashedInput || u.password === btoa(loginPassword));
      });
      if (found) {
        if (found.password === btoa(loginPassword) && found.password !== hashedInput) {
          found.password = hashedInput;
          localStorage.setItem('lapinkUsers', JSON.stringify(users));
        }
        client = { email: found.email, name: found.name, role: found.role || 'client' };
      }
    } catch(e) {}
  }

  if (!client) {
    setLoginMessage('E-mail ou senha incorretos.', false);
    return;
  }

  setLoggedClient(client);
  setLoginMessage('Login realizado! Redirecionando...', true);
  setTimeout(function() {
    try { sessionStorage.removeItem('referrerPage'); } catch(e) {}
    location.href = referrerPage;
  }, 1200);
}
