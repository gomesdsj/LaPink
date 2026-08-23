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
