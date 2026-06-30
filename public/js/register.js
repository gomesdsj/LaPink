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

  // Validação de e-mail básica
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setRegisterMessage('E-mail inválido.', false);
    return;
  }

  // Validação de WhatsApp — mínimo 10 dígitos
  var waDigits = whatsapp.replace(/\D/g, '');
  if (waDigits.length < 10 || waDigits.length > 15) {
    setRegisterMessage('WhatsApp inválido. Use formato: (11) 99999-9999.', false);
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

  var newClient = {
    name:       name,
    email:      email,
    whatsapp:   whatsapp,
    password:   hash,
    totalSpent: 0,
    purchases:  []
  };
  clients.push(newClient);
  saveClients(clients);

  // Cria a conta também no Firebase Authentication (se ativo). Silencioso:
  // se o provedor estiver desativado ou já existir, segue com o cadastro local.
  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      var cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      var uid = cred.user && cred.user.uid;
      try {
        await firebase.firestore().collection('usuarios').doc(uid).set({
          email: email, name: name, whatsapp: whatsapp, role: 'client', createdAt: Date.now()
        }, { merge: true });
      } catch (e) {}
    }
  } catch (e) { /* email-already-in-use / provedor off / senha curta — ignora */ }

  setLoggedClient({ name: name, email: email, role: 'client' });

  setRegisterMessage('Cadastro realizado! Entrando na loja...', true);
  setTimeout(function() { location.href = 'V1.html'; }, 900);
}
