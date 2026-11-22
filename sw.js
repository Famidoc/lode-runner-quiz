const CACHE_NAME = 'lr-quiz-v10';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/apple-touch-icon.png',
  './js/config.js',
  './js/audio.js',
  './js/storage.js',
  './js/qrcode.js',
  './js/leaderboard.js',
  './js/dataLoader.js',
  './js/sudokuEngine.js',
  './js/pathfinding.js',
  './js/engine.js',
  './js/renderer.js',
  './js/quizModal.js',
  './js/main.js',
  './data/levels.json',
  './data/plants.json',
  './data/sudoku.json',
  './data/medical.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirst(request, { cacheKeyOverride = null, fallbackUrl = null } = {}) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      await cache.put(cacheKeyOverride || request, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl, { ignoreSearch: true });
      if (fb) return fb;
    }
    throw _;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const res = await fetch(request);
  if (res && res.status === 200) {
    await cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // 僅攔截目前 PWA 作用域下的請求，避免影響同網域其他專案（如 /plants/、/sudoku/）
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      networkFirst(event.request, {
        cacheKeyOverride: './index.html',
        fallbackUrl: './index.html'
      })
    );
    return;
  }

  const trimmedScope = scopePath.replace(/\/$/, '');
  const isAppCodeOrData =
    /\.(html|js|css|json)$/i.test(url.pathname) ||
    url.pathname === scopePath ||
    url.pathname === trimmedScope;

  if (isAppCodeOrData) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
