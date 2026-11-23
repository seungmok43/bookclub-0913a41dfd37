/* BooKLove service worker — app shell cache for a fast start and offline reading of pages already visited.
   Rules:
   - Only GET requests inside this site's scope (plus the jsdelivr font CDN) are ever cached.
   - NEVER cached: anything on supabase.co (login, reviews, attendance, comments), any request carrying an
     Authorization / apikey header, and any URL that mentions a token. Those always go to the network.
   - Pages (HTML): network first, cached copy when offline. Other files: cached copy at once, refreshed behind.
   - Bump VERSION to drop old caches (cleaned on activate). */
var VERSION = 'blk-v4-20261123z';
var SHELL = [
  './', 'v2/style.css?v=20261122d', 'v2/app.js?v=20261122d', 'v2/data.js', 'v2/groups.js', 'v2/gate.js',
  'v2/session.css', 'v2/session.js', 'v2/toc.js', 'community/config.js', 'community/pagecomments.js',
  'manifest.webmanifest', 'assets/icons/icon-192.png', 'assets/img/hero-library-900.jpg',
  'covers/faith-again.jpg', 'covers/what-we-believe.jpg'
];
var FONT_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // one by one, so a single missing file never blocks the install
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('blk-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function never(req, url) {
  if (req.method !== 'GET') return true;
  if (/(^|\.)supabase\.co$/.test(url.hostname)) return true;
  if (req.headers.get('authorization') || req.headers.get('apikey')) return true;
  if (/token/i.test(url.search) || /\/rest\/v1\//.test(url.pathname)) return true;
  return false;
}
function cacheable(res) { return res && (res.status === 200 && (res.type === 'basic' || res.type === 'cors') || res.type === 'opaque'); }

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (never(req, url)) return;                                   // straight to the network, untouched
  var inScope = url.href.indexOf(self.registration.scope) === 0;
  var font = FONT_HOSTS.indexOf(url.hostname) >= 0;
  if (!inScope && !font) return;

  var isPage = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0;
  if (isPage && inScope) {
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') { var cp = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match(self.registration.scope); });
    }));
    return;
  }
  // files: cached copy first, refreshed in the background (stale-while-revalidate)
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) { if (cacheable(res) && (inScope || font)) c.put(req, res.clone()); return res; });
      if (hit) { net.catch(function () { }); return hit; }
      return net;
    });
  }));
});
