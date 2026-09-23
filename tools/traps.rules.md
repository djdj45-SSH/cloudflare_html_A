# 反爬规则清单（Cloudflare 边缘）

> 这里是 `traps/` 下每个 trap 页与 Cloudflare **重定向规则**的对应关系。
> 规则配在控制台（zone 级），不随仓库走 —— 这是有意的，见下面「为什么规则不进仓库」。

## 为什么能这么做（可用性依据）

| 事实 | 依据 |
| --- | --- |
| Single Redirects 所有计划可用，Free = **10 条规则** | 官方 availability 表 |
| 免费版**支持** `http.user_agent` 字段（`contains`，不支持正则） | 本项目实测：规则已建、状态"活动"、请求被正确改道 |
| Redirect 是 terminating action，在规则阶段执行 | 官方 execution order |
| 因此**零 Function 调用**：不消耗 10 万/天 Pages Functions 配额，与留言板 `/api` 互不影响 | 官方配额说明 |

## 被排除的路径（都试过，免费版不行）

| 手段 | 结论 |
| --- | --- |
| WAF 自定义规则的 Block 自定义响应体 | Free 不支持，要 Pro |
| 错误页面 / Custom Errors | Free 不支持，要 Pro |
| Snippets（写 JS 返回任意响应） | Free 不支持，要 Pro |
| Cloudflare Pages 全局 `_middleware.js` | 可用，但每页消耗 1 次 Function 配额，且与留言板共用 10 万/天。仅作为"蜜罐层"备选 |

## 规则表（10 条，其中 9 条给 trap）

| # | 规则名 | 条件（`http.user_agent contains`） | 目标 URL | 状态码 |
| --- | --- | --- | --- | --- |
| 1 | `block-python-bots` | `python-requests` | `/traps/trap-python.html` | 302 |
| 2 | `trap-httpx` | `httpx` | `/traps/trap-httpx.html` | 302 |
| 3 | `trap-aiohttp` | `aiohttp` | `/traps/trap-aiohttp.html` | 302 |
| 4 | `trap-scrapy` | `scrapy` | `/traps/trap-scrapy.html` | 302 |
| 5 | `trap-curl` | `curl` | `/traps/trap-shell.html` | 302 |
| 6 | `trap-wget` | `wget` | `/traps/trap-shell.html` | 302 |
| 7 | `trap-go` | `Go-http-client` | `/traps/trap-golang.html` | 302 |
| 8 | `trap-okhttp` | `okhttp` | `/traps/trap-java.html` | 302 |
| 9 | `trap-node` | `node-fetch` | `/traps/trap-node.html` | 302 |
| 10 | *(留给未来的限流或调试)* | — | — | — |

**第 1 条已建**（2026-09-24 实测通过）。

## 每条规则的表达式（必须带排除条件）

```
(http.user_agent contains "<match>")
and not starts_with(http.request.uri.path, "/traps/")
and not starts_with(http.request.uri.path, "/blocked/")
```

> ⚠️ **不写 `not starts_with(...)` 会无限重定向。**
> Redirect 的条件是"UA 命中就跳"，跳转后的新请求 UA 没变，会再次命中。
> 验证：`curl -w "%{num_redirects}"` 必须是 `1`。

## 验证（三条命令，缺一不可）

```bash
URL=https://blog.djdj45.top/posts/servo-jitter.html

# ① 爬虫身份 → 应该拿到自己的 trap 页
curl -sSL -A "python-requests/2.31.0" "$URL" | grep -o '<h1>.*</h1>'

# ② 没有死循环 → redirects 必须是 1
curl -sS -o /dev/null -w "redirects=%{num_redirects} final=%{http_code}\n" \
     -L -A "python-requests/2.31.0" "$URL"

# ③ 真人 / 声明身份的爬虫 → 正常 200
curl -sS -o /dev/null -w "browser=%{http_code}\n" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "$URL"
curl -sS -o /dev/null -w "dojobot=%{http_code}\n"  -A "DojoBot/1.0 (+https://blog.djdj45.top/about.html)" "$URL"
```

## 已知的既有现象：`browser=308`

页面 URL 带 `.html` 时，Cloudflare Pages 会 308 到无扩展名地址（社区记录为 Pages 的硬编码行为，无法配置关闭）。
这个 308 **不是本方案引入的** —— 规则的匹配条件是"UA 包含某个库名"，浏览器 UA 不匹配，规则不会触发。

它对本方案**无影响**：
- trap 页的 URL 一样会被规范化，但排除条件用的是路径前缀 `/traps/`，规范化后仍是同一前缀，不会死循环
- 想消掉它只能加 `functions/_middleware.js` 拦截 `.html` 请求 —— 那是另一个话题（见"蜜罐层"备选）

## 为什么规则不进仓库

1. **规则公开 = 防护变开卷考试。** 这个博客仓库是公开的，把完整规则写进去，任何人都能一眼读出绕过方式。
2. **控制台是 zone 级、仓库是部署级。** 规则改 1 条要重新部署一次站点，代价与收益不成比例。
3. 但**规则的存在和原理要写进博客文章** —— 教学价值在"为什么这么配"，不在"把配置藏起来"。

trap 页本身可以进仓库（它们只是静态页面，公开也无所谓，内容本身不泄露任何可用信息）。

## 蜜罐层（`traps/honeypot.html`）

它**不拒绝**，而是**骗**：返回一个结构完全正确的归档页，14 条假文章，日期、标签、摘要格式全部合规。

当前**未接入**（规则指向的是 `trap-*.html` 而非 `honeypot.html`）。想启用有两种做法：

- **边缘重定向**：把某条规则的目标改成 `/traps/honeypot.html`
  - 代价：无。仍然是 302 → 200，不耗 Function 配额
  - 效果：爬虫"成功"入库 14 条脏数据，且它自己不知道
- **中间件**：`functions/_middleware.js` 里按 UA 返回，可做"渐进式"（第一次拒绝、第二次限流、第三次喂假数据）
  - 代价：消耗 Function 配额，需要 `_routes.json` 限定范围 + 边缘限流做盾

**教学点**：蜜罐是全项目唯一"抓到了、但数据是错的"场景，逼着读者去写校验（时间范围、正文长度分布、重复率、链接可达性 —— 注意假条目的 `/posts/no-*.html` 链接全是死的，这就是一个可用的破绽）。
