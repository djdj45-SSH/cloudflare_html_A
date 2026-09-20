/* ==========================================================================
   余量 MARGIN — 留言板前端
   --------------------------------------------------------------------------
   完全匿名：访客不需要登录，昵称可留空。
   后端是自建的 Cloudflare Worker + D1（见 worker/ 目录），不引入任何第三方脚本。

   设计要点
   1) 渐进增强：没有配置 API、或 JS 失效时，页面只显示一句提示，不影响阅读。
   2) XSS 防护：所有用户内容先转义，再套用极小的 Markdown 子集（**粗体**、`代码`）。
   3) 站主模式：URL 带 ?ownerKey=xxx 时记入 localStorage，之后可删除评论、亮出站长标识。
   4) 防垃圾：蜜罐字段 + 表单停留时长，后端还会做频率限制。
   ========================================================================== */
(() => {
  'use strict';

  const host = document.querySelector('[data-comments]');
  if (!host) return;

  const API = String(host.dataset.api || '').replace(/\/+$/, '');
  const SLUG = host.dataset.slug || '';
  const form = host.querySelector('[data-comments-form]');
  const list = host.querySelector('[data-comments-list]');
  const state = host.querySelector('[data-comments-state]');
  const countEl = host.querySelector('[data-comments-count]');
  const submitBtn = host.querySelector('[data-comments-submit]');
  const replyHint = host.querySelector('[data-reply-hint]');
  const replyTo = host.querySelector('[data-reply-to]');
  const nickInput = form ? form.querySelector('[name="nick"]') : null;
  const bodyInput = form ? form.querySelector('[name="body"]') : null;

  const OWNER_KEY_STORE = 'margin-owner-key';
  const loadedAt = Date.now();
  let parentId = null;
  let comments = [];

  /* ---------- 站主密钥：支持 ?ownerKey=xxx 写入后从地址栏抹掉 ---------- */
  const url = new URL(location.href);
  const incoming = url.searchParams.get('ownerKey');
  if (incoming) {
    try { localStorage.setItem(OWNER_KEY_STORE, incoming); } catch (_) { /* 隐私模式忽略 */ }
    url.searchParams.delete('ownerKey');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
  }
  const ownerKey = (() => {
    try { return localStorage.getItem(OWNER_KEY_STORE) || ''; } catch (_) { return ''; }
  })();

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* 极小的 Markdown 子集：先把 HTML 转义，再换回来一点语法。顺序不能反。 */
  const miniMd = (raw) => esc(raw)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  const relTime = (ms) => {
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    const d = new Date(ms);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const say = (text, isErr) => {
    if (!state) return;
    state.textContent = text;
    state.classList.toggle('comments__state--err', !!isErr);
    state.hidden = !text;
  };

  /* ---------- 渲染 ---------- */
  const itemHtml = (c, isReply) => {
    const nick = c.nick && c.nick.trim() ? c.nick : '匿名';
    const owner = c.isOwner
      ? '<span class="citem__owner">站长</span>'
      : '';
    /* 只要 parentId 存在就是回复；父评论昵称为空时回落成「匿名」，
       否则匿名的父评论会让这里什么都不显示。 */
    const target = c.parentId
      ? `<span class="citem__target">回复 <b>${esc(c.replyToNick || '匿名')}</b></span>`
      : '';
    const del = ownerKey
      ? `<button type="button" class="citem__act citem__act--del" data-del="${c.id}">删除</button>`
      : '';
    return `
      <li class="citem${isReply ? ' citem--reply' : ''}" data-id="${c.id}">
        <div class="citem__head">
          <span class="citem__nick${c.isOwner ? ' is-owner' : ''}">${esc(nick)}</span>
          ${owner}
          ${target}
          <span class="citem__time">${relTime(c.createdAt)}</span>
        </div>
        <div class="citem__body">${miniMd(c.body)}</div>
        <div class="citem__actions">
          <button type="button" class="citem__act" data-reply="${c.id}" data-nick="${esc(nick)}">回复</button>
          ${del}
        </div>
      </li>`;
  };

  const render = () => {
    if (!list) return;
    const byId = new Map(comments.map((c) => [c.id, c]));

    /* 任意深度的回复都归到它的顶层祖先之下。
       否则「回复一条回复」的评论会因为父节点不是顶层而永远不被渲染——
       数据在库里，页面上却看不到。渲染仍然只做两层，靠「回复 XX」保留上下文。 */
    const rootOf = (c) => {
      let cur = c;
      let guard = 0;
      while (cur.parentId && byId.has(cur.parentId) && guard < 50) {
        cur = byId.get(cur.parentId);
        guard += 1;
      }
      return cur;
    };

    const tops = comments.filter((c) => !c.parentId);
    const byParent = new Map();
    for (const c of comments) {
      if (!c.parentId) continue;
      const root = rootOf(c);
      if (!byParent.has(root.id)) byParent.set(root.id, []);
      byParent.get(root.id).push(c);
    }

    if (!tops.length) {
      list.innerHTML = '';
      say('还没有人说话。要不要坐第一个？');
    } else {
      say('');
      list.innerHTML = tops.map((t) => {
        const replies = byParent.get(t.id) || [];
        return itemHtml(t, false) + (replies.length
          ? `<ul class="citem__replies">${replies.map((r) => itemHtml(r, true)).join('')}</ul>`
          : '');
      }).join('');
    }
    if (countEl) countEl.textContent = comments.length ? `${comments.length} 条` : '';
  };

  /* ---------- 回复态 ---------- */
  const setReply = (id, nick) => {
    parentId = id;
    if (replyHint) replyHint.hidden = !id;
    if (replyTo) replyTo.textContent = nick || '';
    if (bodyInput) bodyInput.focus();
  };
  const clearReply = () => setReply(null, '');

  /* ---------- 网络 ---------- */
  const load = async () => {
    if (!API) {
      say('留言功能还没接上后端。部署 worker/ 之后把地址填进 tools/posts.json 的 site.commentsApi 即可。', true);
      return;
    }
    try {
      const res = await fetch(`${API}/?slug=${encodeURIComponent(SLUG)}`, { headers: { accept: 'application/json' } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '读取失败');
      comments = data.comments || [];
      render();
      if (form) form.hidden = false;
    } catch (e) {
      say(`留言加载失败：${e.message}`, true);
    }
  };

  const post = async (payload) => {
    const res = await fetch(`${API}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false, error: '响应不是合法 JSON' }));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.comment;
  };

  const del = async (id) => {
    const res = await fetch(`${API}/?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-owner-key': ownerKey },
    });
    const data = await res.json().catch(() => ({ ok: false, error: '响应不是合法 JSON' }));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  };

  /* ---------- 事件 ---------- */
  host.addEventListener('click', async (e) => {
    const replyBtn = e.target.closest('[data-reply]');
    if (replyBtn) {
      setReply(Number(replyBtn.dataset.reply), replyBtn.dataset.nick);
      return;
    }
    if (e.target.closest('[data-reply-cancel]')) {
      clearReply();
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      if (!confirm('删除这条留言？此操作不可撤销。')) return;
      delBtn.disabled = true;
      try {
        await del(Number(delBtn.dataset.del));
        await load();
      } catch (err) {
        alert(`删除失败：${err.message}`);
        delBtn.disabled = false;
      }
    }
  });

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        slug: SLUG,
        parentId,
        nick: nickInput ? nickInput.value.trim() : '',
        body: bodyInput ? bodyInput.value.trim() : '',
        website: form.querySelector('[name="website"]') ? form.querySelector('[name="website"]').value : '',
        elapsed: Math.round((Date.now() - loadedAt) / 1000),
      };
      if (ownerKey) payload.ownerKey = ownerKey;

      if (!payload.body) { say('内容不能为空。', true); return; }
      submitBtn.disabled = true;
      const before = submitBtn.textContent;
      submitBtn.textContent = '发送中';
      try {
        const created = await post(payload);
        comments.push(created);
        comments.sort((a, b) => a.createdAt - b.createdAt);
        if (bodyInput) bodyInput.value = '';
        clearReply();
        render();
      } catch (err) {
        say(`发送失败：${err.message}`, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = before;
      }
    });
  }

  /* 昵称记一次，下次不用重填（只存本地，不上传） */
  if (nickInput) {
    try {
      const saved = localStorage.getItem('margin-nick');
      if (saved) nickInput.value = saved;
    } catch (_) { /* 忽略 */ }
    nickInput.addEventListener('change', () => {
      try { localStorage.setItem('margin-nick', nickInput.value.trim()); } catch (_) { /* 忽略 */ }
    });
  }

  load();
})();
