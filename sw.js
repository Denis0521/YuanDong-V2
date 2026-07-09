// 版本號升級至 v18，改用「網路優先 (Network First)」策略，徹底解決手機快取不更新的問題
const CACHE_NAME = 'learn-record-v18';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  // 強制立即接管，不等待舊版 Service Worker 關閉
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // 啟動時立刻清除所有舊版本的快取
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

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // 排除所有跨域 API 請求與非 GET 請求（如 Google 授權與上傳 API），避免快取干擾
  if (event.request.method !== 'GET' || url.hostname.includes('googleapis.com')) {
    return;
  }

  // 【核心修改】網路優先 (Network First) 策略
  // 每次開啟 APP 都會先嘗試抓取最新檔案，如果沒網路才退回使用快取
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // 如果成功抓到最新版，就把最新版存進快取備用
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // 如果沒有網路 (Offline)，才使用之前的快取
        return caches.match(event.request);
      })
  );
});