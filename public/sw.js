const CACHE_NAME = 'lapink-cache-v1';
const ASSETS = [
  '/',
  '/V1.html',
  '/index.html',
  '/css/v1.css',
  '/css/Principal.css',
  '/js/v1.js',
  '/js/storage.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      return caches.open(CACHE_NAME).then(cache => { cache.put(event.request, res.clone()); return res; });
    }).catch(() => {
      // fallback to cache root
      return caches.match('/');
    }))
  );
});
