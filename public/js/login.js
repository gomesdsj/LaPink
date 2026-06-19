const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const referrerPage = sessionStorage.getItem('referrerPage') || 'index.html';

function setLoginMessage(text, success = false) {
  if (!loginMessage) return;
  loginMessage.textContent = text;
  loginMessage.style.color = success ? '#1e7e34' : '#c82333';
}

if (loginForm) {
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();

    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const loginPassword = document.getElementById('login-password').value;
    const hashedInput = await hashPassword(loginPassword);
    const clients = getClients();

    // Tenta com hash primeiro
    var client = clients.find(function(c) { return c.email === email && c.password === hashedInput; });

    // Fallback: texto puro (contas antigas) — migra para hash
    if (!client) {
      var plainClient = clients.find(function(c) { return c.email === email && c.password === loginPassword; });
      if (plainClient) {
        plainClient.password = hashedInput;
        saveClients(clients);
        client = plainClient;
      }
    }

    // Fallback: usuários criados pelo painel admin (lapinkUsers, senha btoa)
    if (!client) {
      try {
        var users = JSON.parse(localStorage.getItem('lapinkUsers') || '[]');
        var found = users.find(function(u) {
          return u.email === email && u.password === btoa(loginPassword);
        });
        if (found) {
          client = { email: found.email, name: found.name, role: found.role || 'client' };
        }
      } catch(e) {}
    }

    if (!client) {
      setLoginMessage('E-mail ou senha incorretos.', false);
      return;
    }

    setLoggedClient(client);
    setLoginMessage('Login realizado com sucesso! Redirecionando...', true);
    setTimeout(() => {
      sessionStorage.removeItem('referrerPage');
      location.href = referrerPage;
    }, 1200);
  });
}
