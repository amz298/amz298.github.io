/* AI 陪伴推送 Service Worker —— 只处理 Web Push（回复 reply / 主动消息 proactive），不拦截页面请求。 */
'use strict';

// 新版 SW 立即接管，避免老版本卡在 waiting
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const Q_NAME = 'ai_push_queue';
const Q_URL = 'https://ai-companion.local/queue.json';
const Q_MAX = 100;
const Q_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function queuePush(payload) {
  const c = await caches.open(Q_NAME);
  const now = Date.now();
  const entries = (await c.keys()).filter((r) => r.url.startsWith(Q_URL + '?id='));
  const recent = [];
  for (const request of entries) {
    const stamp = Number(new URL(request.url).searchParams.get('id').split('-')[0]);
    if (!Number.isFinite(stamp) || now - stamp > Q_MAX_AGE_MS) await c.delete(request);
    else recent.push({ request, stamp });
  }
  recent.sort((a, b) => a.stamp - b.stamp);
  while (recent.length >= Q_MAX) await c.delete(recent.shift().request);
  // Each push has its own entry, so a page reading the queue cannot overwrite
  // a push that arrives at the same time.
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);
  await c.put(Q_URL + '?id=' + id, new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

// 通知打开的页面：队列有新东西（页面据此补消息）
async function notifyClients() {
  const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of cs) {
    try { c.postMessage({ type: 'push-queued' }); } catch (e) {}
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (e) { payload = {}; }

  const isReply = payload.type === 'reply' && payload.text;
  const isProactive = payload.type === 'proactive' && payload.text;

  event.waitUntil((async () => {
    if (!isReply && !isProactive) return;

    try {
      await queuePush(payload);
      await notifyClients();
    } catch (e) {
      // A full browser cache should not suppress the visible notification.
      console.warn('推送缓存写入失败', e);
    }

    // 前台正开着聊天页就不弹横幅（页面自己补消息），否则显示锁屏通知
    const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const visible = cs.some((c) => c.visibilityState === 'visible');
    if (!visible) {
      await self.registration.showNotification(payload.name || 'Ta', {
        // 主动消息是合并成一条推的：body 带全两行；回复仍只取首行保持紧凑
        body: isProactive ? payload.text : payload.text.split('\n')[0],
        icon: 'icon.png',
        badge: 'icon.png',
        // 主动消息多句各一条通知（part 区分，不互相覆盖）
        tag: payload.turnId
          || (payload.id != null && payload.part != null ? payload.id + '-' + payload.part : payload.id)
          || undefined,
        data: { turnId: payload.turnId, id: payload.id, part: payload.part },
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) return c.focus();
    }
    if (self.clients.openWindow) await self.clients.openWindow('./');
  })());
});
