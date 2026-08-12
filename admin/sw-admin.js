/* LaPink — Service Worker do painel admin (v1)
 *
 * Objetivo: deixar a troca entre as abas do painel instantânea.
 *
 * O que ele NÃO faz, de propósito:
 *   • não guarda HTML. Toda a lógica de cada tela do painel vive dentro do
 *     próprio .html, então servir HTML do cache poderia rodar uma versão
 *     antiga do painel depois de um deploy. Navegação sempre vai à rede.
 *   • não guarda nada de outros domínios. O SDK do Firebase (gstatic) e os
 *     ícones (jsdelivr) já vêm com cache longo do próprio CDN, e guardar
 *     resposta opaca aqui só traria risco de cachear erro sem perceber.
 *
 * O que ele faz: CSS/JS/fontes do próprio site passam a ser servidos na
 * hora, do cache, e atualizados em segundo plano (stale-while-revalidate).
 * Esses arquivos vinham com max-age de 10 minutos, então a cada troca de
 * aba depois desse prazo havia uma ida ao servidor por arquivo só para
 * ouvir "não mudou".
 */

var CACHE = 'lapink-admin-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.indexOf('lapink-admin-') === 0 && k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

/* Permite desligar o cache do painel pela página de diagnóstico */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'LIMPAR_CACHE') {
    caches.delete(CACHE);
  }
});

function ehAssetCacheavel(req) {
  if (req.method !== 'GET') return false;
  if (req.mode === 'navigate') return false;

  var url;
  try { url = new URL(req.url); } catch (e) { return false; }

  if (url.origin !== self.location.origin) return false;   // só o próprio site
  if (/\.html?$/i.test(url.pathname)) return false;        // HTML nunca

  return /\.(css|js|woff2?|ttf|otf|eot|svg|png|jpe?g|webp|gif|ico)$/i.test(url.pathname);
}

self.addEventListener('fetch', function (e) {
  if (!ehAssetCacheavel(e.request)) return; // deixa passar direto para a rede

  e.respondWith(
    caches.match(e.request).then(function (cacheado) {
      var daRede = fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return cacheado; // offline: usa o que tiver
      });

      // Responde na hora com o cache e atualiza em segundo plano.
      return cacheado || daRede;
    })
  );
});
