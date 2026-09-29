// Поднимаем версию, чтобы браузер выкинул старый кэш
const CACHE_VERSION = 'bible-v4';
const STATIC = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './data/books.json',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_VERSION).then(c =>
            Promise.all(STATIC.map(url => c.add(url).catch(() => null)))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET') return;
    if (url.origin !== location.origin) return;

    // Данные Библии — сначала кэш, потом сеть
    if (url.pathname.includes('/data/') || url.pathname.endsWith('.json')) {
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
                }
                return res;
            }))
        );
        return;
    }

    // Всё остальное — сеть, при неудаче кэш
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});