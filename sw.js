// 版本升級至 v1.10（本機儲存版），網路優先 (Network First) 策略
const CACHE_NAME = 'learn-record-v1.10';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

// 安裝：快取核心資源
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache.map(u => new Request(u, { cache: 'reload' }))))
      .catch(err => console.error('快取安裝失敗:', err))
  );
});

// 啟動：清理舊快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('刪除舊快取:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 攔截請求：網路優先策略
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 跳過非 GET 請求和 Google API 請求
  if (event.request.method !== 'GET' || url.hostname.includes('googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })   // 略過瀏覽器 HTTP 快取，確保拿到最新檔案
      .then(networkResponse => {
        // 成功取得網路回應，更新快取
        return caches.open(CACHE_NAME).then(cache => {
          // 添加 catch 防止跨域 opaque response 導致未處理的 rejection
          cache.put(event.request, networkResponse.clone()).catch(() => {});
          return networkResponse;
        });
      })
      .catch(() => {
        // 網路失敗，回退到快取
        return caches.match(event.request);
      })
  );
});
