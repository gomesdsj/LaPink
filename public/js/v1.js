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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        clearLoggedClient();
        updateNav();
      });
    }
    updateNav();
  });
} else {
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      clearLoggedClient();
      updateNav();
    });
  }
  updateNav();
}
