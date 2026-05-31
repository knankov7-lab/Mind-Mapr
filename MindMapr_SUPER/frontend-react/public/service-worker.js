// Service Worker for MindMapr PWA
// Bump cache version when deployment behavior changes.
const CACHE_NAME = 'mindmapr-v2';
const urlsToCache = ['/manifest.json'];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch(() => {
        // Silently fail if cache.addAll errors
        console.log('Cache addAll completed with some failures (expected)');
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API calls - always go to network
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  const isNavigationRequest = event.request.mode === 'navigate';

  // For SPA document navigations use network-first to avoid stale index.html.
  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put('/index.html', copy).catch(() => {});
          });
          return response;
        })
        .catch(() => {
          return caches.match('/index.html').then((cached) => {
            return cached || new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request).then((networkResponse) => {
        const shouldCache = networkResponse && networkResponse.status === 200;
        if (shouldCache) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy).catch(() => {});
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      return new Response('Offline', { status: 503 });
    })
  );
});
