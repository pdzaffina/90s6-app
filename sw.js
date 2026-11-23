/* 90s6 PWA: cache only public application shell assets, never user or API data. */
const CACHE = '90s6-shell-v1';
const SHELL = ['/', '/shared/app.css', '/icons/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('90s6-shell-') && key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { event.respondWith(fetch(request).catch(() => caches.match('/'))); return; }
  if (SHELL.includes(url.pathname)) event.respondWith(fetch(request).then(response => { if (response.ok && response.type === 'basic') { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); } return response; }).catch(() => caches.match(request)));
});
