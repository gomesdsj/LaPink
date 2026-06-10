const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const referrerPage = sessionStorage.getItem('referrerPage') || 'index.html';

function setLoginMessage(text, success = false) {
  if (!loginMessage) return;
  loginMessage.textContent = text;
  loginMessage.style.color = success ? '#1e7e34' : '#c82333';
}

if (loginForm) {
  loginForm.addEventListener('submit', event => {
    event.preventDefault();

    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const clients = getClients();
    const client = clients.find(user => user.email === email && user.password === password);

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
