/* LaPink — Sidebar toggle compartilhado */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
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
