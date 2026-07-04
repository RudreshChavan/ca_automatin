// Service Worker — CA Administration PWA
const CACHE_NAME = 'ca-admin-v1';
const STATIC_ASSETS = ['/', '/dashboard', '/admin', '/billing', '/css/style.css', '/js/api.js', '/js/auth.js', '/js/dashboard.js', '/js/admin.js', '/js/billing.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) return; // Don't cache API calls
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
