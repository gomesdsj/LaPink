/* LaPink — Service Worker do painel admin (v2)
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

var CACHE = 'lapink-admin-v2';

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

/* ── Notificação de venda concluída (Web Push) ──────────────────────────
   O service worker já está registrado em TODA página do painel (via
   admin/js/utils.js), então a inscrição pode ser feita de qualquer tela —
   não precisa de um SW separado só para isto. */
self.addEventListener('push', function (e) {
  var dados = {};
  try { dados = e.data ? e.data.json() : {}; } catch (err) {}

  var titulo = dados.title || 'LaPink';
  var opcoes = {
    body: dados.body || '',
    icon: '../public/assets/icon.svg',
    badge: '../public/assets/icon.svg',
    tag: dados.tag || 'lapink-push',
    // Venda é informação que importa — fica na tela até o admin interagir,
    // em vez de sumir sozinha como uma notificação comum.
    requireInteraction: true,
    data: { url: dados.url || './admin.html' }
  };

  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/* Clique na notificação: foca uma aba do painel já aberta (navegando pra
   a página certa) ou abre uma nova se não houver nenhuma. */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var destino = new URL((e.notification.data && e.notification.data.url) || './admin.html', self.location.href).href;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf(self.location.origin) === 0 && 'focus' in lista[i]) {
          if ('navigate' in lista[i]) lista[i].navigate(destino);
          return lista[i].focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
