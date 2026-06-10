const loginLink = document.getElementById('loginLink');
const navUser = document.getElementById('navUser');
const logoutBtn = document.getElementById('logoutBtn');

// Salvar página de origem ao clicar em login
if (loginLink) {
  loginLink.addEventListener('click', () => {
    sessionStorage.setItem('referrerPage', window.location.pathname.split('/').pop() || 'index.html');
  });
}

function updateNav() {
  const client = getLoggedClient();
  if (client && client.name) {
    navUser.textContent = `Olá, ${client.name.split(' ')[0]}`;
    if (loginLink) loginLink.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    if (navUser) navUser.textContent = '';
    if (loginLink) loginLink.style.display = 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

function handleBuy(event) {
  const client = getLoggedClient();
  const product = event.target.dataset.product;
  if (!client) {
    alert('Você precisa estar logada para comprar. Redirecionando para login...');
    location.href = 'login.html';
    return;
  }
  alert(`Compra autorizada para ${client.name}!\nProduto: ${product}`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-buy').forEach(button => {
      button.addEventListener('click', handleBuy);
    });
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearLoggedClient();
        updateNav();
        alert('Você saiu da conta.');
      });
    }
    updateNav();
  });
} else {
  document.querySelectorAll('.btn-buy').forEach(button => {
    button.addEventListener('click', handleBuy);
  });
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearLoggedClient();
      updateNav();
      alert('Você saiu da conta.');
    });
  }
  updateNav();
}
