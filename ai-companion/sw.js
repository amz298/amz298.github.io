// 只缓存 App 壳子（静态文件）。
// 采用「网络优先」：重传后手机立刻拿到新版，只有断网时才回退到缓存。
// 聊天内容和 API key 都存在设备 localStorage，不会被缓存到别处。
const CACHE = 'ai-companion-v8';
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
  // API 请求不拦截、不缓存
  if (url.pathname.includes('/chat/completions') || url.pathname.includes('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const cp = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, cp));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});