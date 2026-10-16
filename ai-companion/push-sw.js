/* AI 陪伴推送 Service Worker —— 只处理 Web Push（回复 reply / 主动消息 proactive），不拦截页面请求。 */
'use strict';

const Q_NAME = 'ai_push_queue';
const Q_URL = 'https://ai-companion.local/queue.json';

async function readQueue() {
  const c = await caches.open(Q_NAME);
  const r = await c.match(Q_URL);
  if (!r) return [];
  try { const a = await r.json(); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

async function writeQueue(arr) {
  const c = await caches.open(Q_NAME);
  await c.put(Q_URL, new Response(JSON.stringify(arr.slice(-20)), {
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

    const q = await readQueue();
    q.push(payload);
    await writeQueue(q);
    await notifyClients();

    // 前台正开着聊天页就不弹横幅（页面自己补消息），否则显示锁屏通知
    const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const visible = cs.some((c) => c.visibilityState === 'visible');
    if (!visible) {
      await self.registration.showNotification(payload.name || 'Ta', {
        body: payload.text.split('\n')[0],
        icon: 'icon.png',
        badge: 'icon.png',
        tag: payload.turnId || payload.id || undefined,
        data: { turnId: payload.turnId, id: payload.id },
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
