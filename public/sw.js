/* LaPink — Service Worker v5 */
var CACHE = 'lapink-v5';

/* Arquivos essenciais pré-cacheados na instalação */
var PRECACHE = [
  './V1.html',
  './manifest.json',
  './css/v1.css',
  './js/storage.js',
  './js/auth.js',
  './js/cart.js',
  './js/v1.js',
  './assets/icon.svg'
];

/* ── Instalação: pré-cache do shell ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) {
        return Promise.allSettled(
          PRECACHE.map(function(url) {
            return c.add(url).catch(function() {
              /* ignora falhas individuais para não bloquear a instalação */
            });
          })
        );
      })
      .then(function() { return self.skipWaiting(); })
  );
});

/* ── Ativação: remove caches antigos ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* ── Fetch: network-first para HTML e dados, cache-first para assets ── */
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = e.request.url;

  /* Ignora requisições de outras origens (CDN, APIs externas) */
  if (!url.startsWith(self.location.origin)) return;

  /* HTML (navegação) e dados dinâmicos: network-first para garantir versão atual */
  if (e.request.mode === 'navigate' || url.includes('/data/') || url.includes('/admin/')) {
    e.respondWith(
      fetch(e.request)
        .then(function(res) {
          if (res && res.ok) {
            var clone = res.clone();
            caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
          }
          return res;
        })
        .catch(function() {
          /* Offline: retorna versão cacheada */
          return caches.match(e.request).then(function(cached) {
            return cached || caches.match('./V1.html');
          });
        })
    );
    return;
  }

  /* Assets estáticos (CSS, JS, imagens): cache-first, atualiza em background */
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) {
        fetch(e.request).then(function(res) {
          if (res && res.ok) {
            caches.open(CACHE).then(function(c) { c.put(e.request, res); });
          }
        }).catch(function() {});
        return cached;
      }
      return fetch(e.request).then(function(res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      }).catch(function() {});
    })
  );
});
