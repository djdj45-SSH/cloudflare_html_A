#!/usr/bin/env node
/* ==========================================================================
   余量 MARGIN — 反爬 trap 页构建脚本
   --------------------------------------------------------------------------
   零依赖（只用 node:fs / node:path），幂等，可反复运行。

   用法：
     node tools/build-traps.mjs           生成 traps/ 下的全部页面
     node tools/build-traps.mjs --check   只校验「仓库现状是否与重新生成的一致」
                                          有差异时退出码为 1

   它做什么：
     1. templates/trap.html     + CLIENTS 清单  →  traps/trap-<id>.html
     2. templates/honeypot.html + 确定性假数据  →  traps/honeypot.html

   为什么单独一个脚本，而不是并进 build.mjs：
     build.mjs 管的是"内容"（posts.json 是唯一数据源）。这里是"防御姿态"，
     改动的理由、频率、审阅者都不同（改这里等于改安全策略）。
     分成两个脚本，git 历史上一眼能看出"哪次提交动了防护"。

   为什么不引用 /assets/css/site.css：
     trap 页必须完全自包含。它可能在上游不可用、缓存穿透、断网等任何时刻
     被返回，引用站内资源会让它退化成半张白页 —— 那就不像"一个有意的拦截"，
     而像"一个坏掉的站"。样式全部内联在模板里。

   与 Cloudflare 侧的对应关系：
     每条 CLIENTS 条目对应控制台里一条 Redirect 规则，
     规则条件为 (http.user_agent contains "<match>") and not starts_with(uri.path,"/traps/")。
     规则清单见 tools/traps.rules.md。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = process.argv.includes('--check');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'tools');
const OUT = path.join(ROOT, 'traps');

const read = (p) => fs.readFileSync(p, 'utf8');
const die = (msg) => {
  process.stderr.write(`\n[traps] 错误：${msg}\n`);
  process.exit(2);
};

/* --------------------------------------------------------------------------
   客户端清单 —— 唯一数据源
   id      产物文件名 traps/trap-<id>.html
   client  展示名（渲染进页面）
   match   与 Cloudflare Redirect 规则里 http.user_agent contains 的值一致
   kind    分类，便于阅读
   -------------------------------------------------------------------------- */
const CLIENTS = [
  { id: 'python',  client: 'python-requests', match: 'python-requests', kind: 'python · 同步请求库' },
  { id: 'httpx',   client: 'httpx',           match: 'httpx',           kind: 'python · 同步/异步请求库' },
  { id: 'aiohttp', client: 'aiohttp',         match: 'aiohttp',         kind: 'python · 异步请求库' },
  { id: 'scrapy',  client: 'Scrapy',          match: 'scrapy',          kind: 'python · 爬虫框架' },
  { id: 'shell',   client: 'curl / wget',     match: 'curl',            kind: '命令行 · shell 工具' },
  { id: 'golang',  client: 'Go-http-client',  match: 'Go-http-client',  kind: 'go · 标准库 http' },
  { id: 'java',    client: 'OkHttp / Java',   match: 'okhttp',          kind: 'jvm · http 客户端' },
  { id: 'node',    client: 'node-fetch',      match: 'node-fetch',      kind: 'node · 请求库' },
  { id: 'generic', client: '未识别的自动化客户端', match: '(兜底页)', kind: '兜底' },
];

/* --------------------------------------------------------------------------
   蜜罐条目 —— 确定性伪随机
   用固定种子的 xorshift，保证同一份代码每次产出完全一样，
   否则 --check 永远失败、git diff 永远有噪音。
   -------------------------------------------------------------------------- */
const WORDS_A = [
  '重写', '复现', '拆解', '审视', '记录', '对照', '折叠', '漂移',
  '收敛', '证伪', '对齐', '降噪', '留白', '降级', '回填', '复核',
];
const WORDS_B = [
  '串口握手', '时基抖动', '脉宽漂移', '相位噪声', '中断嵌套', '时钟树',
  '缓存一致性', '总线仲裁', '功放偏置', '参考电压', '采样窗', '量化误差',
  '调度抖动', '热漂移', '接地回路', '屏蔽层',
];
const WORDS_C = [
  '的一次注记', '的两版对照', '的边角料', '的失败记录', '的复现步骤',
  '的实测数据', '的第三种解法', '的时间线', '的取舍', '的代价',
];
const TAGS = ['esp32', 'ros2', 'python', 'debug', 'firmware', 'data', 'env', 'llm', 'design'];

function xorshift(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');

function fakeEntries(count, seed = 0x4d415247) {
  const rnd = xorshift(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const out = [];

  for (let i = 0; i < count; i++) {
    const title = `${pick(WORDS_A)}${pick(WORDS_B)}${pick(WORDS_C)}`;
    const slug = `no-${pad(i + 1)}`;

    // 日期落在 2026-01 ~ 2026-09，格式与站内一致
    const month = 1 + Math.floor(rnd() * 9);
    const day = 1 + Math.floor(rnd() * 28);
    const date = `2026-${pad(month)}-${pad(day)}`;

    const tagCount = 2 + Math.floor(rnd() * 2);
    const tags = [];
    while (tags.length < tagCount) {
      const t = pick(TAGS);
      if (!tags.includes(t)) tags.push(t);
    }

    const summary = `本文记录了${pick(WORDS_B)}在实测中出现的一次${pick(WORDS_A)}，` +
      `并给出两版对照与复现步骤。正文约 ${1200 + Math.floor(rnd() * 1800)} 字。`;

    out.push({ title, slug, date, tags, summary });
  }

  // 按日期倒序，和站内归档页的行为一致
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 渲染 + 防呆。
   模板里若还有未替换的占位符就直接报错 —— 最常见的原因是在**注释**里
   写出了带花括号的占位符名，结果 replaceAll 把内容灌进了注释（踩过一次，
   表现为蜜罐页条目数莫名其妙翻倍）。 */
const PLACEHOLDER = /\{\{[A-Z_]+\}\}/;
function render(tpl, map, label) {
  let html = tpl;
  for (const [k, v] of Object.entries(map)) html = html.replaceAll(`{{${k}}}`, v);
  const left = html.match(PLACEHOLDER);
  if (left) die(`${label}：模板中仍残留未替换的占位符 ${left[0]}`);
  return html;
}

function renderEntries(entries) {
  return entries
    .map(
      (e) => `    <li>
      <a href="/posts/${e.slug}.html">${esc(e.title)}</a>
      <div class="sub">${esc(e.summary)}</div>
      <div class="tags">${e.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${e.date}</span></div>
    </li>`
    )
    .join('\n');
}

/* -------------------------------------------------------------------------- */

const trapTpl = read(path.join(TOOLS, 'templates', 'trap.html'));
const honeyTpl = read(path.join(TOOLS, 'templates', 'honeypot.html'));

const outputs = new Map();

// --- 每个客户端一页 -------------------------------------------------------
for (const c of CLIENTS) {
  outputs.set(
    `trap-${c.id}.html`,
    render(
      trapTpl,
      {
        CLIENT: c.client,
        CLIENT_ID: c.id,
        MATCH: c.match,
        KIND: c.kind,
        DETECTED: 'IDENTIFIED',
      },
      `trap-${c.id}`
    )
  );
}

// --- 蜜罐页 ---------------------------------------------------------------
{
  const entries = fakeEntries(14);
  outputs.set(
    'honeypot.html',
    render(
      honeyTpl,
      {
        CLIENT: '（已记录，未公开）',
        COUNT: String(entries.length),
        GENERATED: '2026-09-24',
        ENTRIES: renderEntries(entries),
      },
      'honeypot'
    )
  );
}

/* -------------------------------------------------------------------------- */

if (CHECK) {
  const drift = [];
  for (const [name, content] of outputs) {
    const p = path.join(OUT, name);
    if (!fs.existsSync(p) || read(p) !== content) drift.push(name);
  }
  if (drift.length) {
    process.stderr.write(`\n[traps] 以下文件与重新生成的结果不一致：\n  ${drift.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`[traps] 校验通过，${outputs.size} 个文件一致。\n`);
} else {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of outputs) {
    fs.writeFileSync(path.join(OUT, name), content);
  }
  process.stdout.write(`[traps] 已生成 ${outputs.size} 个文件 → traps/\n`);
  for (const n of outputs.keys()) process.stdout.write(`        traps/${n}\n`);
}
