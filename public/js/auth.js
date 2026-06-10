/**
 * auth.js - Gerenciador de autenticação genérico
 * Detecta sessão do usuário e atualiza elementos de navegação
 */

// Salvar página de origem quando clica em login/cadastro
document.addEventListener('DOMContentLoaded', () => {
  const loginLink = document.getElementById('loginLink');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');

  if (loginLink) {
    loginLink.addEventListener('click', () => {
      sessionStorage.setItem('referrerPage', window.location.pathname.split('/').pop() || 'index.html');
    });
  }
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      sessionStorage.setItem('referrerPage', window.location.pathname.split('/').pop() || 'index.html');
    });
  }
  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      sessionStorage.setItem('referrerPage', window.location.pathname.split('/').pop() || 'index.html');
    });
  }
});

function updateAuthUI() {
  const client = getLoggedClient();
  
  // Elementos de login/logout
  const loginLink = document.getElementById('loginLink');
  const navUser = document.getElementById('navUser');
  const logoutBtn = document.getElementById('logoutBtn');
  
  // Botões de ação
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const panelBtn = document.getElementById('panelBtn');

  if (client && client.name) {
    // Usuário logado
    if (navUser) navUser.textContent = `Olá, ${client.name.split(' ')[0]}`;
    if (loginLink) loginLink.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (loginBtn) loginBtn.style.display = 'none';
    if (registerBtn) registerBtn.style.display = 'none';
  } else {
    // Usuário não logado
    if (navUser) navUser.textContent = '';
    if (loginLink) loginLink.style.display = 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (registerBtn) registerBtn.style.display = 'inline-block';
  }
}

// Atualizar UI ao carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateAuthUI);
} else {
  updateAuthUI();
}

// Listener para logout
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearLoggedClient();
    updateAuthUI();
    alert('Você saiu da conta.');
  });
}
