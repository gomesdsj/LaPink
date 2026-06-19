var registerForm    = document.getElementById('registerForm');
var registerMessage = document.getElementById('registerMessage');

function setRegisterMessage(text, success) {
  if (!registerMessage) return;
  registerMessage.textContent = text;
  registerMessage.style.color = success ? '#1e7e34' : '#c82333';
}

if (registerForm) {
  registerForm.addEventListener('submit', function(event) {
    event.preventDefault();
    _doRegister();
  });
}

async function _doRegister() {
  var name     = document.getElementById('register-name').value.trim();
  var email    = document.getElementById('register-email').value.trim().toLowerCase();
  var whatsapp = document.getElementById('register-whatsapp').value.trim();
  var password = document.getElementById('register-password').value;
  var confirm  = document.getElementById('register-password-confirm').value;

  if (!name || !email || !whatsapp || !password || !confirm) {
    setRegisterMessage('Preencha todos os campos.', false);
    return;
  }

  if (password.length < 6) {
    setRegisterMessage('A senha deve ter no mínimo 6 caracteres.', false);
    return;
  }

  if (password !== confirm) {
    setRegisterMessage('As senhas não conferem.', false);
    return;
  }

  var clients = getClients();
  if (clients.some(function(c) { return c.email === email; })) {
    setRegisterMessage('Este e-mail já está cadastrado.', false);
    return;
  }

  setRegisterMessage('Processando...', true);

  var hash;
  try {
    hash = await hashPassword(password);
  } catch (err) {
    setRegisterMessage('Erro ao processar senha. Tente novamente.', false);
    console.error('[LaPink] hashPassword falhou:', err);
    return;
  }

  clients.push({
    name:       name,
    email:      email,
    whatsapp:   whatsapp,
    password:   hash,
    totalSpent: 0,
    purchases:  []
  });
  saveClients(clients);

  try { sessionStorage.setItem('referrerPage', 'minha-conta.html'); } catch (e) {}

  setRegisterMessage('Cadastro realizado! Redirecionando...', true);
  setTimeout(function() { location.href = 'login.html'; }, 1200);
}
