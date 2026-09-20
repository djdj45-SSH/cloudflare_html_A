# 留言板部署（Cloudflare Pages Functions + Worker + D1）

完全匿名：访客不需要登录，昵称可留空。数据存在你自己的 D1 数据库里，
不引入任何第三方脚本，也不设置 Cookie——所以站点页脚那句「无追踪」不用改。

## 零、架构：为什么有两个入口

| | 地址 | 实现 | 角色 |
|---|---|---|---|
| **主入口** | `https://blog.djdj45.top/api` | `functions/api/[[path]].js` | 站点实际使用 |
| 备用入口 | `https://margin-comments.<子域>.workers.dev` | `worker/index.js` | 应急/外部调用 |

**为什么主入口是 Pages Function 而不是 Worker**：`*.workers.dev` 在部分网络（含国内）
会被拦截，前端表现为 **`Failed to fetch`**——这是**网络层**错误，说明请求根本没到达服务端。
换成同源之后不再需要 CORS、没有预检往返，也不依赖 workers.dev，还省掉了 zone 级权限。

两个入口**共用同一份实现**：`worker/comments-core.js` 导出 `handle(request, env)`，
`worker/index.js` 和 Pages Function 都只是薄封装。改逻辑只需改那一个文件。

> ⚠️ 判断线上故障时注意区分：前端 `load()` 里
> `data.ok === false` 会显示**后端文案**（如「slug 不合法」），
> 而 `Failed to fetch` 一定是**没连上**。两者排查方向完全不同。

## 一、部署 D1

```bash
cd worker

# 0. 安装 wrangler（只需一次）
npm install -g wrangler
wrangler login
```

**1. 建数据库**

```bash
wrangler d1 create margin_comments
```

输出里会有一行 `database_id = "xxxxxxxx-xxxx-..."`，把它填进 `wrangler.toml`。

**2. 建表**

```bash
wrangler d1 execute margin_comments --remote --file=./schema.sql
```

## 二、配置环境（两个地方都要配，这是最容易漏的一步）

**Pages Function 的 `env` 与独立 Worker 的 `env` 完全不共享。** 同一套绑定和密钥，
必须在两边各配一遍，否则会出现「站点能发留言，但站长模式失效」这类静默故障。

### 2.1 Pages 项目（主入口）

需要三样东西：D1 绑定 `DB`、环境变量 `ALLOWED_ORIGIN`、加密变量 `OWNER_KEY` 与 `IP_SALT`。

用 API 配置（`PATCH` 会整体覆盖 `deployment_configs`，**先 GET、合并原有可写字段再 PATCH**）：

```
PATCH /accounts/{account_id}/pages/projects/{project_name}
{
  "deployment_configs": {
    "production": {
      "compatibility_date": "2026-09-20",
      "d1_databases": { "DB": { "id": "<database_id>" } },
      "env_vars": {
        "ALLOWED_ORIGIN": { "type": "plain_text",  "value": "https://blog.djdj45.top" },
        "OWNER_KEY":      { "type": "secret_text", "value": "<随机串>" },
        "IP_SALT":        { "type": "secret_text", "value": "<随机串>" }
      }
    },
    "preview": { ...同上... }
  }
}
```

> ⚠️ **Pages 的环境变量改完必须重新部署才生效**，不会自动应用。
> 不想动 Git 的话，可以直接用 API 触发一次部署：
> `POST /accounts/{account_id}/pages/projects/{project_name}/deployments`，body `{"branch":"main"}`。

### 2.2 独立 Worker（备用入口，可跳过）

```bash
wrangler secret put OWNER_KEY    # 输入同一串随机字符
wrangler secret put IP_SALT
wrangler deploy
```

> ⚠️ **`wrangler.toml` 里一旦出现 `routes`，wrangler 会默认把 workers.dev 入口关掉。**
> 如果将来要加 `routes` 或 `custom_domain`，必须同时显式写 `workers_dev = true`，
> 否则等于静默拆掉现有入口（路由没建成 + 入口被关，两头落空）。

## 三、接上站点

`tools/posts.json` 里的 `commentsApi` 用**相对路径**：

```json
"site": {
  "commentsApi": "/api"
}
```

用相对路径而不是绝对地址的好处：同源天然成立，而且 **Preview 部署也能用同一套接口**。

然后重新构建并推送：

```bash
node tools/build.mjs
git add . && git commit -m "feat: 留言板" && git push
```

Pages 会自动重建并编译 `functions/`。地址留空时，文章页的留言区会显示一行
「功能还没接上后端」的提示，不会报错。

## 四、站长怎么用

1. 打开任意文章页，在地址后面加 `?ownerKey=你的密钥`，回车。
   （例如 `https://blog.djdj45.top/posts/boot-log.html?ownerKey=abc123...`）
2. 密钥会记进浏览器 localStorage，地址栏自动清理干净。**只需要做一次。**
3. 之后你会多出两种能力：
   - 发言时带「站长」徽章；
   - 每条留言右侧出现「删除」按钮（会连它的回复一起标记删除）。

想退出站长模式：清掉浏览器的 localStorage（或换一个浏览器）。

## 五、防垃圾是怎么做的

匿名评论必须防机器人，这里叠了四层：

| 层 | 做法 | 效果 |
|---|---|---|
| 蜜罐字段 | 表单里有个隐藏的 `website` 输入框，机器人会填 | 直接丢弃，且假装成功（让它以为得手了） |
| 停留时长 | 表单渲染到提交不足 3 秒 | 拦掉脚本化提交 |
| 频率限制 | 按 IP 哈希：1 分钟 1 条、10 分钟 5 条 | 拦掉刷屏 |
| 长度与链接 | 正文 2–2000 字，链接不超过 2 个 | 拦掉广告长文 |

前两层在写库前就返回，所以**不消耗频率额度**；被拦下的请求一律返回明确的错误原因，
前端会显示出来（比如「发得太快了，等一分钟再来」）。

**注意**：这些都是概率性防护。如果哪天真的被灌了，最快的处理方式是
`wrangler d1 execute margin_comments --remote --command "UPDATE comments SET status=0 WHERE ..."`，
或者在 Cloudflare 后台给 Worker 加一条 WAF 规则。

## 六、数据结构与隐私

```sql
comments (
  id, slug, parent_id, nick, body,
  created_at, is_owner, ip_hash, status
)
```

- **IP 只存哈希**：`SHA-256(盐 + IP)` 取前 32 位，只用于频率限制，无法反查。
- 盐取 `IP_SALT`，没设的话退化为 `OWNER_KEY`，两者都没设则退化为固定串 `margin`
  （功能仍可用，但加盐强度下降——所以 `IP_SALT` 建议配）。
- 删除是**软删除**（`status = 0`），行还在，便于事后追溯；真要清理可以手动 `DELETE`。
- 不写日志、不设 Cookie、不引入第三方脚本。

## 七、接口

路径前缀任意，服务端只看方法（所以 `/api/?slug=x` 与 `/?slug=x` 行为一致）。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/?slug=<slug>` | 列出某篇文章的留言（按时间正序） |
| `POST` | `/` | 新增留言 |
| `DELETE` | `/?id=<id>` | 删除（需 `x-owner-key` 头） |

POST 请求体：

```json
{ "slug": "boot-log", "parentId": null, "nick": "", "body": "内容", "website": "", "elapsed": 12 }
```

## 八、本地开发

```bash
wrangler dev --local          # 本地起一个带 D1 模拟的实例
```

本地模式记得也建一次表：

```bash
wrangler d1 execute margin_comments --local --file=./schema.sql
```
