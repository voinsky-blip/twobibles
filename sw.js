// sw.js
// Версия кэша. МЕНЯЙТЕ при каждом обновлении данных, чтобы старый кэш удалился.
const CACHE_VERSION = 'v3';
const STATIC_CACHE = `twobibles-static-${CACHE_VERSION}`;
const DATA_CACHE = `twobibles-data-${CACHE_VERSION}`;

// Ресурсы, которые нужны для офлайна
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js'
];

// ---------- INSTALL ----------
self.addEventListener('install', event => {
    self.skipWaiting(); // активировать новый SW сразу
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
    );
});

// ---------- ACTIVATE ----------
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== STATIC_CACHE && key !== DATA_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim()) // взять контроль над открытыми страницами
    );
});

// ---------- FETCH ----------
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // не трогаем сторонние запросы

    // ---- JSON-данные: network-first с обходом HTTP-кэша ----
    if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
        event.respondWith(networkFirstJSON(req));
        return;
    }

    // ---- Остальное: stale-while-revalidate ----
    event.respondWith(staleWhileRevalidate(req));
});

// ---------- Стратегии ----------

async function networkFirstJSON(request) {
    // Ключ кэша — без query-параметра ?v=... чтобы офлайн-фолбэк работал
    const cacheKey = new Request(request.url.split('?')[0], { method: 'GET' });
    try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok) {
            const cache = await caches.open(DATA_CACHE);
            cache.put(cacheKey, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(cacheKey);
        if (cached) return cached;
        return new Response(
            JSON.stringify({ error: 'offline', message: 'Нет сети и нет кэша' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const networkPromise = fetch(request)
        .then(response => {
            if (response && response.ok) {
                const copy = response.clone();
                caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
            }
            return response;
        })
        .catch(() => null);

    return cached || networkPromise || fetch(request);
}