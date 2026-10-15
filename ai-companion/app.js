/* AI 陪伴 —— 纯前端 PWA，接入火山方舟（支持识图，需视觉模型） */
(() => {
  'use strict';

  const CFG_KEY = 'ai_companion_config';
  const HIST_KEY = 'ai_companion_history';
  const IMG_MAX = 1024;          // 发送前最长边压缩到 1024px
  const IMG_QUALITY = 0.82;
  const KEEP_IMG_RECENT = 20;    // 只给最近 20 条消息保留图片（省 localStorage）

  const DEFAULTS = {
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    model: '',
    name: '',
    avatar: '',
    persona: '',
    memory: '',
    examples: '',
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    name: $('personaName'), status: $('status'),
    chat: $('chat'), composer: $('composer'), input: $('input'), send: $('send'),
    imgBtn: $('imgBtn'), fileInput: $('fileInput'), previews: $('previews'),
    openSettings: $('openSettings'), closeSettings: $('closeSettings'), mask: $('settingsMask'),
    cfgBase: $('cfgBase'), cfgKey: $('cfgKey'), cfgModel: $('cfgModel'), cfgName: $('cfgName'),
    cfgPersona: $('cfgPersona'), cfgMemory: $('cfgMemory'), cfgExamples: $('cfgExamples'),
    saveSettings: $('saveSettings'), clearChat: $('clearChat'),
    avatarPreview: $('avatarPreview'), avatarBtn: $('avatarBtn'),
    avatarClear: $('avatarClear'), avatarInput: $('avatarInput'),
  };

  let cfg = loadJSON(CFG_KEY, DEFAULTS);
  let history = loadJSON(HIST_KEY, []);   // [{role, content, images?:[dataUri]}]
  let pendingImages = [];                 // 待发送的图片 dataUri
  let busy = false;

  // ---------- 持久化 ----------
  function loadJSON(key, fallback) {
    try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || 'null') || {}) }; }
    catch { return { ...fallback }; }
  }
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  // 只给最近若干条保留图片，旧的降级成「[图片]」文字，防爆 localStorage
  function saveHistory() {
    const flat = history.map((m) => ({ ...m }));
    for (let i = 0; i < flat.length - KEEP_IMG_RECENT; i++) {
      if (flat[i].images && flat[i].images.length) {
        const t = (flat[i].content || '').trim();
        flat[i].content = t ? t + ' [图片]' : '[图片]';
        flat[i].images = [];
      }
    }
    saveJSON(HIST_KEY, flat);
  }

  // ---------- 状态 ----------
  function configured() { return !!(cfg.apiKey && cfg.model); }

  function refresh() {
    el.name.textContent = cfg.name || '还没设人物';
    if (!configured()) {
      el.status.textContent = '未连接（去设置填 API Key 和模型）';
      el.status.className = 'status';
    } else {
      el.status.textContent = cfg.name ? `正在扮演 ${cfg.name}` : '已连接';
      el.status.className = 'status ok';
    }
  }

  // ---------- 图片压缩 ----------
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > IMG_MAX || height > IMG_MAX) {
          const s = Math.min(IMG_MAX / width, IMG_MAX / height);
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL('image/jpeg', IMG_QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  // 头像：中心裁成正方形 96px
  function makeAvatar(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const size = 96;
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2;
        const sy = (img.height - s) / 2;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  function renderAvatarPreview() {
    const p = el.avatarPreview;
    p.style.backgroundImage = cfg.avatar ? 'url(' + cfg.avatar + ')' : '';
    p.textContent = cfg.avatar ? '' : (cfg.name || 'Ta').slice(0, 1);
  }

  function setAvatar(dataUri) {
    cfg.avatar = dataUri;
    saveJSON(CFG_KEY, cfg);
    renderAvatarPreview();
    renderHistory();
  }

  async function onFiles(files) {
    for (const f of Array.from(files || [])) {
      try { pendingImages.push(await compressImage(f)); } catch (e) { console.warn(e); }
    }
    renderPreviews();
  }

  function renderPreviews() {
    el.previews.innerHTML = '';
    if (pendingImages.length === 0) { el.previews.classList.remove('show'); return; }
    el.previews.classList.add('show');
    pendingImages.forEach((src, i) => {
      const w = document.createElement('div');
      w.className = 'preview';
      const img = document.createElement('img');
      img.src = src;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'preview-x';
      x.textContent = '✕';
      x.onclick = () => { pendingImages.splice(i, 1); renderPreviews(); };
      w.appendChild(img); w.appendChild(x);
      el.previews.appendChild(w);
    });
  }

  // ---------- 渲染 ----------
  function addBubble(role, text, images) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    if (role === 'ta') {
      const av = document.createElement('div');
      av.className = 'avatar-img';
      if (cfg.avatar) av.style.backgroundImage = 'url(' + cfg.avatar + ')';
      else av.textContent = (cfg.name || 'Ta').slice(0, 1);
      wrap.appendChild(av);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (text) { const p = document.createElement('span'); p.textContent = text; bubble.appendChild(p); }
    if (images && images.length) {
      const g = document.createElement('div');
      g.className = 'imgs';
      for (const src of images) {
        const im = document.createElement('img');
        im.src = src;
        im.className = 'msg-img';
        g.appendChild(im);
      }
      bubble.appendChild(g);
    }
    wrap.appendChild(bubble);
    el.chat.appendChild(wrap);
    el.chat.scrollTop = el.chat.scrollHeight;
    return wrap;
  }

  function renderHistory() {
    el.chat.innerHTML = '';
    if (history.length === 0) {
      appendHint('还没有对话。设置好人物和 API 后，跟它聊第一句吧。');
    } else {
      for (const m of history) {
        addBubble(m.role === 'user' ? 'me' : 'ta', m.content, m.images);
      }
    }
  }

  function appendHint(t) {
    const d = document.createElement('div');
    d.className = 'hint-block';
    d.textContent = t;
    el.chat.appendChild(d);
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  // ---------- 对话样例解析 ----------
  function parseExamples(raw) {
    const out = [];
    const lines = (raw || '').split('\n').map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^(我|你|Ta|ta|他|她|对方|A)\s*[:：]\s*([\s\S]*)$/);
      if (!m) continue;
      const text = m[2].trim();
      if (!text) continue;
      out.push({ role: m[1] === '我' ? 'user' : 'assistant', content: text });
    }
    return out;
  }

  // ---------- 系统提示词 ----------
  function buildSystem() {
    const persona = cfg.persona.trim();
    const memory = cfg.memory.trim();
    const name = cfg.name.trim();
    const parts = [];
    parts.push('你要扮演一个具体的人，和屏幕前的用户说话。');
    if (name) parts.push(`你扮演的人叫「${name}」。`);
    if (persona) parts.push('【人物设定】\n' + persona);
    if (memory) parts.push('【关于用户（长期记忆，需始终相信并据此理解用户）】\n' + memory);
    parts.push(
      '【规则】\n' +
      '1. 始终以这个人物的身份、语气、口吻说话，不要跳出来说“我是AI”。\n' +
      '2. 自然地理解用户的情绪和没说出口的意思，像老朋友一样回应，但不要过度说教。\n' +
      '3. 如果用户在消息里附带了图片，就认真地“看懂”图片内容并自然地回应（识别图中是什么、有什么细节、对方可能想表达的）。\n' +
      '4. 回复用中文，口语化，长度贴合人物风格（亲切自然，别长篇大论）。'
    );
    return parts.join('\n\n');
  }

  // ---------- 组装请求消息 ----------
  function buildMessages() {
    const messages = [{ role: 'system', content: buildSystem() }];
    for (const ex of parseExamples(cfg.examples).slice(0, 12)) {
      messages.push({ role: ex.role, content: ex.content });
    }
    const tail = history.slice(-30);
    for (let i = 0; i < tail.length; i++) {
      const m = tail[i];
      const role = m.role === 'user' ? 'user' : 'assistant';
      const hasImg = m.images && m.images.length;
      if (role === 'user' && hasImg) {
        const parts = m.images.map((u) => ({ type: 'image_url', image_url: { url: u } }));
        parts.unshift({ type: 'text', text: m.content || '' });
        messages.push({ role, content: parts });
      } else {
        const text = m.content || (role === 'user' && hasImg ? '[图片]' : '');
        messages.push({ role, content: text || ' ' });
      }
    }
    return messages;
  }

  // ---------- 调用方舟（流式） ----------
  async function callArk(messages, onDelta) {
    const url = (cfg.base.replace(/\/+$/, '')) + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.8, max_tokens: 2048, stream: true }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? '：' + detail.slice(0, 300) : ''}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data);
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          if (delta && delta.content) onDelta(delta.content);
        } catch {}
      }
    }
  }

  async function send() {
    const text = el.input.value.trim();
    if ((!text && pendingImages.length === 0) || busy) return;
    if (!configured()) {
      appendHint('⚠ 先点右上角 ⚙，填好「API Key」和「模型 / 接入点 ID」（识图要用视觉模型）。');
      return;
    }

    const images = pendingImages.slice();
    pendingImages = [];
    renderPreviews();

    const msg = { role: 'user', content: text };
    if (images.length) msg.images = images;
    history.push(msg);
    addBubble('me', text, images);
    el.input.value = '';
    autosize();
    saveHistory();

    const messages = buildMessages();

    busy = true;
    el.send.disabled = true;
    el.status.textContent = '对方正在输入…';
    el.status.className = 'status';

    const typing = addBubble('ta', '');
    typing.classList.add('typing');
    let acc = '';

    try {
      await callArk(messages, (delta) => {
        typing.classList.remove('typing');
        acc += delta;
        typing.querySelector('.bubble').textContent = acc || '···';
        el.chat.scrollTop = el.chat.scrollHeight;
      });
      typing.classList.remove('typing');
      typing.querySelector('.bubble').textContent = acc || '（空回复）';
      history.push({ role: 'assistant', content: acc });
      saveHistory();
      el.status.textContent = `正在扮演 ${cfg.name || 'Ta'}`;
      el.status.className = 'status ok';
    } catch (e) {
      typing.remove();
      el.status.textContent = '出错了：' + e.message;
      el.status.className = 'status err';
      history.pop();            // 回滚刚才那条用户消息
      saveHistory();
    } finally {
      busy = false;
      el.send.disabled = false;
      el.input.focus();
    }
  }

  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
  }

  // ---------- 设置 ----------
  function openSettings() {
    el.cfgBase.value = cfg.base;
    el.cfgKey.value = cfg.apiKey;
    el.cfgModel.value = cfg.model;
    el.cfgName.value = cfg.name;
    el.cfgPersona.value = cfg.persona;
    el.cfgMemory.value = cfg.memory;
    el.cfgExamples.value = cfg.examples;
    renderAvatarPreview();
    el.mask.classList.remove('hidden');
  }
  function closeSettings() { el.mask.classList.add('hidden'); }

  function saveSettings() {
    cfg.base = el.cfgBase.value.trim() || DEFAULTS.base;
    cfg.apiKey = el.cfgKey.value.trim();
    cfg.model = el.cfgModel.value.trim();
    cfg.name = el.cfgName.value.trim();
    cfg.persona = el.cfgPersona.value;
    cfg.memory = el.cfgMemory.value;
    cfg.examples = el.cfgExamples.value;
    saveJSON(CFG_KEY, cfg);
    closeSettings();
    refresh();
    renderHistory();
    appendHint('设置已保存。');
  }

  function clearChat() {
    if (!confirm('确定清空所有本地对话吗？（不影响设置）')) return;
    history = [];
    pendingImages = [];
    renderPreviews();
    saveHistory();
    renderHistory();
    appendHint('对话已清空。');
  }

  // ---------- 事件 ----------
  el.composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  el.input.addEventListener('input', autosize);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  el.imgBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', (e) => { onFiles(e.target.files); e.target.value = ''; });
  el.avatarBtn.addEventListener('click', () => el.avatarInput.click());
  el.avatarInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { setAvatar(await makeAvatar(f)); }
    catch (err) { el.status.textContent = '头像读取失败'; el.status.className = 'status err'; }
  });
  el.avatarClear.addEventListener('click', () => setAvatar(''));
  el.openSettings.addEventListener('click', openSettings);
  el.closeSettings.addEventListener('click', closeSettings);
  el.mask.addEventListener('click', (e) => { if (e.target === el.mask) closeSettings(); });
  el.saveSettings.addEventListener('click', saveSettings);
  el.clearChat.addEventListener('click', clearChat);

  // ---------- 启动 ----------
  refresh();
  renderHistory();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();