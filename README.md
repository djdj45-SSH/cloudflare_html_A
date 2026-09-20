# 余量 MARGIN — 静态博客

纯静态站点，**浏览器端零依赖**：HTML + CSS + 原生 JS，没有 npm、没有打包、没有第三方 CDN 请求。

内容侧由 `tools/build.mjs` 生成（一个零依赖的 Node 脚本，只用于本地），
所以「发一篇新文章」= 写正文 → 改一条元数据 → 跑一次脚本 → push。
**首页、归档、RSS、站点地图都不用手改。**

```
cloudflare_html_A/
├── tools/                     ← 内容源与构建脚本（编辑都在这里）
│   ├── posts.json             所有文章的元数据（唯一数据源）
│   ├── content/               正文片段，一个文件一篇
│   ├── covers/                首页头条用的内联 SVG 插图（可选）
│   ├── templates/             页面骨架与片段模板
│   ├── build.mjs              构建脚本（node tools/build.mjs）
│   └── pre-commit.sample      git 钩子示例：防止忘了跑构建
│
├── worker/                    ← 留言板后端（Cloudflare Workers + D1，独立部署）
│   ├── index.js               接口实现（含四层防垃圾）
│   ├── schema.sql             建表语句
│   ├── wrangler.toml          部署配置
│   └── README.md              部署步骤与站长用法
│
├── index.html                 ← 以下是生成物。带 build 锚点的区块会被覆盖
├── archive.html               归档（含实时搜索）
├── tags/                      标签索引 + 每个标签一页（自动生成）
├── changelog.html             修订记录汇总（从各篇文章的 revision 里抽出来）
├── about.html                 （about / 404 是手写的，只注入 nav 和 footer）
├── 404.html
├── posts/                     文章页（全部由 content/ 生成）
├── assets/
│   ├── css/site.css           设计令牌 + 全部样式（含明室/暗房双主题）
│   ├── js/site.js             主题 / 示波器 / 目录 / 搜索 / 复制 / 抽屉
│   └── js/comments.js         留言板前端（仅文章页加载）
├── feed.xml                   生成（全文输出）
├── sitemap.xml                生成
├── robots.txt
├── _headers                   Cloudflare 自定义响应头
├── _redirects                 Cloudflare 重定向规则
└── favicon.svg
```

**一句话规则：想改文字，改 `tools/content/`；想改元数据，改 `tools/posts.json`；
然后跑 `node tools/build.mjs`。直接手改 `posts/*.html` 或锚点区里的内容，下次构建会被覆盖。**

## 一、部署到 Cloudflare Pages

1. **建仓库并推送**

   ```bash
   git init
   git add .
   git commit -m "init: 余量 MARGIN"
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. **在 Cloudflare 上接入**
   Workers & Pages → Create → Pages → Connect to Git → 选中刚推的仓库。

3. **构建设置**（关键 —— 注意这里**不需要**任何构建步骤）

   | 字段 | 值 |
   |---|---|
   | Framework preset | `None` |
   | Build command | `exit 0` |
   | Build output directory | `/` |

   构建发生在你自己的电脑上（`node tools/build.mjs`），产物直接提交进仓库，
   所以 Cloudflare 只负责托管。这个选择的好处是：**上线失败的可能性几乎为零**，
   而且推送什么就上什么，不存在云端环境差异。

4. 保存后等待部署，Pages 会给一个 `xxx.pages.dev` 域名。绑定自定义域名在
   Custom domains 里添加，DNS 会自动配好。

## 二、域名与尚未替换的占位内容

域名集中管理在 `tools/posts.json` 的 `site` 一处，重新构建即可覆盖所有页面。
**当前站点地址：`https://blog.djdj45.top`**（Cloudflare Pages + 自定义域名）。

| 位置 | 当前值 | 说明 |
|---|---|---|
| `tools/posts.json` → `site.url` | `https://blog.djdj45.top` | 一处改全站，改完必须重新构建 |
| `tools/posts.json` → `site.commentsApi` | 留言板 Worker 地址 | 见下面「留言板」一节 |
| `tools/posts.json` → `site.email` | ⚠️ 仍是 `hello@example.com` | 页脚显示，**上线前应换成真实邮箱** |
| `robots.txt` | `Sitemap:` 那一行 | 手写文件，**换域名要手动改** |

> 除了 `robots.txt`，其余页面的 `<head>` 绝对地址（`canonical` / `og:url`）都由构建脚本
> 按 `site.url` 自动校正——包括 `index.html`、`archive.html`、`changelog.html`、
> `tags/index.html` 这几个手写外壳。所以换域名只需改 `site.url` 再 `node tools/build.mjs`。

```bash
# 改完 site.url 之后
node tools/build.mjs
```

## 三、写一篇新文章（四步）

### 1. 写正文

在 `tools/content/` 新建 `<slug>.html`（slug 用英文短横线，会成为 URL）。
**只写正文片段**，不用管 head、导航、页脚：

```html
<div class="wrap article-body">
  <div class="prose">
    <p class="first">首段。这个 class 让首字母下沉，每篇只给第一段。</p>

    <h2><span class="h2num">01</span>小节标题</h2>
    <p>正文段落。小节标题里的编号会自动进右侧目录。</p>

    <blockquote><p>引文，左侧会有一条磷光竖线。</p></blockquote>

    <p>行内代码用 <code>这样</code>，重点用 <mark>荧光笔</mark>。</p>

    <div class="codeblock">
      <div class="codeblock__bar"><span>firmware.ino</span></div>
<pre>// 代码里可用 &lt;span class="c"&gt;注释&lt;/span&gt;、&lt;span class="k"&gt;关键字&lt;/span&gt;
// .s 字符串 / .n 数字</pre>
    </div>

    <figure class="figure">
      <svg viewBox="0 0 800 300">
        <path d="M0 150 L800 150" style="stroke:var(--phos);stroke-width:2"/>
      </svg>
      <figcaption><b>图 01</b> — 图注。</figcaption>
    </figure>

    <table>
      <thead><tr><th>列一</th><th>列二</th></tr></thead>
      <tbody>
        <tr><td>值</td><td>说明</td></tr>
      </tbody>
    </table>
  </div>

  <aside class="notes">
    <div class="notes__inner">
      <div class="notes__toc"></div>
      <p class="marginnote"><b>边注标题。</b>边注正文，窄屏会自动隐藏。</p>
    </div>
  </aside>
</div>
```

> ⚠️ 内联 SVG 的颜色必须写成 `style="stroke:var(--phos)"`。
> 写成 `stroke="var(--phos)"` 浏览器会直接忽略（SVG 表现属性不支持 CSS 变量）。

顺带说几个已经配好样式的元素，直接写标签就行，不用加内联样式：
`<blockquote>` 引文、`<mark>` 荧光笔、`<table>` 表格（表头自动等宽小写）、
`<code>` 行内代码、`<strong>` / `<em>`。

### 2. 加一条元数据

在 `tools/posts.json` 的 `posts` 数组里加一项：

```json
{
  "slug": "my-new-post",
  "title": "文章标题",
  "date": "2026-10-01",
  "category": "调试笔记",
  "tech": "ESP32 / micro-ROS",
  "listCategory": "调试",
  "description": "给搜索引擎看的长描述，会进 meta description。",
  "ogDescription": "给社交分享看的短描述。",
  "standfirst": "文章页标题下方的那段引导语。",
  "summary": "首页与归档列表里的摘要。",
  "keywords": "空格分隔 关键词 中英文都写 搜索才能命中",
  "tags": ["esp32", "debug"],
  "draft": false,
  "stack": "固件 v2.8 · ESP32-WROOM-32E",
  "readtime": "约 8 分钟",
  "words": "2,000"
}
```

- 序号（`No.06`）、上一篇/下一篇导航、阅读进度——全部按 `date` 自动排，不用管顺序。
- `readtime` 和 `words` 可以**直接删掉**，脚本会按正文自动算（350 字/分钟）。
- `cover` 可选：填 `covers/` 下的文件名，首页头条就会带插图；不填则头条走纯文字版式。
- `tags` 是英文 slug 数组（如 `["esp32", "debug"]`），显示名在 `posts.json` 顶层的
  `tagLabels` 里配置。**相关文章和标签页都靠它自动生成**，不需要手写任何列表。
- `draft: true` 的文章会被构建完全跳过——不出现在首页、归档、标签页、RSS 和 sitemap 里。
  草稿可以安全地留在仓库里。

### 站点里那些"自动"的东西

| 功能 | 它是怎么来的 |
|---|---|
| **标签页** `/tags/` | 从各篇的 `tags` 聚合，`tagLabels` 提供中文名；一个标签一个页面 |
| **相关文章**（文章末尾 3 篇） | 按标签重合度打分，同分类额外加权，同分时新的优先 |
| **更新记录** `/changelog.html` | 自动抽取每篇文章末尾 `<dl class="revision">` 里的每一条 dt/dd，按日期倒序汇总 |
| **RSS 全文输出** | `description` 放摘要，`content:encoded` 放正文（CDATA 包裹），站内链接自动转绝对地址 |
| **留言板** | 文章页底部，前端在 `assets/js/comments.js`，后端在 `worker/`，见 `worker/README.md` |
| **head 绝对地址** | `canonical` / `og:url` 自动归到 `site.url` 名下，手写外壳页也覆盖（只换 origin、保留路径） |

想让相关文章更准，就把标签打得更细一点；想让它彻底不出现，把 `HAS_RELATED` 那个判断去掉即可。

### 留言板

完全匿名、不需要登录、不引入第三方脚本。**后端已经部署好了**：

- Worker：`https://margin-comments.3554749491.workers.dev`（名字 `margin-comments`）
- D1 数据库：`margin_comments`（id `3c7e1ad3-9df5-4c26-8b8c-2af9919166b8`，区域 WNAM）
- 表 `comments` + 两个索引已建好；`OWNER_KEY` / `IP_SALT` 以 secret 形式保存

想重新部署或换库，按 `worker/README.md` 走一遍：建库 → 建表 → 设密钥 → `wrangler deploy`，
然后把 Worker 地址填回 `tools/posts.json` 的 `site.commentsApi`，重新构建即可。
`commentsApi` 留空时，文章页底部会显示一行「功能还没接上后端」的提示，不会报错。

站长用法：打开任意文章页，地址后加 `?ownerKey=你的密钥`（只需一次，会记进浏览器），
之后就能删除留言、以及带「站长」徽章发言。

### 3. 生成

```bash
node tools/build.mjs          # 生成全站
node tools/build.mjs --check  # 只校验，不写入。有差异时退出码 1
```

脚本会自动完成：生成文章页、更新首页头条与列表、更新归档分组、重写 `feed.xml` 和 `sitemap.xml`。

### 4. 本地看一眼再推

```bash
python -m http.server 8080     # 打开 http://localhost:8080
git add . && git commit -m "post: 文章标题" && git push
```

**建议启用防呆钩子**（防止忘了跑构建就提交）：

```bash
cp tools/pre-commit.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## 四、修改已有内容

| 想改什么 | 改哪里 |
|---|---|
| 文章正文 | `tools/content/<slug>.html` |
| 标题 / 日期 / 摘要 / 关键词 | `tools/posts.json` |
| 导航栏、抽屉、页脚 | `tools/templates/nav.html`、`footer.html`（改一次全站生效） |
| 文章页结构（byline、pager 等） | `tools/templates/post.html` |
| 首页头条与列表项版式 | `tools/templates/feature.html`、`list-entry.html` |
| 配色 / 字体 / 动效曲线 | `assets/css/site.css` 顶部 `:root` 与 `[data-theme="day"]` |
| 首页波形、"掉线"节奏 | `assets/js/site.js` 的 `channels` 数组、`silenceAt()` |
| 关于页 / 404 文案 | `about.html`、`404.html`（手写文件，正文直接改） |

改完**任何一项都要跑一次** `node tools/build.mjs`。

配色变量：`--bg / -2 / -3`、`--line / -2 / -3`、`--text / -2 / -3`、`--phos / --amber / --cyan`。
明室主题在 `[data-theme="day"]` 里覆写同一套变量——**`--phos` 在明背景下必须换成深色值**，
否则对比度不达标。

## 五、配置文件说明

- **`_headers`**：给 `/assets/*` 加一年强缓存，`/*.html` 不缓存（改完立刻生效）。
  格式要求：路径一行，下面的头字段必须缩进，否则 Cloudflare 会静默忽略。
- **`_redirects`**：`/rss`、`/feed` 指向 `feed.xml`；末尾 `/* /404.html 404` 兜底。
- **`404.html`**：Pages 会自动识别并使用，无须额外配置。
- 这两个文件必须放在**构建输出目录的根目录**（本项目就是仓库根目录）。

## 六、设计与技术说明（仪器美学）

设计方向是**示波器 / 仪器界面**——这个站点写的是波形、串口日志和测量数据，
所以界面本身就是一台仪器。

- **双主题**：暗房（默认，磷光屏 `#070808` + 磷光绿 `#5EE39B` + 琥珀 `#FFB65C`）／
  明室（原理图纸 `#F3F5F1` + 墨绿 `#0C7A4A`）。
- **实时示波器**：首页 Canvas 三通道波形，每帧描两遍（宽淡=辉光 + 细实=轨迹）代替
  `shadowBlur`；每 9 秒出现一次 0.45 秒"掉线"。滚出视口或页面隐藏时自动暂停。
- **Apple 流体动效**：临界阻尼 `cubic-bezier(.22,1,.36,1)` + 回弹
  `cubic-bezier(.34,1.56,.64,1)`；主题切换走 View Transitions 的 `clip-path: circle()`
  圆形扩散（圆心 = 点击位置），不支持的浏览器自动降级。
- **材质**：毛玻璃导航、仪器面板四角标记、扫描线层——全部是 CSS，无图片。
- **字体**：系统字体栈，零外部请求。
- **无障碍**：跳转链接、`:focus-visible` 焦点环、抽屉焦点陷阱与 Esc 关闭、
  `prefers-reduced-motion` 全量降级（波形转静态帧）、`prefers-contrast`、打印样式。

## 七、Cloudflare Pages 的限制

按当前体量（站点 26 个文件、约 345 KB，含内容源共 54 个文件、约 520 KB）完全不是问题。三条记住即可：

- 单文件 ≤ 25 MiB
- 每次部署 ≤ 20,000 个文件
- 图片建议压到 100–300 KB；视频和大文件放 R2 外链

## 八、本地预览

必须起本地服务（不要用 `file://` 直接打开，`/assets/...` 这类绝对路径会失效）：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```
