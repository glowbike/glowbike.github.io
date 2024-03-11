// Files to cache
const cacheName = 'GlowBike-v1';

const contentToCache = [
    "./",
    "./help",
    "./help/index.html",
    "./icon.192.png",
    "./icon.512.png",
    "./index.html",
    "./js",
    "./js/Ble.html",
    "./js/Ble.js",
    "./js/BleGlowBike.html",
    "./js/BleGlowBike.js",
    "./manifest.json",
    "./screenshot1.png",
    "./screenshot2.jpg",
    "./third-party",
    "./third-party/reinvented-color-wheel.min.css",
    "./third-party/reinvented-color-wheel.min.js",
    "./third-party/tiny-popup-menu.js",
    "./third-party/tiny-popup-menu.min.css",
];

// Installing Service Worker
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Install');
    e.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        console.log('[Service Worker] Caching all');
        await cache.addAll(contentToCache);
    })());
});

// Fetching content using Service Worker
self.addEventListener('fetch', (e) => {
    // Cache http and https only, skip unsupported chrome-extension:// and file://...
    if (!(
       e.request.url.startsWith('http:') || e.request.url.startsWith('https:')
    )) {
        return; 
    }

    e.respondWith((async () => {
        // try to get online version and update local cache
        try
        {
            console.log(`[Service Worker] Fetching live resource: ${e.request.url}`);

            const response = await fetch(e.request);
            const cache = await caches.open(cacheName);

            console.log(`[Service Worker] Caching live resource: ${e.request.url}`);
            cache.put(e.request, response.clone());
        }
        catch (e)
        {
            console.log(`[Service Worker] Fetch ERR: ${e}`);
        }

        // whether or not online version freshened up the cache, serve from cache
        console.log(`[Service Worker] Returning cached resource: ${e.request.url}`);
        const r = await caches.match(e.request);

        return r;
    })());
});