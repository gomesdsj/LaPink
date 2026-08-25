/* LaPink — Sidebar toggle compartilhado */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var produtosLink = document.querySelector('.sidebar-link[href="cadastro-produto.html"]');
    if (produtosLink && !document.querySelector('.sidebar-link[href="descontos.html"]')) {
      var descontoLink = document.createElement('a');
      descontoLink.className = 'sidebar-link' + (/\/descontos\.html$/.test(location.pathname) ? ' active' : '');
      descontoLink.href = 'descontos.html';
      descontoLink.innerHTML = '<i class="ti ti-discount-2"></i> Descontos';
      produtosLink.insertAdjacentElement('afterend', descontoLink);
    }
    // Remove links repetidos pelo HTML legado e mantém a página atual marcada
    // em um único lugar. O controle de permissão continua vindo de auth.js.
    var vistos = Object.create(null);
    document.querySelectorAll('.sidebar-link[href]').forEach(function(link) {
      var href = link.getAttribute('href');
      if (vistos[href]) { link.remove(); return; }
      vistos[href] = true;
      var atual = location.pathname.replace(/\\/g, '/').split('/').pop() || 'admin.html';
      var aliases = { 'cadastro-cliente.html': 'clientes.html', 'migrar-fotos.html': 'cadastro-produto.html', 'recuperar-fotos.html': 'cadastro-produto.html' };
      atual = aliases[atual] || atual;
      link.classList.toggle('active', href === atual);
    });
    if (typeof applyAdminPermissions === 'function') applyAdminPermissions();
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var toggle  = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;
    function toggleSidebar() {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('show');
    }
    toggle.addEventListener('click', toggleSidebar);
    if (overlay) overlay.addEventListener('click', toggleSidebar);
  });
})();
