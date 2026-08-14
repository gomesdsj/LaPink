var registerForm    = document.getElementById('registerForm');
var registerMessage = document.getElementById('registerMessage');

function setRegisterMessage(text, success) {
  if (!registerMessage) return;
  registerMessage.textContent = text;
  registerMessage.className = 'form-message show ' + (success ? 'success' : 'error');
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

  var aceiteEl = document.getElementById('register-aceite');
  if (aceiteEl && !aceiteEl.checked) {
    setRegisterMessage('Você precisa aceitar a Política de Privacidade e os Termos de Uso para se cadastrar.', false);
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

  // Proteção contra criação em massa de contas do mesmo IP
  var limite = await verificarLimiteIP('registro');
  if (limite.bloqueado) {
    setRegisterMessage('Muitas tentativas de cadastro. Tente novamente em ' + limite.retryAfterMin + ' min.', false);
    return;
  }

  var clients = getClients();
  if (clients.some(function(c) { return (c.email || '').toLowerCase() === email; })) {
    setRegisterMessage('Este e-mail já está cadastrado.', false);
    return;
  }

  setRegisterMessage('Processando...', true);

  var hash;
  try {
    hash = await hashPasswordSalted(password);
  } catch (err) {
    setRegisterMessage('Erro ao processar senha. Tente novamente.', false);
    console.error('[LaPink] hashPasswordSalted falhou:', err);
    return;
  }

  // Cria a conta no Firebase Authentication ANTES do cadastro local.
  // Se o e-mail já existir na nuvem com OUTRA senha, avisa em vez de criar
  // uma conta local divergente (que só funcionaria neste navegador).
  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        var cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        var uid = cred.user && cred.user.uid;
        try {
          await firebase.firestore().collection('usuarios').doc(uid).set({
            email: email, name: name, whatsapp: whatsapp, role: 'client', createdAt: Date.now()
          }, { merge: true });
        } catch (e) {}
      } catch (e) {
        if (e && e.code === 'auth/email-already-in-use') {
          // Conta já existe na nuvem — só prossegue se a senha informada confere
          try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
          } catch (e2) {
            setRegisterMessage('Este e-mail já possui conta. Use "Entrar" ou recupere a senha.', false);
            return;
          }
        }
        /* provedor desativado / outros erros — segue com o cadastro local */
      }
    }
  } catch (e) {}

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

  // Conta criada de fato → consome uma unidade do limite deste IP. Para
  // cadastro o abuso é a criação em MASSA de contas, então o que conta é o
  // sucesso, não a falha (antes, a simples consulta é que contava, e formar
  // um cadastro válido cinco vezes bloqueava a rede inteira por 1 hora).
  try { registrarFalhaLimiteIP('registro'); } catch (e) {}

  setLoggedClient({ name: name, email: email, role: 'client' });

  // E-mail de boas-vindas com o desconto — configurável/desativável no admin
  // (Configurações → E-mail de boas-vindas). Falha silenciosa.
  if (typeof window.enviarEmailBoasVindas === 'function') {
    window.enviarEmailBoasVindas(email, name);
  }

  setRegisterMessage('Cadastro realizado! Entrando na loja...', true);
  setTimeout(function() { location.href = 'V1.html'; }, 900);
}
