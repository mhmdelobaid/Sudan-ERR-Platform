// public/sw.js
// Dynamic cache versioning: Increment this version number when deploying to invalidate old caches
// The service worker file itself will be updated on deployment, triggering a new install
const CACHE_VERSION = '6'; // Increment this on each deployment to invalidate old caches
const CACHE_NAME = `offline-chatbot-cache-v${CACHE_VERSION}`;

// Static assets to pre-cache (excluding HTML pages for network-first strategy)
const urlsToCache = [
  '/styles/globals.css',
  '/favicon.ico',
  '/manifest.json',
  '/locales/en/login.json',
  '/locales/ar/login.json',
  '/locales/es/login.json',
  '/locales/en/home.json',
  '/locales/ar/home.json',
  '/locales/es/home.json',
  '/',            // the calculator: opening the app with no network still starts here (the code is asked for first)
  '/offline-mode' // offline mode (F4 reports kept on the phone)
];

// Pages kept fresh in the cache, for opening the app with no network. Neither holds personal data: the
// calculator and the offline form are drawn on the phone. Other pages are never cached.
const OFFLINE_PAGES = ['/', '/offline-mode', '/en', '/en/offline-mode'];

// Install event: cache static assets only
self.addEventListener('install', (event) => {
  console.log('Service Worker: Install event triggered with cache version:', CACHE_VERSION);
  // No skipWaiting here: the app shows "update available" and the person taps it (SKIP_WAITING message
  // below), so a form being filled is never reloaded under them.
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache:', CACHE_NAME);
        return Promise.all(
          urlsToCache.map((url) =>
            cache.add(url).catch((err) => console.error(`Failed to cache ${url}:`, err))
          )
        );
      })
      .then(() => {
        console.log('Static assets cached successfully');
      })
      .catch((error) => console.error('Failed to cache assets on install:', error))
  );
});

// Helper function to check if request is for HTML page
function isHTMLRequest(request) {
  return request.mode === 'navigate' || 
         request.headers.get('accept')?.includes('text/html') ||
         request.url.endsWith('/') ||
         !request.url.includes('.');
}

// Fetch event: network-first for HTML, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle this app's own GET requests for pages and static files.
  // API calls (our /api routes, and Supabase on its own host) always go
  // straight to the network, so a failed call can never be answered with
  // the cached offline page.
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  const isHTML = isHTMLRequest(request);

  // Network-first strategy for HTML pages
  if (isHTML) {
    event.respondWith(
      // Whatever the server answers is passed on as it is: a page, an error page, or a redirect such as a login
      // page in front of a test site. Only a good answer for one of OFFLINE_PAGES is kept, to replace the copy.
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic' && OFFLINE_PAGES.includes(url.pathname)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() => {
          // No network at all: the same page if it's kept, otherwise the calculator (so the code is asked for
          // first and the disguise holds), and offline mode only if the calculator was never kept.
          console.log('Network request failed, trying cache for:', request.url);
          return caches.match(url.pathname)
            .then((hit) => hit || caches.match('/'))
            .then((hit) => hit || caches.match('/offline-mode'))
            .then((hit) => hit || new Response('Offline page not available.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            }));
        })
    );
  } else {
    // Cache-first strategy for static assets (CSS, JS, images, locales, etc.)
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          // Not in cache, fetch from network
          return fetch(request)
            .then((fetchResponse) => {
              // Only cache successful responses
              if (fetchResponse && fetchResponse.status === 200) {
                const responseToCache = fetchResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  // Cache static assets for offline use
                  if (request.url.includes('/locales/') || 
                      request.url.includes('/_next/static/') ||
                      request.url.includes('/styles/') ||
                      request.url.includes('.css') ||
                      request.url.includes('.js') ||
                      request.url.includes('.png') ||
                      request.url.includes('.jpg') ||
                      request.url.includes('.jpeg') ||
                      request.url.includes('.svg')) {
                    cache.put(request, responseToCache);
                  }
                });
              }
              return fetchResponse;
            })
            .catch(() => {
              // If offline and not in cache, return appropriate response
              if (request.url.includes('/locales/')) {
                return new Response(JSON.stringify({}), {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' },
                });
              }
              return new Response('Resource not available offline.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' },
              });
            });
        })
    );
  }
});

// Activate event: remove old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activate event triggered');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // Delete all caches that don't match the current cache name
      const deletePromises = cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => {
          console.log('Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        });
      
      // Claim all clients immediately to activate the new service worker
      return Promise.all([...deletePromises, self.clients.claim()]);
    })
    .then(() => {
      console.log('Service Worker activated, old caches cleared');
      // Notify all clients that the service worker has been updated
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_UPDATED',
            cacheVersion: CACHE_VERSION
          });
        });
      });
    })
  );
});

// The person tapped "update" in the app: switch to this new version now.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
