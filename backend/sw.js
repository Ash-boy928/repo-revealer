// TeleBot Progressive Web App Service Worker
// Version: telebot-core-v13
// Handles offline caching for core static assets, fonts, and icons

const STATIC_CACHE = 'telebot-static-v13';
const DATA_CACHE = 'telebot-data-v13';
const FONT_CACHE = 'telebot-fonts-v13';
const ALL_CACHES = [STATIC_CACHE, DATA_CACHE, FONT_CACHE];

const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png'
];

// Install Event: Precache core static assets and immediately activate
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((assetUrl) =>
          cache.add(assetUrl).catch((err) => {
            console.warn('[SW] Precache note for:', assetUrl, err.message);
          })
        )
      );
    })
  );
});

// Activate Event: Clear obsolete caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!ALL_CACHES.includes(key)) {
            console.log('[SW] Evicting outdated cache store:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Intelligent routing for pages, assets, fonts, and API data
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Skip SSE, WebSocket, and internal streaming endpoints
  if (
    url.pathname.startsWith('/sse') ||
    url.pathname.startsWith('/ws') ||
    req.headers.get('accept')?.includes('text/event-stream')
  ) {
    return;
  }

  // 2. Pass Non-GET requests and page navigations directly to network
  if (req.method !== 'GET' || req.mode === 'navigate') {
    return;
  }

  // 3. Never cache HTML pages or auth/API endpoints - always fetch fresh over network!
  if (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/login' ||
    url.pathname === '/login.html' ||
    url.pathname === '/dashboard' ||
    url.pathname === '/dashboard.html' ||
    url.pathname === '/admin' ||
    url.pathname === '/admin.html' ||
    url.pathname === '/logout' ||
    url.pathname === '/landing' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/whoami')
  ) {
    return; // Pass through to browser network directly without SW caching
  }

  // 3. Google Fonts & Web Font Files: Cache-First with Stale-While-Revalidate
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          const fetchPromise = fetch(req)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(req, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 4. Local Static Icons & Manifest: Cache-First with Network fallback
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico' ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.jpg')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, cloned));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 5. Read-Only API Endpoints: Network-First with Cache fallback
  if (
    url.pathname.startsWith('/api/accounts') ||
    url.pathname.startsWith('/whoami') ||
    url.pathname.startsWith('/api/view-banner') ||
    url.pathname.startsWith('/api/user/sent-dms') ||
    url.pathname.startsWith('/api/user/skipped-users') ||
    url.pathname.startsWith('/api/account/config') ||
    url.pathname.startsWith('/api/account/proxy') ||
    url.pathname.startsWith('/api/logs')
  ) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, cloned));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) {
            return cached;
          }
          // Synthetic fallback when completely empty and offline
          return new Response(
            JSON.stringify({
              ok: true,
              offline: true,
              cached: false,
              accounts: [],
              total_sent: 0,
              msg: 'Offline Mode: Displaying offline state'
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'X-Telebot-Offline': '1' }
            }
          );
        })
    );
    return;
  }

  // 6. HTML Navigation & Page Requests: Network-First with Offline Page Fallback
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(req, cloned);
              // If this is the dashboard, also keep explicit keys for both /dashboard and /dashboard.html
              if (url.pathname === '/dashboard' || url.pathname === '/dashboard.html') {
                cache.put('/dashboard', networkResponse.clone());
                cache.put('/dashboard.html', networkResponse.clone());
              }
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Low-connectivity or offline: retrieve cached shell
          const cachedDirect = await caches.match(req);
          if (cachedDirect) return cachedDirect;

          // Check if user was accessing dashboard
          if (url.pathname.includes('dashboard')) {
            const cachedDash = (await caches.match('/dashboard')) || (await caches.match('/dashboard.html'));
            if (cachedDash) return cachedDash;
          }

          // Check if user was on landing or login
          if (url.pathname === '/' || url.pathname.includes('landing')) {
            const cachedLanding = (await caches.match('/landing.html')) || (await caches.match('/'));
            if (cachedLanding) return cachedLanding;
          }

          if (url.pathname.includes('login')) {
            const cachedLogin = (await caches.match('/login.html')) || (await caches.match('/login'));
            if (cachedLogin) return cachedLogin;
          }

          // Fallback to any available cached shell
          const anyDash = (await caches.match('/dashboard.html')) || (await caches.match('/dashboard'));
          if (anyDash) return anyDash;

          const anyLogin = (await caches.match('/login.html')) || (await caches.match('/login'));
          if (anyLogin) return anyLogin;

          return new Response(
            `<!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Offline - Leo TeleBot</title>
              <style>
                body { background: #0c131d; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
                .card { background: rgba(22, 33, 48, 0.9); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 20px; padding: 36px 24px; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                h2 { color: #38bdf8; margin: 0 0 12px; font-size: 22px; }
                p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
                button { background: #0284c7; color: #fff; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
                button:hover { background: #0369a1; }
              </style>
            </head>
            <body>
              <div class="card">
                <div style="font-size: 48px; margin-bottom: 12px;">📡</div>
                <h2>You're Offline</h2>
                <p>Leo TeleBot dashboard cannot connect to the network right now. Please check your internet connection.</p>
                <button onclick="window.location.reload()">Retry Connection</button>
              </div>
            </body>
            </html>`,
            {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
          );
        })
    );
    return;
  }

  // 7. Default Stale-While-Revalidate for other GET requests
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, cloned));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Message Event: Instant cache clearing requested by web client
self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHES' || event.data?.action === 'CLEAR_CACHES') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
