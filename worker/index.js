/* ==========================================================================
   余量 MARGIN — 留言板后端（Cloudflare Worker + D1）
   --------------------------------------------------------------------------
   接口
     GET    /?slug=<文章 slug>            列出该篇文章的全部留言
     POST   /                             新增留言（JSON body）
     DELETE /?id=<评论 id>                删除（需要 x-owner-key 头）

   POST body
     { slug, parentId, nick, body, website, elapsed, ownerKey? }

   防垃圾策略（匿名站点必须做的四件事）
     1. 蜜罐字段 website 非空   → 假装成功，其实什么都不写
     2. 表单停留时长 < 3 秒     → 判定为机器人
     3. 频率限制（按 IP 哈希）  → 1 分钟 1 条、10 分钟 5 条
     4. 长度与链接数量限制      → 正文 2~2000 字，链接不超过 2 个

   隐私
     只保存 IP 的 SHA-256 哈希（用于频率限制），不保存原始 IP，也不设置任何 Cookie。

   绑定
     DB         D1 数据库
     OWNER_KEY  站主密钥（用 `wrangler secret put OWNER_KEY` 设置）
     ALLOWED_ORIGIN  允许的跨域来源，默认 "*"
   ========================================================================== */

const MAX_NICK = 24;
const MAX_BODY = 2000;
const MIN_BODY = 2;
const MIN_ELAPSED = 3;          // 秒：填得太快一定是脚本
const RATE_1MIN = 1;
const RATE_10MIN = 5;
const MAX_LINKS = 2;

const CORS_HEADERS = (env) => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-owner-key',
  'access-control-max-age': '86400',
  vary: 'origin',
});

const json = (env, data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS(env) },
});

const bad = (env, error, status = 400) => json(env, { ok: false, error }, status);

/* 只接受小写字母、数字和连字符——slug 会直接进 URL */
const cleanSlug = (s) => {
  const v = String(s || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(v) ? v : '';
};

const countLinks = (s) => (String(s).match(/https?:\/\//gi) || []).length;

/* IP 只以哈希形式落库：加盐后再 SHA-256，无法反查 */
const hashIp = async (ip, salt) => {
  const data = new TextEncoder().encode(`${salt || 'margin'}:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
};

const rowsToComments = (rows) => (rows || []).map((r) => ({
  id: r.id,
  parentId: r.parent_id,
  nick: r.nick,
  body: r.body,
  createdAt: r.created_at,
  isOwner: !!r.is_owner,
  replyToNick: r.parent_nick || null,
}));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS(env) });
    }

    /* ---------------- 列表 ---------------- */
    if (request.method === 'GET') {
      const slug = cleanSlug(url.searchParams.get('slug'));
      if (!slug) return bad(env, 'slug 不合法');
      const { results } = await env.DB.prepare(`
        SELECT c.id, c.parent_id, c.nick, c.body, c.created_at, c.is_owner, p.nick AS parent_nick
        FROM comments c
        LEFT JOIN comments p ON p.id = c.parent_id
        WHERE c.slug = ? AND c.status = 1
        ORDER BY c.created_at ASC
        LIMIT 500
      `).bind(slug).all();
      return json(env, { ok: true, comments: rowsToComments(results) });
    }

    /* ---------------- 新建 ---------------- */
    if (request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return bad(env, '请求体不是合法 JSON');
      }

      /* 1) 蜜罐：机器人会把隐藏字段填上。直接假装成功，不写库 —— 让它以为得手了。 */
      if (String(payload.website || '').trim()) {
        return json(env, { ok: true, comment: null });
      }

      const slug = cleanSlug(payload.slug);
      if (!slug) return bad(env, 'slug 不合法');

      const nick = String(payload.nick || '').trim().slice(0, MAX_NICK);
      const body = String(payload.body || '').trim();
      if (body.length < MIN_BODY) return bad(env, '内容太短');
      if (body.length > MAX_BODY) return bad(env, `内容超过 ${MAX_BODY} 字`);
      if (countLinks(body) > MAX_LINKS) return bad(env, '链接太多了，最多 2 个');

      /* 2) 停留时长：从表单渲染到提交不足 3 秒，判定为脚本 */
      const elapsed = Number(payload.elapsed || 0);
      if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED) {
        return bad(env, '提交太快了，请稍等几秒再试');
      }

      const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
      const ipHash = await hashIp(ip, env.IP_SALT || env.OWNER_KEY);

      /* 3) 频率限制 */
      const now = Date.now();
      const win1 = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?'
      ).bind(ipHash, now - 60_000).first();
      if ((win1?.n || 0) >= RATE_1MIN) return bad(env, '发得太快了，等一分钟再来', 429);

      const win10 = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?'
      ).bind(ipHash, now - 600_000).first();
      if ((win10?.n || 0) >= RATE_10MIN) return bad(env, '短时间内发得太多，休息一会儿吧', 429);

      /* 站长身份：带上正确密钥就以站长身份发表 */
      const isOwner = !!env.OWNER_KEY && payload.ownerKey === env.OWNER_KEY;

      /* 回复的目标必须是同一篇文章下的评论，避免串帖 */
      let parentId = null;
      if (payload.parentId) {
        const parent = await env.DB.prepare(
          'SELECT id FROM comments WHERE id = ? AND slug = ? AND status = 1'
        ).bind(Number(payload.parentId), slug).first();
        if (!parent) return bad(env, '要回复的留言不存在');
        parentId = parent.id;
      }

      const info = await env.DB.prepare(`
        INSERT INTO comments (slug, parent_id, nick, body, created_at, is_owner, ip_hash, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(slug, parentId, nick, body, now, isOwner ? 1 : 0, ipHash).run();

      const id = info.meta?.last_row_id;
      const saved = await env.DB.prepare(`
        SELECT c.id, c.parent_id, c.nick, c.body, c.created_at, c.is_owner, p.nick AS parent_nick
        FROM comments c LEFT JOIN comments p ON p.id = c.parent_id
        WHERE c.id = ?
      `).bind(id).first();

      return json(env, { ok: true, comment: rowsToComments([saved])[0] }, 201);
    }

    /* ---------------- 删除（仅站长） ---------------- */
    if (request.method === 'DELETE') {
      const key = request.headers.get('x-owner-key') || '';
      if (!env.OWNER_KEY || key !== env.OWNER_KEY) return bad(env, '没有权限', 403);
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id) || id <= 0) return bad(env, 'id 不合法');
      /* 连同它的回复一起标记删除，保留行以便追溯 */
      await env.DB.prepare('UPDATE comments SET status = 0 WHERE id = ? OR parent_id = ?')
        .bind(id, id).run();
      return json(env, { ok: true });
    }

    return bad(env, '不支持的方法', 405);
  },
};
