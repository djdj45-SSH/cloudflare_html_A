#!/usr/bin/env node
/* ==========================================================================
   余量 MARGIN — 静态站构建脚本
   --------------------------------------------------------------------------
   零依赖（只用 node:fs / node:path），幂等，可反复运行。

   用法：
     node tools/build.mjs           生成全站
     node tools/build.mjs --check   只校验「仓库现状是否与重新生成的一致」，不写文件
                                    有差异时退出码为 1，适合挂 pre-commit hook

   它做什么：
     1. content/<slug>.html + templates/post.html  →  posts/<slug>.html
     2. 按日期排序 → 首页 stats / 头条 / 最近列表（写入 index.html 锚点区）
     3. 按年份分组 → 归档列表（写入 archive.html 锚点区）
     4. 生成 feed.xml 与 sitemap.xml
     5. 把 templates/nav.html、footer.html 注入所有页面的锚点区
     6. 把每个页面 head 里的 canonical / og:url 归到 site.url 名下
        （手写外壳如 index/archive/changelog 的 head 不在锚点内，否则换域名会留死链）

   单一数据源：tools/posts.json（文章元数据）
   手改锚点内的内容是没用的——下次 build 会覆盖掉。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = process.argv.includes('--check');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'tools');

const read = (p) => fs.readFileSync(p, 'utf8');
const readIf = (p) => (fs.existsSync(p) ? read(p) : '');
const isFile = (p) => fs.existsSync(p);

const die = (msg) => {
  process.stderr.write(`\n[build] 错误：${msg}\n`);
  process.exit(2);
};

/* ---------- 输入 ---------- */
const dataPath = path.join(TOOLS, 'posts.json');
if (!isFile(dataPath)) die(`找不到 ${dataPath}`);
let data;
try {
  data = JSON.parse(read(dataPath));
} catch (e) {
  die(`tools/posts.json 解析失败：${e.message}`);
}
const site = data.site || {};
const tagLabels = data.tagLabels || {};

/* draft: true 的文章留在仓库里但不参与构建（不会出现在任何页面、RSS 或 sitemap） */
const allPosts = data.posts || [];
const drafts = allPosts.filter((p) => p.draft);
const posts = allPosts.filter((p) => !p.draft).sort((a, b) => (a.date < b.date ? 1 : -1));
if (!posts.length) die('tools/posts.json 里没有任何文章');

/* ---------- 模板 ---------- */
const cache = new Map();
const tpl = (name) => {
  if (!cache.has(name)) {
    const p = path.join(TOOLS, 'templates', name);
    if (!isFile(p)) die(`找不到模板 ${p}`);
    cache.set(name, read(p));
  }
  return cache.get(name);
};
const render = (t, vars) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

/* 文本清洗：压平换行，并去掉「中文标点/汉字之间」的多余空格。
   注意保留汉字与拉丁字母、数字之间的空格——那是中英混排该有的间隙。 */
const tidy = (s) => String(s == null ? '' : s)
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/(?<=[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef])\s+(?=[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef])/g, '');

/* 给多行片段的每一行加统一缩进，保证生成结果的结构缩进好看 */
const indent = (text, n) => {
  const pad = ' '.repeat(n);
  return text.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
};

/* ---------- 日期 ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtDot = (d) => d.replace(/-/g, '.');                    // 2026.09.14
const fmtShort = (d) => d.slice(5).replace('-', '.');           // 09.14
const fmtShortHtml = (d) => {                                   // 09<em>.14</em>
  const [mm, dd] = d.slice(5).split('-');
  return `${mm}<em>.${dd}</em>`;
};
const fmtRFC822 = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return `${DAYS[dt.getUTCDay()]}, ${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y} 00:00:00 +0800`;
};

/* ---------- 字数与阅读时长 ---------- */
const plainText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, '');

const CHARS_PER_MIN = 350;   // 中文正文的粗略速度

const bodyOf = (slug) => {
  const p = path.join(TOOLS, 'content', `${slug}.html`);
  if (!isFile(p)) die(`缺少正文源 tools/content/${slug}.html`);
  return read(p).replace(/\s+$/, '');
};

/* ---------- 组装每篇的派生字段 ---------- */
const items = posts.map((p, i) => {
  const body = bodyOf(p.slug);
  const num = posts.length - i;
  const numText = String(num).padStart(2, '0');

  const manualWords = p.words ? Number(String(p.words).replace(/[^\d]/g, '')) : 0;
  const wc = manualWords || [...plainText(body)].length;
  const readtime = p.readtime || `约 ${Math.max(1, Math.round(wc / CHARS_PER_MIN))} 分钟`;

  const coverFile = p.cover ? path.join(TOOLS, 'covers', p.cover) : '';
  const cover = coverFile && isFile(coverFile) ? read(coverFile).replace(/\s+$/, '') : '';

  return {
    ...p,
    index: i,
    num: numText,
    body,
    cover,
    dateText: p.dateText || fmtDot(p.date),
    dateMd: fmtShort(p.date),
    dateMdHtml: fmtShortHtml(p.date),
    readtime,
    wordsText: p.words || wc.toLocaleString('en-US'),
    kickerFull: [p.category, `No.${numText}`, p.tech].filter(Boolean).join(' · '),
    kickerShort: [p.category, p.tech].filter(Boolean).join(' · '),
  };
});

const latest = items[0];

/* ---------- 标签 ---------- */
const labelFor = (t) => tagLabels[t] || t;
const tagUrl = (t) => `/tags/${t}.html`;
const tagLinks = (p) => (p.tags || [])
  .map((t) => `<a class="tag" href="${tagUrl(t)}">${labelFor(t)}</a>`)
  .join('\n        ');

/* 全部标签 → 文章列表（保持日期倒序，因为 items 已排好） */
const tagIndex = new Map();
for (const p of items) {
  for (const t of p.tags || []) {
    if (!tagIndex.has(t)) tagIndex.set(t, []);
    tagIndex.get(t).push(p);
  }
}

/* ---------- 三个方向（首页 pillar 板块） ----------
   数据源是 posts.json 的顶层 pillars。每个方向挂一组标签：
     · 篇数 = 标签命中任一即算（同一篇不会在一个方向里被数两次）
     · 标签链接只给「真的有文章」的标签——像 backend / ai 这种先留着的标签
       没文章时会被静默跳过，等第一篇文章打上它，链接会自动出现。 */
const pillars = data.pillars || [];
const pillarPosts = (pl) => {
  const set = new Set(pl.tags || []);
  return items.filter((p) => (p.tags || []).some((t) => set.has(t)));
};

/* ---------- 相关文章：按标签重合度打分，同分类加权 ---------- */
const relatedFor = (p, n = 3) => {
  const mine = new Set(p.tags || []);
  return items
    .filter((q) => q.slug !== p.slug)
    .map((q) => {
      const shared = (q.tags || []).filter((t) => mine.has(t)).length;
      const sameCat = q.category === p.category ? 0.5 : 0;
      return { q, score: shared + sameCat };
    })
    .filter((x) => x.score > 0)
    /* 分数高的优先；同分时较新的优先 */
    .sort((a, b) => (b.score - a.score) || (a.q.date < b.q.date ? 1 : -1))
    .slice(0, n)
    .map((x) => x.q);
};

/* ---------- 锚点写入 ---------- */
const fill = (html, name, content) => {
  const open = `<!-- build:${name} -->`;
  const close = `<!-- /build:${name} -->`;
  const i = html.indexOf(open);
  if (i < 0) return null;
  const j = html.indexOf(close, i + open.length);
  if (j < 0) die(`锚点 ${open} 没有对应的 ${close}`);
  return html.slice(0, i + open.length) + '\n' + content + '\n' + html.slice(j);
};

/* <head> 里的绝对地址统一归到 site.url 名下。
   为什么需要它：index / archive / changelog / tags/index 这几个页面是「手写外壳」，
   只有 build 锚点区会被重写，head 不在锚点内——所以光改 site.url 并不会动到它们的
   canonical 与 og:url，会留下指向旧域名的死链（对 SEO 是负分）。
   这里只替换 origin、保留路径，因此文章页/标签页（路径各不相同）也适用且结果不变（幂等）。 */
const rebaseHead = (html) => {
  const base = String(site.url || '').replace(/\/+$/, '');
  if (!base) return html;
  const swap = (full, pre, url, post) => {
    const path = url.replace(/^https?:\/\/[^/]*/i, '') || '/';
    return `${pre}${base}${path}${post}`;
  };
  return html
    .replace(/(<link\s+rel="canonical"\s+href=")([^"]*)(")/gi, swap)
    .replace(/(<meta\s+property="og:url"\s+content=")([^"]*)(")/gi, swap);
};

/* 注入导航与页脚。幂等：锚点之间整体替换，重复运行结果不变。 */
const injectChrome = (html, current) => {
  const navVars = {
    NAME: site.name,
    LATIN: site.latin,
    CUR_HOME: '', CUR_ARCHIVE: '', CUR_TAGS: '', CUR_CHANGELOG: '', CUR_ABOUT: '',
  };
  if (current) navVars[current] = ' aria-current="page"';

  let out = rebaseHead(html);
  const a = fill(out, 'nav', render(tpl('nav.html'), navVars).replace(/\s+$/, ''));
  if (a) out = a;
  const b = fill(out, 'footer', render(tpl('footer.html'), {
    EMAIL: site.email,
    YEAR: new Date().getFullYear(),
    LATIN: site.latin,
    NAME: site.name,
    TAGLINE: site.tagline || '',
  }).replace(/\s+$/, ''));
  if (b) out = b;
  return out;
};

/* ---------- 输出登记（--check 时不落盘） ---------- */
const planned = [];
const emit = (rel, content) => {
  const abs = path.join(ROOT, rel);
  const prev = isFile(abs) ? read(abs) : null;
  if (prev === content) {
    planned.push({ rel, state: 'same' });
    return;
  }
  planned.push({ rel, state: prev === null ? 'new' : 'changed' });
  if (!CHECK) fs.writeFileSync(abs, content, 'utf8');
};

/* ==========================================================================
   1. 文章页
   ========================================================================== */
const baseVars = (p) => ({
  NAME: site.name,
  LATIN: site.latin,
  SITE_URL: site.url,
  SLUG: p.slug,
  TITLE: p.title,
  DESCRIPTION: tidy(p.description || p.summary || ''),
  OG_DESCRIPTION: tidy(p.ogDescription || p.summary || ''),
  STANDFIRST: tidy(p.standfirst || ''),
  KICKER: p.kickerFull,
  DATE: p.date,
  DATE_TEXT: p.dateText,
  READTIME: p.readtime,
  WORDS: p.wordsText,
  STACK: tidy(p.stack || ''),
});

for (const p of items) {
  const older = items[p.index + 1];   // 时间上更早的一篇
  const newer = items[p.index - 1];   // 时间上更新的一篇

  const parts = [];
  if (older) parts.push(render(tpl('pager-prev.html'), { SLUG: older.slug, TITLE: older.title }).replace(/\s+$/, ''));
  if (newer) parts.push(render(tpl('pager-next.html'), { SLUG: newer.slug, TITLE: newer.title }).replace(/\s+$/, ''));

  const related = relatedFor(p);
  const relatedHtml = related.map((q) => render(tpl('related-item.html'), {
    SLUG: q.slug,
    TITLE: q.title,
    SUMMARY: tidy(q.summary || q.standfirst),
    DATE_MD: q.dateMd,
    CATEGORY: q.listCategory || q.category,
  }).replace(/\s+$/, '')).join('\n');

  const html = render(tpl('post.html'), {
    ...baseVars(p),
    BODY: indent(p.body, 4),
    PAGER: parts.join('\n'),
    TAGS: tagLinks(p),
    RELATED: relatedHtml,
    HAS_RELATED: related.length ? '' : ' hidden',
    COMMENTS_API: site.commentsApi || '',
  });
  emit(`posts/${p.slug}.html`, injectChrome(html, ''));
}

/* ==========================================================================
   2. 首页：stats / 头条 / 最近列表
   ========================================================================== */
{
  const abs = path.join(ROOT, 'index.html');
  if (!isFile(abs)) die('找不到 index.html');
  let html = read(abs);
  let touched = false;

  const stats = render(tpl('index-stats.html'), {
    COUNT: String(items.length),
    LATEST_MD: latest.dateMdHtml,
    LATEST_TITLE: latest.title,
    AVG_MIN: String(Math.round(items.reduce((s, p) => s + parseFloat(String(p.readtime).replace(/[^\d.]/g, '') || 0), 0) / items.length)),
  }).replace(/\s+$/, '');
  const withStats = fill(html, 'stats', stats);
  if (withStats) { html = withStats; touched = true; }

  /* 三个方向：从 posts.json 的 pillars 渲染，篇数与标签链接都是算出来的 */
  if (pillars.length) {
    const cards = pillars.map((pl) => {
      const list = pillarPosts(pl);
      const chips = (pl.tags || [])
        .filter((t) => tagIndex.has(t))
        .map((t) => `<a class="tag" href="${tagUrl(t)}">${labelFor(t)}</a>`)
        .join('');
      return render(tpl('pillar.html'), {
        LATIN: pl.latin || '',
        TITLE: pl.title || '',
        DESC: tidy(pl.desc || ''),
        COUNT: String(list.length),
        TAGS: chips,
      }).replace(/\s+$/, '');
    }).join('\n');
    const withPillars = fill(html, 'pillars', render(tpl('pillars.html'), { CARDS: cards }).replace(/\s+$/, ''));
    if (withPillars) { html = withPillars; touched = true; }
  }

  const featureTpl = latest.cover ? 'feature.html' : 'feature-plain.html';
  const feature = render(tpl(featureTpl), {
    ...baseVars(latest),
    COVER: indent(latest.cover, 8),
    KICKER: latest.kickerShort,
    SUMMARY: tidy(latest.featureSummary || latest.summary || latest.standfirst),
  }).replace(/\s+$/, '');
  const withFeature = fill(html, 'feature', feature);
  if (withFeature) { html = withFeature; touched = true; }

  const list = items.slice(1, 5).map((p) => render(tpl('list-entry.html'), {
    NUM: p.num,
    SLUG: p.slug,
    TITLE: p.title,
    SUMMARY: tidy(p.summary || p.standfirst),
    DATE_MD: p.dateMd,
    LIST_CATEGORY: p.listCategory || p.category,
  }).replace(/\s+$/, '')).join('\n\n');
  const withList = fill(html, 'list', list);
  if (withList) { html = withList; touched = true; }

  if (!touched) die('index.html 里一个 build 锚点都没找到，请先加上 <!-- build:stats --> 等标记');
  emit('index.html', injectChrome(html, 'CUR_HOME'));
}

/* ==========================================================================
   3. 归档页
   ========================================================================== */
{
  const abs = path.join(ROOT, 'archive.html');
  if (!isFile(abs)) die('找不到 archive.html');
  let html = read(abs);

  const byYear = new Map();
  for (const p of items) {
    const y = p.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(p);
  }

  const chunks = [
    `  <div class="count" id="count">共 ${items.length} 篇</div>`,
    '',
    '  <div class="empty" style="display:none">没有匹配的文章。换个词，或者 <a class="link" href="/">回首页</a>。</div>',
  ];
  for (const [year, list] of byYear) {
    chunks.push('', `  <h2 class="year">${year}</h2>`, '');
    chunks.push(list.map((p) => render(tpl('archive-entry.html'), {
      NUM: p.num,
      SLUG: p.slug,
      TITLE: p.title,
      SUMMARY: tidy(p.summary || p.standfirst),
      KEYWORDS: tidy(p.keywords || `${p.title} ${p.category}`),
      DATE_MD: p.dateMd,
      LIST_CATEGORY: p.listCategory || p.category,
    }).replace(/\s+$/, '')).join('\n\n'));
  }

  const out = fill(html, 'archive', chunks.join('\n'));
  if (!out) die('archive.html 缺少 build:archive 锚点');
  emit('archive.html', injectChrome(out, 'CUR_ARCHIVE'));
}

/* ==========================================================================
   4. 标签页与更新记录
   ========================================================================== */
{
  /* 4a. 标签索引页（手写外壳 + tagcloud 锚点） */
  const cloudAbs = path.join(ROOT, 'tags', 'index.html');
  if (isFile(cloudAbs)) {
    const cloud = [...tagIndex.entries()]
      .sort((a, b) => (b[1].length - a[1].length) || (a[0] < b[0] ? -1 : 1))
      .map(([t, list]) => render(tpl('tag-cloud.html'), {
        SLUG: t, LABEL: labelFor(t), COUNT: String(list.length),
      }).replace(/\s+$/, '')).join('\n');
    emit('tags/index.html', injectChrome(fill(read(cloudAbs), 'tagcloud', cloud), 'CUR_TAGS'));
  }

  /* 4b. 每个标签一个页面，整页由模板生成 */
  for (const [t, list] of tagIndex) {
    const entries = list.map((p) => render(tpl('tag-entry.html'), {
      SLUG: p.slug,
      TITLE: p.title,
      SUMMARY: tidy(p.summary || p.standfirst),
      DATE_MD: p.dateMd,
      CATEGORY: p.listCategory || p.category,
      READTIME: p.readtime,
    }).replace(/\s+$/, '')).join('\n\n');

    const html = render(tpl('tag-page.html'), {
      NAME: site.name,
      LATIN: site.latin,
      SITE_URL: site.url,
      SLUG: t,
      LABEL: labelFor(t),
      COUNT: String(list.length),
      DESC: `「${labelFor(t)}」下的全部记录，共 ${list.length} 篇，按时间倒序。`,
      ENTRIES: entries,
    });
    emit(`tags/${t}.html`, injectChrome(html, 'CUR_TAGS'));
  }

  /* 4c. 更新记录：把各篇文章末尾的 <dl class="revision"> 抽出来汇总成一页 */
  const changeAbs = path.join(ROOT, 'changelog.html');
  if (isFile(changeAbs)) {
    const rows = [];
    for (const p of items) {
      const block = p.body.match(/<dl class="revision">([\s\S]*?)<\/dl>/);
      if (!block) continue;
      for (const m of block[1].matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
        const label = tidy(m[1]);
        const dm = label.match(/(\d{4})[.\-](\d{2})[.\-](\d{2})/);
        rows.push({
          slug: p.slug,
          title: p.title,
          date: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : p.date,
          dateText: dm ? `${dm[1]}.${dm[2]}.${dm[3]}` : p.dateText,
          text: tidy(m[2]),
        });
      }
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));

    const withRev = items.filter((p) => /<dl class="revision">/.test(p.body)).length;
    const body = [
      '  <div class="clhead">',
      `    <span class="clhead__num">${rows.length}</span>`,
      `    <span class="clhead__label">条修订，来自 ${withRev} 篇文章</span>`,
      '  </div>',
      '',
      '  <ol class="clist-plain">',
      rows.map((r) => render(tpl('changelog-entry.html'), {
        SLUG: r.slug, TITLE: r.title, DATE: r.date, DATE_TEXT: r.dateText, TEXT: r.text,
      }).replace(/\s+$/, '')).join('\n'),
      '  </ol>',
    ].join('\n');

    emit('changelog.html', injectChrome(fill(read(changeAbs), 'changelog', body), 'CUR_CHANGELOG'));
  }
}

/* ==========================================================================
   5. feed.xml / sitemap.xml
   ========================================================================== */
{
  /* 全文输出：description 放摘要，content:encoded 放正文。
     正文里的站内链接要改成绝对地址，否则在阅读器里点不开。 */
  const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  const feedBody = (p) => {
    const html = p.body
      .replace(/<aside class="notes">[\s\S]*?<\/aside>/, '')
      .replace(/href="\//g, `href="${site.url}/`)
      .replace(/src="\//g, `src="${site.url}/`);
    return [
      `<p><em><a href="${site.url}/posts/${p.slug}.html">${p.title}</a> · ${p.dateText}</em></p>`,
      html,
    ].join('\n');
  };

  const itemsXml = items.map((p) => [
    '    <item>',
    `      <title>${p.title}</title>`,
    `      <link>${site.url}/posts/${p.slug}.html</link>`,
    `      <guid isPermaLink="true">${site.url}/posts/${p.slug}.html</guid>`,
    `      <pubDate>${fmtRFC822(p.date)}</pubDate>`,
    `      <category>${p.listCategory || p.category}</category>`,
    `      <description>${tidy(p.summary || p.standfirst)}</description>`,
    `      <content:encoded>${cdata(feedBody(p))}</content:encoded>`,
    '    </item>',
  ].join('\n')).join('\n\n');

  emit('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${site.name} ${site.latin}</title>
    <link>${site.url}/</link>
    <description>${site.taglineLong || `${site.tagline || ''}：记录失败、数据，以及被推翻过的结论。`}</description>
    <language>zh-CN</language>
    <managingEditor>${site.email} (${site.latin})</managingEditor>
    <lastBuildDate>${fmtRFC822(latest.date)}</lastBuildDate>
    <atom:link href="${site.url}/feed.xml" rel="self" type="application/rss+xml"/>

${itemsXml}
  </channel>
</rss>
`);

  const staticPages = [
    { loc: `${site.url}/`, lastmod: latest.date, priority: '1.0' },
    { loc: `${site.url}/archive.html`, lastmod: latest.date, priority: '0.8' },
    { loc: `${site.url}/tags/index.html`, lastmod: latest.date, priority: '0.7' },
    { loc: `${site.url}/changelog.html`, lastmod: latest.date, priority: '0.6' },
    { loc: `${site.url}/about.html`, lastmod: latest.date, priority: '0.5' },
  ];
  const postUrls = items.map((p) => ({ loc: `${site.url}/posts/${p.slug}.html`, lastmod: p.date, priority: '0.9' }));
  const tagUrls = [...tagIndex.keys()].map((t) => ({
    loc: `${site.url}/tags/${t}.html`,
    lastmod: tagIndex.get(t)[0].date,
    priority: '0.6',
  }));
  const all = [...staticPages, ...postUrls, ...tagUrls];
  emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map((u) => [
    '  <url>',
    `    <loc>${u.loc}</loc>`,
    `    <lastmod>${u.lastmod}</lastmod>`,
    `    <priority>${u.priority}</priority>`,
    '  </url>',
  ].join('\n')).join('\n')}
</urlset>
`);
}

/* ==========================================================================
   6. 其余手写页面（about / 404）：只注入 nav / footer，内容不动
   ========================================================================== */
{
  const HANDLED = new Set(['index.html', 'archive.html', 'changelog.html']);
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.html') || HANDLED.has(f)) continue;
    const abs = path.join(ROOT, f);
    const current = f === 'about.html' ? 'CUR_ABOUT' : '';
    emit(f, injectChrome(read(abs), current));
  }
}

/* ==========================================================================
   报告
   ========================================================================== */
{
  const changed = planned.filter((x) => x.state !== 'same');
  const lines = [];
  lines.push(`模式：${CHECK ? '校验（不写入）' : '生成'}`);
  lines.push(`文章：${items.length} 篇 · 文件：${planned.length} 个`);
  if (drafts.length) {
    lines.push(`草稿（未构建）：${drafts.length} 篇 — ${drafts.map((d) => d.slug).join(', ')}`);
  }
  lines.push('');
  if (!changed.length) {
    lines.push('✓ 全部文件与源一致，无需更新。');
  } else {
    lines.push(`${CHECK ? '✗ 以下文件与源不一致：' : '已更新：'}`);
    for (const c of changed) lines.push(`  ${c.state === 'new' ? '新增' : '修改'}  ${c.rel}`);
  }
  const text = lines.join('\n');
  process.stdout.write(text + '\n');
  if (CHECK && changed.length) process.exit(1);
}
