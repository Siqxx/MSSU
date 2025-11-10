const CACHE_NAME = 'mssu-cache-v1';
const FILES_TO_CACHE = [
  '/index.html','/admin.html','/logistics.html','/operation.html','/functional.html','/others.html',
  '/style.css','/script.js','/manifest.json'
];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(FILES_TO_CACHE)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
