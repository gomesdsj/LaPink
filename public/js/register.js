const registerForm = document.getElementById('registerForm');
const registerMessage = document.getElementById('registerMessage');

function setRegisterMessage(text, success = false) {
  if (!registerMessage) return;
  registerMessage.textContent = text;
  registerMessage.style.color = success ? '#1e7e34' : '#c82333';
}

if (registerForm) {
  registerForm.addEventListener('submit', event => {
    event.preventDefault();

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const whatsapp = document.getElementById('register-whatsapp').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-password-confirm').value;

    if (!name || !email || !whatsapp || !password || !confirm) {
      setRegisterMessage('Preencha todos os campos.', false);
      return;
    }

    if (password !== confirm) {
      setRegisterMessage('As senhas não conferem.', false);
      return;
    }

    const clients = getClients();
    if (clients.some(client => client.email === email)) {
      setRegisterMessage('Este e-mail já está cadastrado.', false);
      return;
    }

    clients.push({
      name,
      email,
      whatsapp,
      password,
      totalSpent: 0,
      purchases: [],
    });

    saveClients(clients);
    setRegisterMessage('Cadastro realizado com sucesso! Redirecionando para login...', true);
    setTimeout(() => location.href = 'login.html', 1200);
  });
}
