var CACHE_NAME = 'lapink-v2';
var ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/produto.html',
  '/css/Principal.css',
  '/css/componentes.css',
  '/css/PrincipalPublica.css',
  '/css/public.css',
  '/js/storage.js',
  '/js/auth.js',
  '/manifest.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(async function() {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const res = await fetch(event.request);
      if (res && res.status === 200 && res.type !== 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, res.clone());
      }
      return res;
    } catch {
      return caches.match('/index.html');
    }
  }());
});
