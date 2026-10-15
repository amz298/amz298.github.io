// 注意：这个 service worker 只缓存 App 壳子（静态文件）。
// 聊天内容和 API key 都存在设备 localStorage 里，不会被缓存到别处。
const CACHE = 'ai-companion-v4';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API 请求不缓存，直接走网络
  if (url.pathname.includes('/chat/completions') || url.pathname.includes('/api/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const cp = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, cp));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});