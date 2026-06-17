function showToast(msg) {
  let el = document.getElementById('_lapink_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_lapink_toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(function() { el.style.display = 'none'; }, 2800);
}

function updateAuthUI() {
  var client = getLoggedClient();

  function show(id, val) {
    var el = document.getElementById(id);
    if (el) el.style.display = val;
  }
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  if (client && client.name) {
    setText('navUser', 'Olá, ' + client.name.split(' ')[0]);
    show('loginLink', 'none');
    show('logoutBtn', 'inline-flex');
    show('loginBtn', 'none');
    show('registerBtn', 'none');
    show('drawerLoginBtn', 'none');
    show('drawerRegisterBtn', 'none');
  } else {
    setText('navUser', '');
    show('loginLink', 'inline-flex');
    show('logoutBtn', 'none');
    show('loginBtn', 'inline-block');
    show('registerBtn', 'inline-block');
    show('drawerLoginBtn', '');
    show('drawerRegisterBtn', '');
  }
}

document.addEventListener('DOMContentLoaded', function() {
  var saveReferrer = function() {
    sessionStorage.setItem('referrerPage', window.location.pathname.split('/').pop() || 'index.html');
  };

  ['loginLink', 'loginBtn', 'registerBtn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', saveReferrer);
  });

  updateAuthUI();

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      clearLoggedClient();
      updateAuthUI();
      showToast('Você saiu da conta.');
    });
  }
});
